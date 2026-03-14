-- Migration: Atomic Transaction Safety Improvements
-- Date: 2026-03-14
-- Description:
--   Addresses database transaction safety gaps identified in architecture audit:
--
--   1. Add UNIQUE constraint on payouts(related_group_id, cycle_number) to prevent
--      duplicate payout records when concurrent requests race.
--
--   2. Fix check_cycle_and_prepare_payout to use SELECT ... FOR UPDATE on the group
--      row so that only one concurrent caller can create a payout per cycle.
--
--   3. Add record_contribution_payment atomic RPC — replaces the three separate DB
--      calls that edge functions previously made (update transactions, update
--      contributions, increment group total_collected). All three steps now run
--      inside a single PL/pgSQL function body with an EXCEPTION handler that
--      rolls back all changes if any step fails.
--
--   4. Add record_payout_initiation atomic RPC — replaces two separate DB calls
--      in the payout-process edge function (update payout with transfer_code,
--      insert transaction record) with a single atomic operation.
--
--   5. Add complete_payout_transfer atomic RPC — replaces two separate DB calls
--      in the paystack-webhook transfer.success handler (update payout status,
--      update transaction status) with a single atomic operation.
--
-- Transaction safety model used throughout:
--   Every PL/pgSQL function that contains an EXCEPTION clause establishes an
--   implicit SAVEPOINT at the start of its BEGIN...END block. If any statement
--   raises an error the implicit SAVEPOINT is rolled back — atomically undoing
--   all writes made inside the function — before the EXCEPTION handler runs.
--   This guarantees BEGIN / COMMIT semantics for all multi-step writes.

-- ============================================================================
-- 1. UNIQUE CONSTRAINT: one payout record per group per cycle
--    Acts as a database-level guard against duplicate payouts even when the
--    application-level idempotency check in check_cycle_and_prepare_payout
--    is bypassed by concurrent callers.
-- ============================================================================

ALTER TABLE payouts
  ADD CONSTRAINT unique_payout_per_cycle
  UNIQUE (related_group_id, cycle_number);

