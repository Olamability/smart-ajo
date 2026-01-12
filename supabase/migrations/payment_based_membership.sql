-- ============================================================================
-- Migration: Payment-Based Membership System
-- ============================================================================
-- This migration implements a payment-first membership system where:
-- 1. Group creators must pay security deposit + first contribution to create group
-- 2. New members must pay security deposit + first contribution to join group
-- 3. Payment automatically grants membership (no admin approval needed)
-- 4. Join requests are replaced with direct join-via-payment flow
-- ============================================================================

-- ============================================================================
-- FUNCTION: Process group creation payment and activate creator membership
-- ============================================================================
-- Called after payment is verified to activate the creator as a member
-- ============================================================================

CREATE OR REPLACE FUNCTION process_group_creation_payment(
  p_payment_reference VARCHAR(255),
  p_group_id UUID,
  p_user_id UUID
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

  -- Calculate required amount (in kobo)
  v_required_amount := (v_contribution_amount + v_security_deposit_amount) * 100;

  -- Verify payment amount matches
  IF v_payment_amount < v_required_amount THEN
    RETURN QUERY SELECT FALSE, 
      'Payment amount insufficient. Expected: ₦' || (v_required_amount/100)::TEXT || 
      ', Received: ₦' || (v_payment_amount/100)::TEXT;
    RETURN;
  END IF;

  -- Check if user is already a member
  IF EXISTS (SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = p_user_id) THEN
    RETURN QUERY SELECT FALSE, 'User is already a member of this group'::TEXT;
    RETURN;
  END IF;

  -- Update member status to active and mark security deposit as paid
  UPDATE group_members
  SET 
    status = 'active',
    has_paid_security_deposit = TRUE,
    security_deposit_amount = v_security_deposit_amount,
    updated_at = NOW()
  WHERE group_id = p_group_id AND user_id = p_user_id;

  -- If no update happened, the creator wasn't added yet, so add them
  IF NOT FOUND THEN
    INSERT INTO group_members (
      group_id,
      user_id,
      position,
      status,
      has_paid_security_deposit,
      security_deposit_amount
    ) VALUES (
      p_group_id,
      p_user_id,
      1, -- Creator gets position 1
      'active',
      TRUE,
      v_security_deposit_amount
    );
  END IF;

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

  -- Create transaction record
  INSERT INTO transactions (
    user_id,
    group_id,
    type,
    amount,
    status,
    reference,
    description,
    created_at
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

  RETURN QUERY SELECT TRUE, 'Group creation payment processed successfully'::TEXT;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in process_group_creation_payment: %', SQLERRM;
    RETURN QUERY SELECT FALSE, 'An error occurred while processing payment'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION process_group_creation_payment IS 
  'Processes verified payment for group creation and activates creator as member';

GRANT EXECUTE ON FUNCTION process_group_creation_payment TO authenticated;

-- ============================================================================
-- FUNCTION: Process group join payment and add member
-- ============================================================================
-- Called after payment is verified to add the member to the group
-- No admin approval needed - payment validates membership
-- ============================================================================

CREATE OR REPLACE FUNCTION process_group_join_payment(
  p_payment_reference VARCHAR(255),
  p_group_id UUID,
  p_user_id UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT, "position" INTEGER) AS $$
DECLARE
  v_payment_verified BOOLEAN;
  v_payment_amount BIGINT;
  v_required_amount DECIMAL(15, 2);
  v_contribution_amount DECIMAL(15, 2);
  v_security_deposit_amount DECIMAL(15, 2);
  v_next_position INTEGER;
  v_total_members INTEGER;
  v_current_members INTEGER;
  v_group_status VARCHAR(20);
BEGIN
  -- Validate inputs
  IF p_payment_reference IS NULL OR p_group_id IS NULL OR p_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Invalid parameters'::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  -- Check if payment is verified
  SELECT verified, amount 
  INTO v_payment_verified, v_payment_amount
  FROM payments 
  WHERE reference = p_payment_reference AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Payment not found'::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  IF NOT v_payment_verified THEN
    RETURN QUERY SELECT FALSE, 'Payment not verified'::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  -- Get group details
  SELECT contribution_amount, security_deposit_amount, total_members, status
  INTO v_contribution_amount, v_security_deposit_amount, v_total_members, v_group_status
  FROM groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Group not found'::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  -- Check if group is still forming
  IF v_group_status != 'forming' THEN
    RETURN QUERY SELECT FALSE, 'Group is not accepting new members'::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  -- Calculate required amount (in kobo)
  v_required_amount := (v_contribution_amount + v_security_deposit_amount) * 100;

  -- Verify payment amount matches
  IF v_payment_amount < v_required_amount THEN
    RETURN QUERY SELECT FALSE, 
      'Payment amount insufficient. Expected: ₦' || (v_required_amount/100)::TEXT || 
      ', Received: ₦' || (v_payment_amount/100)::TEXT,
      0::INTEGER;
    RETURN;
  END IF;

  -- Check if user is already a member
  IF EXISTS (SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = p_user_id) THEN
    RETURN QUERY SELECT FALSE, 'User is already a member of this group'::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  -- Get current member count
  SELECT COUNT(*) INTO v_current_members
  FROM group_members
  WHERE group_id = p_group_id;

  -- Check if group is full
  IF v_current_members >= v_total_members THEN
    RETURN QUERY SELECT FALSE, 'Group is full'::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  -- Get next position
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_next_position
  FROM group_members
  WHERE group_id = p_group_id;

  -- Add user as active member
  INSERT INTO group_members (
    group_id,
    user_id,
    position,
    status,
    has_paid_security_deposit,
    security_deposit_amount
  ) VALUES (
    p_group_id,
    p_user_id,
    v_next_position,
    'active', -- Immediately active after payment
    TRUE,
    v_security_deposit_amount
  );

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
    NOW(),
    NOW(),
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
    created_at
  ) VALUES (
    p_user_id,
    p_group_id,
    'security_deposit',
    v_security_deposit_amount,
    'completed',
    p_payment_reference || '_SD',
    'Security deposit for joining group',
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

  -- Check if group is now full and should start
  v_current_members := v_current_members + 1;
  IF v_current_members >= v_total_members THEN
    UPDATE groups
    SET 
      status = 'active',
      start_date = NOW(),
      updated_at = NOW()
    WHERE id = p_group_id;
  END IF;

  RETURN QUERY SELECT TRUE, 'Successfully joined group'::TEXT, v_next_position;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in process_group_join_payment: %', SQLERRM;
    RETURN QUERY SELECT FALSE, 'An error occurred while processing payment'::TEXT, 0::INTEGER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION process_group_join_payment IS 
  'Processes verified payment for joining group and adds member automatically';

GRANT EXECUTE ON FUNCTION process_group_join_payment TO authenticated;

-- ============================================================================
-- Note: The old join request flow (request → approve → member) is still 
-- available for groups that prefer admin approval, but the new payment-based
-- flow bypasses this for immediate membership upon payment.
-- ============================================================================
