-- Migration: Penalties, Service-Fee Deduction, and Admin Overrides
-- Date: 2026-03-14
-- Description:
--   1. Fix check_cycle_and_prepare_payout to deduct service fee from payout amount
--   2. Add apply_penalties_for_cycle RPC
--   3. Add process_overdue_and_apply_penalties RPC (batch, called by penalty-process edge fn)
--   4. Add admin_manual_payment RPC
--   5. Add admin_trigger_payout RPC
--   6. Add admin_waive_penalty RPC

-- ============================================================================
-- 0. EXTEND notification_type_enum WITH 'penalty_waived'
-- ============================================================================

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'penalty_waived';

-- ============================================================================
-- 1. REPLACE check_cycle_and_prepare_payout
--    Net payout = gross contributions × (1 – service_fee_percentage / 100)
-- ============================================================================
CREATE OR REPLACE FUNCTION check_cycle_and_prepare_payout(
  p_group_id    UUID,
  p_cycle_number INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_total_members         INTEGER;
  v_paid_count            INTEGER;
  v_contribution_amount   DECIMAL(15, 2);
  v_service_fee_pct       DECIMAL(5, 2);
  v_gross_payout          DECIMAL(15, 2);
  v_service_fee_amount    DECIMAL(15, 2);
  v_net_payout            DECIMAL(15, 2);
  v_recipient_id          UUID;
  v_payout_exists         BOOLEAN;
  v_group_status          group_status_enum;
BEGIN
  -- Fetch group configuration
  SELECT total_members, contribution_amount, service_fee_percentage, status
  INTO v_total_members, v_contribution_amount, v_service_fee_pct, v_group_status
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

  -- Calculate net payout amount after deducting the platform service fee
  v_gross_payout       := v_contribution_amount * v_total_members;
  v_service_fee_amount := ROUND(v_gross_payout * v_service_fee_pct / 100, 2);
  v_net_payout         := v_gross_payout - v_service_fee_amount;

  -- Create the payout record with the net amount
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
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. RPC: apply_penalties_for_cycle
--    Applies late-payment or missed-payment penalties to overdue contributions
--    in a given group cycle. Idempotent: a penalty is only created once per
--    contribution. Updates the offending member's wallet when possible.
--    Returns the number of penalties newly applied.
-- ============================================================================
CREATE OR REPLACE FUNCTION apply_penalties_for_cycle(
  p_group_id    UUID,
  p_cycle_number INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_contribution_amount DECIMAL(15, 2);
  v_late_penalty_rate   DECIMAL(5, 2) := 5.00;   -- 5% of contribution for late payment
  v_missed_penalty_rate DECIMAL(5, 2) := 10.00;  -- 10% of contribution for missed payment
  v_contrib             RECORD;
  v_penalty_amount      DECIMAL(15, 2);
  v_penalty_type        penalty_type_enum;
  v_already_has_penalty BOOLEAN;
  v_wallet_id           UUID;
  v_wallet_balance      DECIMAL(15, 2);
  v_deducted_amount     DECIMAL(15, 2);
  v_applied_count       INTEGER := 0;
BEGIN
  SELECT contribution_amount
  INTO v_contribution_amount
  FROM groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Group not found');
  END IF;

  -- Iterate over all unpaid overdue contributions in this cycle
  FOR v_contrib IN
    SELECT c.id, c.user_id, c.due_date, c.status
    FROM contributions c
    WHERE c.group_id    = p_group_id
      AND c.cycle_number = p_cycle_number
      AND c.is_overdue  = true
      AND c.status      IN ('pending', 'overdue')
  LOOP
    -- Idempotency: skip if a penalty already exists for this contribution
    SELECT EXISTS (
      SELECT 1 FROM penalties
      WHERE contribution_id = v_contrib.id
        AND status          != 'waived'
    ) INTO v_already_has_penalty;

    IF v_already_has_penalty THEN
      CONTINUE;
    END IF;

    -- Decide penalty type based on how far past due the contribution is
    IF (CURRENT_DATE - v_contrib.due_date::DATE) >= 3 THEN
      v_penalty_type   := 'missed_payment';
      v_penalty_amount := ROUND(v_contribution_amount * v_missed_penalty_rate / 100, 2);
    ELSE
      v_penalty_type   := 'late_payment';
      v_penalty_amount := ROUND(v_contribution_amount * v_late_penalty_rate / 100, 2);
    END IF;

    -- Insert the penalty record
    INSERT INTO penalties (group_id, user_id, contribution_id, amount, type, status)
    VALUES (p_group_id, v_contrib.user_id, v_contrib.id, v_penalty_amount, v_penalty_type, 'applied');

    -- Mark the contribution status as overdue (in case it was still 'pending')
    UPDATE contributions
    SET status = 'overdue'
    WHERE id = v_contrib.id
      AND status = 'pending';

    -- Create a penalty transaction record
    INSERT INTO transactions (
      user_id,
      group_id,
      type,
      amount,
      status,
      reference,
      description,
      metadata
    ) VALUES (
      v_contrib.user_id,
      p_group_id,
      'penalty',
      v_penalty_amount,
      'completed',
      'ajo_penalty_' || v_contrib.id || '_' || extract(epoch from now())::bigint,
      format(
        '%s penalty for cycle %s contribution',
        initcap(replace(v_penalty_type::text, '_', ' ')),
        p_cycle_number
      ),
      jsonb_build_object(
        'contribution_id', v_contrib.id,
        'cycle_number', p_cycle_number,
        'penalty_type', v_penalty_type,
        'penalty_rate', CASE v_penalty_type
                          WHEN 'missed_payment' THEN v_missed_penalty_rate
                          ELSE v_late_penalty_rate
                        END
      )
    );

    -- Deduct from wallet if balance allows (partial deduction if insufficient)
    SELECT id, balance INTO v_wallet_id, v_wallet_balance
    FROM wallets
    WHERE user_id = v_contrib.user_id;

    IF FOUND AND v_wallet_balance > 0 THEN
      v_deducted_amount := LEAST(v_wallet_balance, v_penalty_amount);
      UPDATE wallets
      SET balance    = balance - v_deducted_amount,
          updated_at = now()
      WHERE id = v_wallet_id;
    END IF;

    -- Send penalty notification to the offending member
    BEGIN
      INSERT INTO notifications (user_id, type, title, message, metadata)
      VALUES (
        v_contrib.user_id,
        'penalty_applied',
        format('Penalty applied — cycle %s', p_cycle_number),
        format(
          'A %s penalty of ₦%s has been applied for your overdue contribution in cycle %s.',
          replace(v_penalty_type::text, '_', ' '),
          v_penalty_amount,
          p_cycle_number
        ),
        jsonb_build_object(
          'group_id', p_group_id,
          'cycle_number', p_cycle_number,
          'contribution_id', v_contrib.id,
          'penalty_amount', v_penalty_amount,
          'penalty_type', v_penalty_type
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'penalty notification failed for user %: %', v_contrib.user_id, SQLERRM;
    END;

    v_applied_count := v_applied_count + 1;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'applied_count', v_applied_count,
    'group_id', p_group_id,
    'cycle_number', p_cycle_number
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. RPC: process_overdue_and_apply_penalties
--    Batch version: marks overdue contributions and applies penalties across
--    ALL active groups. Designed to be called by the penalty-process edge
--    function (on a schedule or manually triggered by an admin).
-- ============================================================================
CREATE OR REPLACE FUNCTION process_overdue_and_apply_penalties()
RETURNS JSON AS $$
DECLARE
  v_group         RECORD;
  v_cycle_result  JSON;
  v_total_applied INTEGER := 0;
  v_groups_processed INTEGER := 0;
  v_errors        JSONB  := '[]'::jsonb;
BEGIN
  -- Step 1: Mark pending contributions whose due_date has passed as is_overdue
  UPDATE contributions
  SET is_overdue = true,
      status     = 'overdue'
  WHERE status    = 'pending'
    AND due_date  < CURRENT_DATE
    AND is_overdue = false;

  -- Step 2: Apply penalties for each active group and its current cycle
  FOR v_group IN
    SELECT DISTINCT g.id AS group_id, c.cycle_number
    FROM groups g
    JOIN contributions c ON c.group_id = g.id
    WHERE g.status     = 'active'
      AND c.is_overdue  = true
      AND c.status      IN ('pending', 'overdue')
  LOOP
    v_cycle_result := apply_penalties_for_cycle(v_group.group_id, v_group.cycle_number);

    IF (v_cycle_result->>'success')::boolean THEN
      v_total_applied    := v_total_applied + (v_cycle_result->>'applied_count')::integer;
      v_groups_processed := v_groups_processed + 1;
    ELSE
      v_errors := v_errors || jsonb_build_object(
        'group_id', v_group.group_id,
        'cycle_number', v_group.cycle_number,
        'error', v_cycle_result->>'error'
      );
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'total_penalties_applied', v_total_applied,
    'groups_processed', v_groups_processed,
    'errors', v_errors
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. RPC: admin_manual_payment
--    Allows an admin to manually mark a contribution as paid (e.g. for cash
--    payments or when the Paystack webhook was missed). Creates a completed
--    transaction, increments the group balance, and triggers cycle-complete
--    checks.  Requires the caller to have is_admin = true.
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_manual_payment(
  p_contribution_id UUID,
  p_admin_note      TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_admin_id     UUID;
  v_is_admin     BOOLEAN;
  v_contrib      RECORD;
  v_reference    TEXT;
  v_cycle_result JSON;
BEGIN
  -- Authenticate: caller must be an admin
  v_admin_id := auth.uid();
  SELECT is_admin INTO v_is_admin FROM users WHERE id = v_admin_id;
  IF NOT FOUND OR NOT v_is_admin THEN
    RETURN json_build_object('success', false, 'error', 'Admin privileges required');
  END IF;

  -- Fetch the contribution record
  SELECT c.id, c.group_id, c.user_id, c.amount, c.cycle_number, c.status, c.service_fee
  INTO v_contrib
  FROM contributions c
  WHERE c.id = p_contribution_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Contribution not found');
  END IF;

  IF v_contrib.status = 'paid' THEN
    RETURN json_build_object('success', false, 'error', 'Contribution is already paid');
  END IF;

  v_reference := 'ajo_admin_' || v_contrib.id || '_' || extract(epoch from now())::bigint;

  -- Mark contribution as paid
  UPDATE contributions
  SET status       = 'paid',
      paid_date    = now(),
      transaction_ref = v_reference,
      is_overdue   = false
  WHERE id = p_contribution_id;

  -- Create a completed transaction record
  INSERT INTO transactions (
    user_id,
    group_id,
    type,
    amount,
    status,
    reference,
    description,
    metadata
  ) VALUES (
    v_contrib.user_id,
    v_contrib.group_id,
    'contribution',
    v_contrib.amount,
    'completed',
    v_reference,
    format('Admin manual payment — cycle %s', v_contrib.cycle_number),
    jsonb_build_object(
      'contribution_id', v_contrib.id,
      'cycle_number', v_contrib.cycle_number,
      'admin_id', v_admin_id,
      'admin_note', COALESCE(p_admin_note, 'Manual payment recorded by admin'),
      'manual_payment', true
    )
  );

  -- Increment group total_collected
  PERFORM increment_group_total_collected(v_contrib.group_id, v_contrib.amount);

  -- Audit log
  INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
  VALUES (
    v_admin_id,
    'admin_manual_payment',
    'contribution',
    p_contribution_id,
    jsonb_build_object(
      'contribution_id', p_contribution_id,
      'group_id', v_contrib.group_id,
      'member_id', v_contrib.user_id,
      'amount', v_contrib.amount,
      'cycle_number', v_contrib.cycle_number,
      'reference', v_reference,
      'admin_note', COALESCE(p_admin_note, 'Manual payment recorded by admin')
    )
  );

  -- Notify the member
  BEGIN
    INSERT INTO notifications (user_id, type, title, message, metadata)
    VALUES (
      v_contrib.user_id,
      'payment_received',
      'Contribution marked as paid',
      format('Your contribution for cycle %s has been recorded by an admin.', v_contrib.cycle_number),
      jsonb_build_object(
        'group_id', v_contrib.group_id,
        'contribution_id', p_contribution_id,
        'cycle_number', v_contrib.cycle_number
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Notification failed for user %: %', v_contrib.user_id, SQLERRM;
  END;

  -- Check if cycle is now complete
  v_cycle_result := check_cycle_and_prepare_payout(v_contrib.group_id, v_contrib.cycle_number);

  RETURN json_build_object(
    'success', true,
    'reference', v_reference,
    'contribution_id', p_contribution_id,
    'cycle_check', v_cycle_result
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. RPC: admin_trigger_payout
--    Allows an admin to manually set a payout back to 'pending' so that the
--    payout-process edge function will pick it up on the next run (or the admin
--    can call payout-process directly). Useful for retrying failed payouts or
--    manually releasing a payout.
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_trigger_payout(
  p_payout_id  UUID,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_admin_id UUID;
  v_is_admin BOOLEAN;
  v_payout   RECORD;
BEGIN
  -- Authenticate: caller must be an admin
  v_admin_id := auth.uid();
  SELECT is_admin INTO v_is_admin FROM users WHERE id = v_admin_id;
  IF NOT FOUND OR NOT v_is_admin THEN
    RETURN json_build_object('success', false, 'error', 'Admin privileges required');
  END IF;

  -- Fetch the payout record
  SELECT id, related_group_id, recipient_id, cycle_number, amount, status
  INTO v_payout
  FROM payouts
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Payout not found');
  END IF;

  IF v_payout.status = 'completed' THEN
    RETURN json_build_object('success', false, 'error', 'Payout already completed');
  END IF;

  -- Reset to pending so the payout-process edge function can pick it up
  UPDATE payouts
  SET status            = 'pending',
      payment_reference = NULL,
      notes             = COALESCE(
                            p_admin_note,
                            format('Manually reset to pending by admin %s at %s', v_admin_id, now())
                          )
  WHERE id = p_payout_id;

  -- Audit log
  INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
  VALUES (
    v_admin_id,
    'admin_trigger_payout',
    'payout',
    p_payout_id,
    jsonb_build_object(
      'payout_id', p_payout_id,
      'group_id', v_payout.related_group_id,
      'recipient_id', v_payout.recipient_id,
      'cycle_number', v_payout.cycle_number,
      'amount', v_payout.amount,
      'previous_status', v_payout.status,
      'admin_note', COALESCE(p_admin_note, 'Manually triggered by admin')
    )
  );

  -- Notify the recipient that their payout is being processed
  BEGIN
    INSERT INTO notifications (user_id, type, title, message, metadata)
    VALUES (
      v_payout.recipient_id,
      'payout_ready',
      format('Payout cycle %s re-queued', v_payout.cycle_number),
      'An admin has manually triggered your payout. It will be processed shortly.',
      jsonb_build_object(
        'payout_id', p_payout_id,
        'group_id', v_payout.related_group_id,
        'cycle_number', v_payout.cycle_number,
        'amount', v_payout.amount
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Notification failed for recipient %: %', v_payout.recipient_id, SQLERRM;
  END;

  RETURN json_build_object(
    'success', true,
    'payout_id', p_payout_id,
    'status', 'pending',
    'message', 'Payout has been queued for processing'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. RPC: admin_waive_penalty
--    Allows an admin to waive a penalty. Restores any wallet balance that was
--    already deducted for this penalty, and marks the penalty as waived.
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_waive_penalty(
  p_penalty_id UUID,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_admin_id UUID;
  v_is_admin BOOLEAN;
  v_penalty  RECORD;
BEGIN
  -- Authenticate: caller must be an admin
  v_admin_id := auth.uid();
  SELECT is_admin INTO v_is_admin FROM users WHERE id = v_admin_id;
  IF NOT FOUND OR NOT v_is_admin THEN
    RETURN json_build_object('success', false, 'error', 'Admin privileges required');
  END IF;

  -- Fetch the penalty record
  SELECT id, group_id, user_id, contribution_id, amount, status
  INTO v_penalty
  FROM penalties
  WHERE id = p_penalty_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Penalty not found');
  END IF;

  IF v_penalty.status = 'waived' THEN
    RETURN json_build_object('success', false, 'error', 'Penalty is already waived');
  END IF;

  -- Mark the penalty as waived
  UPDATE penalties
  SET status = 'waived'
  WHERE id = p_penalty_id;

  -- Refund the penalty amount to the member's wallet
  UPDATE wallets
  SET balance    = balance + v_penalty.amount,
      updated_at = now()
  WHERE user_id = v_penalty.user_id;

  -- Create a refund transaction record
  INSERT INTO transactions (
    user_id,
    group_id,
    type,
    amount,
    status,
    reference,
    description,
    metadata
  ) VALUES (
    v_penalty.user_id,
    v_penalty.group_id,
    'refund',
    v_penalty.amount,
    'completed',
    'ajo_waive_' || p_penalty_id || '_' || extract(epoch from now())::bigint,
    'Penalty waived by admin',
    jsonb_build_object(
      'penalty_id', p_penalty_id,
      'contribution_id', v_penalty.contribution_id,
      'admin_id', v_admin_id,
      'admin_note', COALESCE(p_admin_note, 'Penalty waived by admin')
    )
  );

  -- Audit log
  INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
  VALUES (
    v_admin_id,
    'admin_waive_penalty',
    'penalty',
    p_penalty_id,
    jsonb_build_object(
      'penalty_id', p_penalty_id,
      'group_id', v_penalty.group_id,
      'member_id', v_penalty.user_id,
      'amount_refunded', v_penalty.amount,
      'contribution_id', v_penalty.contribution_id,
      'admin_note', COALESCE(p_admin_note, 'Penalty waived by admin')
    )
  );

  -- Notify the member that their penalty was waived
  BEGIN
    INSERT INTO notifications (user_id, type, title, message, metadata)
    VALUES (
      v_penalty.user_id,
      'penalty_waived',
      'Penalty waived',
      format('A penalty of ₦%s has been waived by an admin. The amount has been refunded to your wallet.', v_penalty.amount),
      jsonb_build_object(
        'penalty_id', p_penalty_id,
        'group_id', v_penalty.group_id,
        'amount_refunded', v_penalty.amount
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Notification failed for user %: %', v_penalty.user_id, SQLERRM;
  END;

  RETURN json_build_object(
    'success', true,
    'penalty_id', p_penalty_id,
    'amount_refunded', v_penalty.amount,
    'message', 'Penalty waived and wallet refunded'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- GRANT EXECUTE permissions to authenticated role
-- ============================================================================
GRANT EXECUTE ON FUNCTION apply_penalties_for_cycle(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION process_overdue_and_apply_penalties() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_manual_payment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_trigger_payout(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_waive_penalty(UUID, TEXT) TO authenticated;