-- ============================================================================
-- 2. REPLACE check_cycle_and_prepare_payout
--    Adds SELECT ... FOR UPDATE on the group row so that concurrent callers
--    are serialised: only the first caller proceeds to create the payout;
--    all others wait and then see v_payout_exists = true.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_cycle_and_prepare_payout(
  p_group_id     UUID,
  p_cycle_number INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_total_members        INTEGER;
  v_paid_count           INTEGER;
  v_contribution_amount  DECIMAL(15, 2);
  v_service_fee_pct      DECIMAL(5, 2);
  v_gross_payout         DECIMAL(15, 2);
  v_service_fee_amount   DECIMAL(15, 2);
  v_net_payout           DECIMAL(15, 2);
  v_recipient_id         UUID;
  v_payout_exists        BOOLEAN;
  v_group_status         group_status_enum;
BEGIN
  -- Lock the group row for the duration of this transaction to prevent a
  -- race condition where two concurrent callers both see no existing payout
  -- and both attempt to INSERT one.
  SELECT total_members, contribution_amount, service_fee_percentage, status
  INTO v_total_members, v_contribution_amount, v_service_fee_pct, v_group_status
  FROM groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Group not found');
  END IF;

  -- Count paid contributions for this cycle
  SELECT COUNT(*)
  INTO v_paid_count
  FROM contributions
  WHERE group_id    = p_group_id
    AND cycle_number = p_cycle_number
    AND status       = 'paid';

  -- If not all members have paid, return early
  IF v_paid_count < v_total_members THEN
    RETURN json_build_object(
      'success', true,
      'cycle_complete', false,
      'paid', v_paid_count,
      'required', v_total_members
    );
  END IF;

  -- All members have paid – check if a payout record already exists (idempotency)
  SELECT EXISTS (
    SELECT 1 FROM payouts
    WHERE related_group_id = p_group_id
      AND cycle_number      = p_cycle_number
  ) INTO v_payout_exists;

  IF v_payout_exists THEN
    RETURN json_build_object(
      'success', true,
      'cycle_complete', true,
      'payout_already_created', true
    );
  END IF;

  -- Identify the recipient: the group member whose rotation position equals
  -- the cycle number (1-indexed).
  SELECT gm.user_id
  INTO v_recipient_id
  FROM group_members gm
  WHERE gm.group_id = p_group_id
    AND gm.position = p_cycle_number
    AND gm.status   = 'active'
  LIMIT 1;

  IF v_recipient_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Could not identify payout recipient for cycle ' || p_cycle_number
    );
  END IF;

  -- Calculate net payout amount after deducting the platform service fee
  v_gross_payout       := v_contribution_amount * v_total_members;
  v_service_fee_amount := ROUND(v_gross_payout * v_service_fee_pct / 100, 2);
  v_net_payout         := v_gross_payout - v_service_fee_amount;

  -- Create the payout record with the net amount.
  -- The unique_payout_per_cycle constraint provides an additional database-level
  -- guard if two transactions somehow pass the v_payout_exists check simultaneously.
  INSERT INTO payouts (
    related_group_id,
    recipient_id,
    cycle_number,
    amount,
    status,
    payout_date,
    notes
  ) VALUES (
    p_group_id,
    v_recipient_id,
    p_cycle_number,
    v_net_payout,
    'pending',
    CURRENT_DATE,
    format(
      'Gross: ₦%s | Service fee (%s%%): ₦%s | Net: ₦%s',
      v_gross_payout, v_service_fee_pct, v_service_fee_amount, v_net_payout
    )
  );

  -- Advance the group's current_cycle if this was the latest cycle
  UPDATE groups
  SET current_cycle = p_cycle_number + 1
  WHERE id = p_group_id
    AND current_cycle = p_cycle_number;

  RETURN json_build_object(
    'success', true,
    'cycle_complete', true,
    'payout_created', true,
    'recipient_id', v_recipient_id,
    'cycle_number', p_cycle_number,
    'gross_payout', v_gross_payout,
    'service_fee_amount', v_service_fee_amount,
    'net_payout', v_net_payout
  );
EXCEPTION
  WHEN unique_violation THEN
    -- Another concurrent transaction already inserted the payout record.
    -- Treat this as a successful idempotent result.
    RETURN json_build_object(
      'success', true,
      'cycle_complete', true,
      'payout_already_created', true
    );
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. RPC: record_contribution_payment
--    Atomically records a successful contribution payment by updating the
--    transaction record, marking the contribution as paid, and incrementing
--    the group's total_collected balance — all within a single PL/pgSQL
--    function body.  If any step fails the implicit SAVEPOINT rolls back
--    every preceding write.
--
--    Parameters:
--      p_reference       – Paystack payment reference
--      p_contribution_id – UUID of the contributions row
--      p_user_id         – UUID of the paying member
--      p_group_id        – UUID of the group
--      p_amount_naira    – Contribution amount in naira (not kobo)
--      p_paid_at         – Timestamp of payment (defaults to now())
--      p_metadata        – Additional JSONB metadata merged into the
--                          transaction record
--
--    Returns JSON:
--      { "success": true,  "already_processed": false }   – normal success
--      { "success": true,  "already_processed": true  }   – idempotent repeat
--      { "success": false, "error": "<message>"        }   – failure (all writes
--                                                            have been rolled back)
-- ============================================================================

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
  -- Idempotency guard: if the transaction is already completed there is
  -- nothing to do — return success without making any writes.
  SELECT status
  INTO v_existing_status
  FROM transactions
  WHERE reference = p_reference;

  IF v_existing_status = 'completed' THEN
    RETURN json_build_object('success', true, 'already_processed', true);
  END IF;

  -- Step 1: Mark the transaction record as completed.
  UPDATE transactions
  SET status       = 'completed',
      completed_at = p_paid_at,
      metadata     = metadata || p_metadata
  WHERE reference = p_reference;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Transaction with reference % not found', p_reference;
  END IF;

  -- Step 2: Mark the contribution row as paid.
  UPDATE contributions
  SET status          = 'paid',
      paid_date       = p_paid_at,
      transaction_ref = p_reference
  WHERE id      = p_contribution_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Contribution % not found for user %', p_contribution_id, p_user_id;
  END IF;

  -- Step 3: Increment the group's running total.
  PERFORM increment_group_total_collected(p_group_id, p_amount_naira);

  RETURN json_build_object('success', true, 'already_processed', false);
