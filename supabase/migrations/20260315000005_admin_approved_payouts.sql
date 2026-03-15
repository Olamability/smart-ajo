-- Migration: Admin-Approved Payout Workflow
-- Date: 2026-03-15
-- Description:
--   Implements a mandatory admin-approval gate before any payout is
--   dispatched via Paystack.  Key changes:
--
--   1. Introduce payout_approval_status_enum to model the full approval
--      state machine:
--        pending → ready → approved → processing → completed → failed
--
--   2. Add approval_status, approved_by, and approved_at columns to the
--      payouts table.  Existing pending payouts are backfilled to 'ready'
--      (they were created after the cycle completed, so they are already
--      waiting for approval).
--
--   3. Replace check_cycle_and_prepare_payout so it inserts payouts with
--      approval_status = 'ready' instead of triggering auto-processing.
--
--   4. Add approve_payout(p_payout_id, p_admin_id) — an atomic RPC that
--      advances approval_status from 'ready' → 'approved'.  Only users
--      with is_admin = true may call it.
--
--   5. Add get_admin_payout_queue(p_approval_status) — an admin helper
--      that returns enriched payout rows for the admin dashboard queue.
--
-- UNIQUE constraint on (related_group_id, cycle_number) was already added
-- in migration 20260314000005_atomic_transaction_functions.sql.

-- ============================================================================
-- 1. APPROVAL STATUS ENUM
-- ============================================================================

CREATE TYPE payout_approval_status_enum AS ENUM (
  'pending',     -- payout record exists but cycle not yet finalised
  'ready',       -- all contributions received; awaiting admin approval
  'approved',    -- admin approved; eligible for Paystack transfer dispatch
  'processing',  -- Paystack transfer has been initiated
  'completed',   -- Paystack transfer confirmed successful
  'failed'       -- transfer permanently failed after retries
);

-- ============================================================================
-- 2. EXTEND payouts TABLE
-- ============================================================================

ALTER TABLE payouts
  ADD COLUMN approval_status payout_approval_status_enum NOT NULL DEFAULT 'pending',
  ADD COLUMN approved_by     UUID REFERENCES users(id),
  ADD COLUMN approved_at     TIMESTAMPTZ;

-- ============================================================================
-- 3. BACKFILL EXISTING ROWS
--    Any payout already in status = 'pending' was created by
--    check_cycle_and_prepare_payout after the cycle was complete, so it is
--    already 'ready' from a workflow perspective.
-- ============================================================================

UPDATE payouts
SET    approval_status = 'ready'
WHERE  status = 'pending';

-- ============================================================================
-- 4. INDEXES
-- ============================================================================

CREATE INDEX idx_payouts_approval_status
  ON payouts (approval_status);

CREATE INDEX idx_payouts_approval_queue
  ON payouts (approval_status, created_at)
  WHERE approval_status IN ('ready', 'approved');

