-- Migration: Payment State Machine Enforcement
-- Date: 2026-03-15
-- Description:
--   Implements the full transaction status lifecycle required for a
--   production-grade fintech application:
--
--   1. Add 'initialized' to transaction_status_enum so the complete
--      lifecycle (pending → initialized → processing → completed / failed)
--      can be expressed in the database.
--
--   2. Add a BEFORE UPDATE trigger that rejects invalid status transitions,
--      preventing accidental state corruption in the transactions table.
--
--   3. Add claim_transaction_for_processing(p_reference) — an atomic RPC
--      that moves a transaction from 'pending' or 'initialized' to
--      'processing' via a single UPDATE … RETURNING.  Callers receive a
--      boolean indicating whether they "won" the race and may proceed to
--      complete the payment.  This eliminates the TOCTOU race condition that
--      existed when duplicate webhook deliveries arrived concurrently.
--
--   4. Replace record_contribution_payment with a lock-aware version that:
--      (a) acquires a row-level lock via SELECT … FOR UPDATE, serialising
--          concurrent executions for the same reference, and
--      (b) advances the status through pending/initialized → processing →
--          completed internally, so the function is safe regardless of
--          whether the caller called claim_transaction_for_processing first.

-- ============================================================================
-- 1. ADD 'initialized' TO transaction_status_enum
-- ============================================================================

-- The 'initialized' status represents a transaction that has been handed off
-- to the payment provider (e.g. the Paystack popup has been opened).  It sits
-- semantically between 'pending' (record created) and 'processing' (webhook/verify
-- claim).  The AFTER clause controls physical storage order in the enum type; the
-- state machine semantics are enforced exclusively by the trigger below.
ALTER TYPE transaction_status_enum ADD VALUE IF NOT EXISTS 'initialized' AFTER 'pending';

-- ============================================================================
-- 2. STATE TRANSITION ENFORCEMENT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_transaction_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Same-status updates are always allowed (e.g. metadata-only patches).
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Valid state transitions:
  --   pending      → initialized | processing | failed | cancelled
  --   initialized  → processing  | failed     | cancelled
  --   processing   → completed   | failed
  --   failed       → pending     (payout retry path)
  -- Terminal states (completed, cancelled) may not be left.
  IF (OLD.status = 'pending'     AND NEW.status IN ('initialized', 'processing', 'failed', 'cancelled'))
  OR (OLD.status = 'initialized' AND NEW.status IN ('processing',  'failed',     'cancelled'))
  OR (OLD.status = 'processing'  AND NEW.status IN ('completed',   'failed'))
  OR (OLD.status = 'failed'      AND NEW.status =  'pending')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Invalid transaction status transition: % → % (transaction id: %)',
    OLD.status, NEW.status, OLD.id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

-- Fire only when the status column is explicitly updated to keep overhead minimal.
CREATE TRIGGER trg_transaction_state_machine
  BEFORE UPDATE OF status ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_transaction_status_transition();

-- ============================================================================
-- 3. ATOMIC CLAIM FUNCTION
-- ============================================================================

-- claim_transaction_for_processing atomically advances a transaction from
-- 'pending' or 'initialized' to 'processing'.  Because it uses a single
-- UPDATE … RETURNING, PostgreSQL guarantees that exactly one concurrent
-- caller succeeds — the "winner" may proceed with payment processing; all
-- others receive success=false and must treat the payment as already handled.
--
-- Returns:
--   { "success": true,  "transaction_id": "<uuid>" }  — claim succeeded
--   { "success": false, "reason": "already_claimed_or_not_found" }
--   { "success": false, "error": "<message>" }         — unexpected error
CREATE OR REPLACE FUNCTION claim_transaction_for_processing(p_reference TEXT)
RETURNS JSON AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE transactions
  SET    status = 'processing'
  WHERE  reference = p_reference
    AND  status    IN ('pending', 'initialized')
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- No row was updated: the transaction either does not exist or was already
    -- claimed / completed / failed by another concurrent caller.
    RETURN json_build_object(
      'success', false,
      'reason',  'already_claimed_or_not_found'
    );
  END IF;

  RETURN json_build_object('success', true, 'transaction_id', v_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION claim_transaction_for_processing(TEXT) TO authenticated;

-- ============================================================================
-- 4. LOCK-AWARE record_contribution_payment
-- ============================================================================

-- Changes from the previous version:
--   * SELECT … FOR UPDATE acquires a row-level lock so that two concurrent
--     callers for the same reference are serialised rather than racing.
--   * Handles all claimable states ('pending', 'initialized', 'processing')
--     by advancing through the state machine before marking 'completed'.
--   * The EXCEPTION block still rolls back the entire implicit SAVEPOINT so
--     no partial writes escape on any failure path.
CREATE OR REPLACE FUNCTION record_contribution_payment(
  p_reference       TEXT,
  p_contribution_id UUID,
  p_user_id         UUID,
  p_group_id        UUID,
  p_amount_naira    DECIMAL(15, 2),
  p_paid_at         TIMESTAMPTZ DEFAULT now(),
  p_metadata        JSONB DEFAULT '{}'::jsonb
)
RETURNS JSON AS $$
DECLARE
  v_existing_status TEXT;
BEGIN
  -- Acquire a row-level lock.  Any concurrent invocation for the same
  -- reference will block here until this transaction commits or rolls back,
  -- eliminating the TOCTOU race between the webhook and verify-contribution.
  SELECT status
  INTO   v_existing_status
  FROM   transactions
  WHERE  reference = p_reference
  FOR    UPDATE;

  -- Idempotency guard: already completed — nothing to do.
  IF v_existing_status = 'completed' THEN
    RETURN json_build_object('success', true, 'already_processed', true);
  END IF;

  -- Advance to 'processing' if the caller has not already done so via
  -- claim_transaction_for_processing.  Two code paths lead here:
  --   1. webhook handlers  — they call claim_transaction_for_processing first,
  --      so the transaction is already in 'processing' and this block is a no-op.
  --   2. verify-contribution — it calls record_contribution_payment directly
  --      without a prior claim, so we advance the status here before completing.
  -- This design keeps the function safe for both callers while avoiding the need
  -- for verify-contribution to perform a separate claim round-trip.
  IF v_existing_status IN ('pending', 'initialized') THEN
    UPDATE transactions
    SET    status = 'processing'
    WHERE  reference = p_reference;
  END IF;

  -- Step 1: Mark the transaction record as completed.
  UPDATE transactions
  SET    status       = 'completed',
         completed_at = p_paid_at,
         metadata     = metadata || p_metadata
  WHERE  reference = p_reference;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Transaction with reference % not found', p_reference;
  END IF;

  -- Step 2: Mark the contribution row as paid.
  UPDATE contributions
  SET    status          = 'paid',
         paid_date       = p_paid_at,
         transaction_ref = p_reference
  WHERE  id      = p_contribution_id
    AND  user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Contribution % not found for user %', p_contribution_id, p_user_id;
  END IF;

  -- Step 3: Increment the group's running total.
  PERFORM increment_group_total_collected(p_group_id, p_amount_naira);

  RETURN json_build_object('success', true, 'already_processed', false);
EXCEPTION
  WHEN OTHERS THEN
    -- The implicit SAVEPOINT is rolled back automatically, undoing steps 1–3.
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION record_contribution_payment(TEXT, UUID, UUID, UUID, DECIMAL, TIMESTAMPTZ, JSONB) TO authenticated;
