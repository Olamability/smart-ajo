-- Migration: Phase 2 – Atomic Payment & Contribution Engine
-- Date: 2026-03-14
-- Description:
--   Adds the schema changes required by the Phase 2 edge functions:
--   1. Extend join_request_status_enum with 'paid'
--   2. Add payment_completed_at column to group_join_requests
--   3. Add check_cycle_and_prepare_payout RPC
--   4. Add send_payment_notification helper RPC
--   5. Add send_payout_ready_notifications helper RPC

-- ============================================================================
-- 1. EXTEND join_request_status_enum WITH 'paid'
-- ============================================================================

-- PostgreSQL does not support removing values from enums, but adding is safe.
ALTER TYPE join_request_status_enum ADD VALUE IF NOT EXISTS 'paid';

-- ============================================================================
-- 1b. EXTEND notification_type_enum WITH 'payment_failed'
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'payment_failed';

-- ============================================================================
-- 2. ADD payment_completed_at TO group_join_requests
-- ============================================================================

ALTER TABLE group_join_requests
  ADD COLUMN IF NOT EXISTS payment_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN group_join_requests.payment_completed_at
  IS 'Timestamp when the join-fee / security-deposit payment was confirmed';

-- ============================================================================
-- 3. RPC: check_cycle_and_prepare_payout
-- Checks whether all members have contributed for a given cycle and, if so,
-- creates a pending payout record for the correct recipient.
-- Called by the verify-contribution / paystack-webhook edge functions.
-- ============================================================================
CREATE OR REPLACE FUNCTION check_cycle_and_prepare_payout(
  p_group_id    UUID,
  p_cycle_number INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_total_members     INTEGER;
  v_paid_count        INTEGER;
  v_contribution_amount DECIMAL(15, 2);
  v_recipient_id      UUID;
  v_payout_exists     BOOLEAN;
  v_group_status      group_status_enum;
BEGIN
  -- Fetch group configuration
  SELECT total_members, contribution_amount, status
  INTO v_total_members, v_contribution_amount, v_group_status
  FROM groups
  WHERE id = p_group_id;

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

  -- Create the payout record
  INSERT INTO payouts (
    related_group_id,
    recipient_id,
    cycle_number,
    amount,
    status,
    payout_date
  ) VALUES (
    p_group_id,
    v_recipient_id,
    p_cycle_number,
    v_contribution_amount * v_total_members,
    'pending',
    CURRENT_DATE
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
    'cycle_number', p_cycle_number
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. RPC: send_payment_notification
-- Inserts a single notification for a user (payment success / failure).
-- ============================================================================
CREATE OR REPLACE FUNCTION send_payment_notification(
  p_user_id UUID,
  p_type    notification_type_enum,
  p_title   TEXT,
  p_message TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, message, metadata)
  VALUES (p_user_id, p_type, p_title, p_message, p_metadata);
EXCEPTION
  WHEN OTHERS THEN
    -- Notification failures must never break the payment flow
    RAISE WARNING 'send_payment_notification failed for user %: %', p_user_id, SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. RPC: send_payout_ready_notifications
-- Notifies all active members of a group that the payout cycle is ready.
-- ============================================================================
CREATE OR REPLACE FUNCTION send_payout_ready_notifications(
  p_group_id     UUID,
  p_cycle_number INTEGER,
  p_recipient_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_group_name TEXT;
  v_member     RECORD;
BEGIN
  SELECT name INTO v_group_name FROM groups WHERE id = p_group_id;

  FOR v_member IN
    SELECT user_id FROM group_members
    WHERE group_id = p_group_id AND status = 'active'
  LOOP
    IF v_member.user_id = p_recipient_id THEN
      INSERT INTO notifications (user_id, type, title, message, metadata)
      VALUES (
        v_member.user_id,
        'payout_ready',
        'Your payout is ready!',
        'All members have contributed for cycle ' || p_cycle_number
          || ' of ' || COALESCE(v_group_name, 'your group')
          || '. Your payout is being processed.',
        jsonb_build_object(
          'group_id', p_group_id,
          'cycle_number', p_cycle_number
        )
      );
    ELSE
      INSERT INTO notifications (user_id, type, title, message, metadata)
      VALUES (
        v_member.user_id,
        'payout_ready',
        'Payout cycle ' || p_cycle_number || ' complete',
        'All contributions for cycle ' || p_cycle_number
          || ' of ' || COALESCE(v_group_name, 'your group')
          || ' have been received. The payout is being processed.',
        jsonb_build_object(
          'group_id', p_group_id,
          'cycle_number', p_cycle_number
        )
      );
    END IF;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'send_payout_ready_notifications failed for group %: %', p_group_id, SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- GRANT EXECUTE permissions to authenticated role (edge functions use
-- service role which bypasses RLS, so these are mainly for future use)
-- ============================================================================
GRANT EXECUTE ON FUNCTION check_cycle_and_prepare_payout(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION send_payment_notification(UUID, notification_type_enum, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION send_payout_ready_notifications(UUID, INTEGER, UUID) TO authenticated;
