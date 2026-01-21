-- ============================================================================
-- Migration: Fix double-counting in process_group_creation_payment
-- ============================================================================
-- Removes the manual current_members increment from process_group_creation_payment
-- since the update_group_member_count trigger already handles it automatically
-- when a member is inserted into group_members.
--
-- This fixes the issue where member count shows 3/10 instead of 1/10 after
-- group creation because:
-- 1. auto_add_creator_as_member trigger adds creator (count: 0 -> 1)
-- 2. update_group_member_count trigger increments (already happened in step 1)
-- 3. process_group_creation_payment manually increments again (count: 1 -> 2)
-- ============================================================================

-- Drop old function signatures to avoid conflicts
DROP FUNCTION IF EXISTS process_group_creation_payment(VARCHAR, UUID, UUID);
DROP FUNCTION IF EXISTS process_group_creation_payment(VARCHAR, UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION process_group_creation_payment(
  p_payment_reference VARCHAR(255),
  p_group_id UUID,
  p_user_id UUID,
  p_preferred_slot INTEGER DEFAULT 1
)
RETURNS TABLE(success BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_payment_verified BOOLEAN;
  v_payment_amount BIGINT;
  v_required_amount DECIMAL(15, 2);
  v_contribution_amount DECIMAL(15, 2);
  v_security_deposit_amount DECIMAL(15, 2);
BEGIN
  -- Validate inputs
  IF p_payment_reference IS NULL OR p_group_id IS NULL OR p_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Invalid parameters'::TEXT;
    RETURN;
  END IF;

  -- Check if payment is verified
  SELECT verified, amount 
  INTO v_payment_verified, v_payment_amount
  FROM payments 
  WHERE reference = p_payment_reference AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Payment not found'::TEXT;
    RETURN;
  END IF;

  IF NOT v_payment_verified THEN
    RETURN QUERY SELECT FALSE, 'Payment not verified'::TEXT;
    RETURN;
  END IF;

  -- Get group amounts
  SELECT contribution_amount, security_deposit_amount
  INTO v_contribution_amount, v_security_deposit_amount
  FROM groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Group not found'::TEXT;
    RETURN;
  END IF;

  -- Calculate required amount in kobo (100 kobo = 1 NGN)
  v_required_amount := (v_contribution_amount + v_security_deposit_amount) * 100;

  -- Verify payment amount matches
  IF v_payment_amount < v_required_amount THEN
    RETURN QUERY SELECT FALSE, 
      'Payment amount insufficient. Expected: ₦' || (v_required_amount/100.0)::TEXT || 
      ', Received: ₦' || (v_payment_amount/100.0)::TEXT;
    RETURN;
  END IF;

  -- Check if user is already a member
  IF EXISTS (SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = p_user_id) THEN
    RETURN QUERY SELECT FALSE, 'User is already a member of this group'::TEXT;
    RETURN;
  END IF;

  -- Add creator as member with selected slot position
  INSERT INTO group_members (
    group_id,
    user_id,
    position,
    status,
    has_paid_security_deposit,
    security_deposit_amount,
    security_deposit_paid_at,
    is_creator
  ) VALUES (
    p_group_id,
    p_user_id,
    p_preferred_slot,
    'active',
    TRUE,
    v_security_deposit_amount,
    NOW(),
    TRUE
  );

  -- NOTE: The update_group_member_count trigger will automatically increment current_members
  -- No need to manually update it here to avoid double-counting

  -- Create the first contribution record
  INSERT INTO contributions (
    group_id,
    user_id,
    amount,
    cycle_number,
    status,
    due_date,
    paid_date,
    transaction_ref
  ) VALUES (
    p_group_id,
    p_user_id,
    v_contribution_amount,
    1, -- First cycle
    'paid',
    NOW(), -- Due now
    NOW(), -- Paid now
    p_payment_reference
  );

  -- Create transaction records
  INSERT INTO transactions (
    user_id,
    group_id,
    type,
    amount,
    status,
    reference,
    description,
    completed_at
  ) VALUES (
    p_user_id,
    p_group_id,
    'security_deposit',
    v_security_deposit_amount,
    'completed',
    p_payment_reference || '_SD',
    'Security deposit for group creation',
    NOW()
  ), (
    p_user_id,
    p_group_id,
    'contribution',
    v_contribution_amount,
    'completed',
    p_payment_reference || '_C1',
    'First contribution payment',
    NOW()
  );

  -- No manual current_members increment - the trigger handles it!

  RETURN QUERY SELECT TRUE, 'Group creation payment processed successfully'::TEXT;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in process_group_creation_payment: %', SQLERRM;
    RETURN QUERY SELECT FALSE, 'An error occurred while processing payment'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION process_group_creation_payment IS 
  'Processes verified payment for group creation and activates creator as member with selected slot. Trigger handles member count increment.';

GRANT EXECUTE ON FUNCTION process_group_creation_payment TO authenticated;