EXCEPTION
  WHEN OTHERS THEN
    -- The implicit SAVEPOINT is rolled back automatically, undoing steps 1-3.
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. RPC: record_payout_initiation
--    Atomically records a successful Paystack transfer initiation by updating
--    the payout row with the transfer code and inserting the corresponding
--    transaction record — both in a single function body.
--
--    Parameters:
--      p_payout_id            – UUID of the payouts row
--      p_user_id              – UUID of the payout recipient
--      p_group_id             – UUID of the group
--      p_cycle_number         – Contribution cycle number
--      p_amount_kobo          – Payout amount in kobo (as stored in transactions)
--      p_transfer_code        – Paystack transfer_code returned by the API
--      p_transfer_reference   – Our internal reference sent to Paystack
-- ============================================================================

CREATE OR REPLACE FUNCTION record_payout_initiation(
  p_payout_id          UUID,
  p_user_id            UUID,
  p_group_id           UUID,
  p_cycle_number       INTEGER,
  p_amount_kobo        INTEGER,
  p_transfer_code      TEXT,
  p_transfer_reference TEXT
)
RETURNS JSON AS $$
BEGIN
  -- Step 1: Update the payout row with the Paystack transfer details.
  UPDATE payouts
  SET payment_method    = 'paystack_transfer',
      payment_reference = p_transfer_code,
      notes             = format(
                            'Transfer code: %s; Reference: %s',
                            p_transfer_code,
                            p_transfer_reference
                          )
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout % not found', p_payout_id;
  END IF;

  -- Step 2: Insert a corresponding payout transaction record.
  INSERT INTO transactions (
    user_id,
    group_id,
    amount,
    type,
    status,
    reference,
    metadata
  ) VALUES (
    p_user_id,
    p_group_id,
    p_amount_kobo,
    'payout',
    'processing',
    p_transfer_reference,
    jsonb_build_object(
      'payout_id',     p_payout_id,
      'cycle_number',  p_cycle_number,
      'transfer_code', p_transfer_code
    )
  );

  RETURN json_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. RPC: complete_payout_transfer
--    Atomically marks a payout as completed and updates its matching
--    transaction record in the same function body.  Called by the
--    paystack-webhook edge function when a transfer.success event arrives.
--
--    Parameters:
--      p_payout_id    – UUID of the payouts row (looked up from payment_reference)
--      p_transfer_code – Paystack transfer_code from the webhook event
-- ============================================================================

CREATE OR REPLACE FUNCTION complete_payout_transfer(
  p_payout_id    UUID,
  p_transfer_code TEXT
)
RETURNS JSON AS $$
BEGIN
  -- Step 1: Mark the payout as completed (lock row to prevent concurrent updates).
  UPDATE payouts
  SET status      = 'completed',
      payout_date = CURRENT_DATE
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout % not found', p_payout_id;
  END IF;

  -- Step 2: Mark the matching payout transaction record as completed.
  UPDATE transactions
  SET status       = 'completed',
      completed_at = now()
  WHERE metadata->>'payout_id' = p_payout_id::text
    AND type                    = 'payout'
    AND status                 != 'completed';

  RETURN json_build_object('success', true, 'payout_id', p_payout_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- GRANT EXECUTE on new functions to authenticated role
-- ============================================================================

GRANT EXECUTE ON FUNCTION record_contribution_payment(TEXT, UUID, UUID, UUID, DECIMAL, TIMESTAMPTZ, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION record_payout_initiation(UUID, UUID, UUID, INTEGER, INTEGER, TEXT, TEXT)          TO authenticated;
GRANT EXECUTE ON FUNCTION complete_payout_transfer(UUID, TEXT)                                              TO authenticated;
