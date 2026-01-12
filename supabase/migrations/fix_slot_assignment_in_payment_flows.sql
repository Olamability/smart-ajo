-- ============================================================================
-- Migration: Fix Slot Assignment in Payment Flows
-- ============================================================================
-- This migration updates the payment processing functions to properly handle
-- slot selection and assignment:
-- 1. Creator selects slot after payment
-- 2. Join requests include preferred slot
-- 3. Approved members get their preferred slot after payment
-- ============================================================================

-- ============================================================================
-- UPDATED FUNCTION: Process group creation payment with slot selection
-- ============================================================================

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
  v_slot_status VARCHAR(20);
BEGIN
  -- Validate inputs
  IF p_payment_reference IS NULL OR p_group_id IS NULL OR p_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Invalid parameters'::TEXT;
    RETURN;
  END IF;

  -- Validate slot number
  IF p_preferred_slot < 1 THEN
    RETURN QUERY SELECT FALSE, 'Invalid slot number'::TEXT;
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

  -- Check if requested slot is available
  SELECT status INTO v_slot_status
  FROM group_payout_slots
  WHERE group_id = p_group_id AND slot_number = p_preferred_slot;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Invalid slot number for this group'::TEXT;
    RETURN;
  END IF;

  IF v_slot_status != 'available' THEN
    RETURN QUERY SELECT FALSE, 'Selected slot is not available. Please choose another slot.'::TEXT;
    RETURN;
  END IF;

  -- Add creator as member with selected slot position
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
    p_preferred_slot,
    'active',
    TRUE,
    v_security_deposit_amount
  );

  -- Assign the slot to the creator
  UPDATE group_payout_slots
  SET 
    status = 'assigned',
    assigned_to = p_user_id,
    assigned_at = NOW(),
    updated_at = NOW()
  WHERE group_id = p_group_id AND slot_number = p_preferred_slot;

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
  'Processes verified payment for group creation and activates creator as member with selected slot';

-- ============================================================================
-- UPDATED FUNCTION: Process approved join payment with slot assignment
-- ============================================================================

CREATE OR REPLACE FUNCTION process_approved_join_payment(
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
  v_preferred_slot INTEGER;
  v_slot_status VARCHAR(20);
  v_total_members INTEGER;
  v_current_members INTEGER;
  v_group_status VARCHAR(20);
  v_join_request_status VARCHAR(20);
BEGIN
  -- Validate inputs
  IF p_payment_reference IS NULL OR p_group_id IS NULL OR p_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Invalid parameters'::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  -- Check if user has an approved join request and get preferred slot
  SELECT status, preferred_slot INTO v_join_request_status, v_preferred_slot
  FROM group_join_requests
  WHERE group_id = p_group_id AND user_id = p_user_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_join_request_status IS NULL THEN
    RETURN QUERY SELECT FALSE, 'No join request found for this user'::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  IF v_join_request_status != 'approved' THEN
    RETURN QUERY SELECT FALSE, 'Join request must be approved before payment'::TEXT, 0::INTEGER;
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

  -- If preferred slot is specified, validate and use it
  IF v_preferred_slot IS NOT NULL THEN
    -- Check if requested slot is available
    SELECT status INTO v_slot_status
    FROM group_payout_slots
    WHERE group_id = p_group_id AND slot_number = v_preferred_slot;

    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, 'Invalid slot number for this group'::TEXT, 0::INTEGER;
      RETURN;
    END IF;

    -- If slot was reserved for this user, it's available; otherwise check if available
    IF v_slot_status = 'reserved' THEN
      -- Check if reserved for this user
      IF NOT EXISTS (
        SELECT 1 FROM group_payout_slots
        WHERE group_id = p_group_id AND slot_number = v_preferred_slot AND reserved_by = p_user_id
      ) THEN
        RETURN QUERY SELECT FALSE, 'Selected slot is reserved by another user'::TEXT, 0::INTEGER;
        RETURN;
      END IF;
    ELSIF v_slot_status != 'available' THEN
      RETURN QUERY SELECT FALSE, 'Selected slot is not available. Please choose another slot.'::TEXT, 0::INTEGER;
      RETURN;
    END IF;

    -- Add user as active member with preferred slot position
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
      v_preferred_slot,
      'active',
      TRUE,
      v_security_deposit_amount
    );

    -- Assign the slot to the user
    UPDATE group_payout_slots
    SET 
      status = 'assigned',
      assigned_to = p_user_id,
      assigned_at = NOW(),
      reserved_by = NULL,
      reserved_at = NULL,
      updated_at = NOW()
    WHERE group_id = p_group_id AND slot_number = v_preferred_slot;

  ELSE
    -- No preferred slot specified, assign next available slot
    SELECT slot_number INTO v_preferred_slot
    FROM group_payout_slots
    WHERE group_id = p_group_id AND status = 'available'
    ORDER BY slot_number ASC
    LIMIT 1;

    IF v_preferred_slot IS NULL THEN
      RETURN QUERY SELECT FALSE, 'No available slots'::TEXT, 0::INTEGER;
      RETURN;
    END IF;

    -- Add user as active member with next available slot
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
      v_preferred_slot,
      'active',
      TRUE,
      v_security_deposit_amount
    );

    -- Assign the slot to the user
    UPDATE group_payout_slots
    SET 
      status = 'assigned',
      assigned_to = p_user_id,
      assigned_at = NOW(),
      updated_at = NOW()
    WHERE group_id = p_group_id AND slot_number = v_preferred_slot;
  END IF;

  -- Mark join request as completed
  UPDATE group_join_requests
  SET 
    status = 'completed',
    updated_at = NOW()
  WHERE group_id = p_group_id AND user_id = p_user_id AND status = 'approved';

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

  RETURN QUERY SELECT TRUE, 'Successfully joined group'::TEXT, v_preferred_slot;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in process_approved_join_payment: %', SQLERRM;
    RETURN QUERY SELECT FALSE, 'An error occurred while processing payment'::TEXT, 0::INTEGER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION process_approved_join_payment IS 
  'Processes verified payment for an approved join request and adds member with preferred slot';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