-- ============================================================================
-- 5. UPDATE check_cycle_and_prepare_payout
--    Only change from the previous version (20260314000005): the INSERT now
--    sets approval_status = 'ready' so the payout is queued for admin review
--    rather than being picked up immediately by the payout-process function.
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

  -- Create the payout record.
  -- approval_status = 'ready' places it in the admin approval queue rather
  -- than allowing it to be picked up for automatic transfer dispatch.
  INSERT INTO payouts (
    related_group_id,
    recipient_id,
    cycle_number,
    amount,
    status,
    approval_status,
    payout_date,
    notes
  ) VALUES (
    p_group_id,
    v_recipient_id,
    p_cycle_number,
    v_net_payout,
    'pending',
    'ready',
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
-- 6. RPC: approve_payout
--    Advances a payout's approval_status from 'ready' → 'approved'.
--    Only users with is_admin = true may call this function.
--
--    Parameters:
--      p_payout_id  – UUID of the payouts row to approve
--      p_admin_id   – UUID of the approving admin user.  Defaults to
--                     auth.uid() for direct client calls; must be supplied
--                     explicitly when called from edge functions that use
--                     the service role key (where auth.uid() is NULL).
--
--    Returns JSON:
--      { "success": true,  "payout_id": "<uuid>" }
--      { "success": false, "error": "<message>" }
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_payout(
  p_payout_id UUID,
  p_admin_id  UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_admin_id               UUID;
  v_caller_is_admin        BOOLEAN;
  v_current_approval_status payout_approval_status_enum;
BEGIN
  -- Resolve admin ID: prefer explicit parameter, fall back to JWT claim.
  v_admin_id := COALESCE(p_admin_id, auth.uid());

  IF v_admin_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Admin identity could not be determined');
  END IF;

  -- Verify the caller holds admin privileges.
  SELECT is_admin
  INTO   v_caller_is_admin
  FROM   users
  WHERE  id = v_admin_id;

  IF NOT FOUND OR NOT v_caller_is_admin THEN
    RETURN json_build_object('success', false, 'error', 'Admin privileges required');
  END IF;

  -- Lock the payout row to serialise concurrent approval attempts.
  SELECT approval_status
  INTO   v_current_approval_status
  FROM   payouts
  WHERE  id = p_payout_id
  FOR    UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Payout not found');
  END IF;

  -- Only 'ready' payouts may be approved.
  IF v_current_approval_status != 'ready' THEN
    RETURN json_build_object(
      'success', false,
      'error', format(
        'Cannot approve payout with approval_status ''%s'' (expected ''ready'')',
        v_current_approval_status
      )
    );
  END IF;

  -- Advance to approved.
  UPDATE payouts
  SET    approval_status = 'approved',
         approved_by     = v_admin_id,
         approved_at     = now()
  WHERE  id = p_payout_id;

  RETURN json_build_object('success', true, 'payout_id', p_payout_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION approve_payout(UUID, UUID) TO authenticated;

-- ============================================================================
-- 7. ADMIN QUERY: get_admin_payout_queue
--    Returns enriched payout rows for the admin dashboard queue, filtered
--    by approval_status.  Defaults to 'ready' (pending admin approval).
--
--    Called by the admin dashboard to list payouts needing action.
--
--    Parameters:
--      p_approval_status – filter value (default 'ready')
--
--    Returns table:
--      payout_id, group_id, group_name, recipient_id, recipient_name,
--      recipient_email, amount, cycle_number, status, approval_status,
--      created_at, approved_at, approved_by_name
-- ============================================================================

CREATE OR REPLACE FUNCTION get_admin_payout_queue(
  p_approval_status payout_approval_status_enum DEFAULT 'ready'
)
RETURNS TABLE (
  payout_id        UUID,
  group_id         UUID,
  group_name       TEXT,
  recipient_id     UUID,
  recipient_name   TEXT,
  recipient_email  TEXT,
  amount           DECIMAL(15, 2),
  cycle_number     INTEGER,
  status           payout_status_enum,
  approval_status  payout_approval_status_enum,
  created_at       TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  approved_by_name TEXT
) AS $$
BEGIN
  -- Only admins may query this function.
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin privileges required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT
      p.id                  AS payout_id,
      p.related_group_id    AS group_id,
      g.name                AS group_name,
      p.recipient_id,
      u.full_name           AS recipient_name,
      u.email               AS recipient_email,
      p.amount,
      p.cycle_number,
      p.status,
      p.approval_status,
      p.created_at,
      p.approved_at,
      ab.full_name          AS approved_by_name
    FROM   payouts       p
    JOIN   groups        g  ON g.id  = p.related_group_id
    JOIN   users         u  ON u.id  = p.recipient_id
    LEFT JOIN users      ab ON ab.id = p.approved_by
    WHERE  p.approval_status = p_approval_status
    ORDER  BY p.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_admin_payout_queue(payout_approval_status_enum) TO authenticated;
