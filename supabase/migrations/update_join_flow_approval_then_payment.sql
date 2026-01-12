-- ============================================================================
-- Migration: Update Join Request Flow for Approval-Then-Payment
-- ============================================================================
-- This migration updates the approve_join_request function to support the
-- new flow where:
-- 1. User requests to join
-- 2. Admin approves request (user NOT added as member yet)
-- 3. User pays security deposit + contribution
-- 4. Payment function adds user as active member
-- ============================================================================

-- ============================================================================
-- UPDATED FUNCTION: Approve join request (mark as approved, don't add member yet)
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_join_request(
  p_request_id UUID,
  p_reviewer_id UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_group_id UUID;
  v_user_id UUID;
  v_request_status VARCHAR(20);
  v_group_status VARCHAR(20);
  v_current_members INTEGER;
  v_total_members INTEGER;
BEGIN
  -- Validate inputs
  IF p_request_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Request ID cannot be NULL'::TEXT;
    RETURN;
  END IF;
  
  IF p_reviewer_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Reviewer ID cannot be NULL'::TEXT;
    RETURN;
  END IF;
  
  -- Get request details
  SELECT group_id, user_id, status 
  INTO v_group_id, v_user_id, v_request_status
  FROM group_join_requests 
  WHERE id = p_request_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Join request not found'::TEXT;
    RETURN;
  END IF;
  
  -- Check if request is still pending
  IF v_request_status != 'pending' THEN
    RETURN QUERY SELECT FALSE, 'This request has already been processed'::TEXT;
    RETURN;
  END IF;
  
  -- Check if reviewer is the group creator
  IF NOT is_group_creator(p_reviewer_id, v_group_id) THEN
    RETURN QUERY SELECT FALSE, 'Only the group creator can approve join requests'::TEXT;
    RETURN;
  END IF;

  -- Get group details
  SELECT status, current_members, total_members
  INTO v_group_status, v_current_members, v_total_members
  FROM groups
  WHERE id = v_group_id;

  -- Check if group is still forming
  IF v_group_status != 'forming' THEN
    RETURN QUERY SELECT FALSE, 'Group is not accepting new members'::TEXT;
    RETURN;
  END IF;

  -- Check if group is full
  IF v_current_members >= v_total_members THEN
    RETURN QUERY SELECT FALSE, 'Group is full'::TEXT;
    RETURN;
  END IF;
  
  -- Check if user is already a member
  IF EXISTS (SELECT 1 FROM group_members WHERE group_id = v_group_id AND user_id = v_user_id) THEN
    RETURN QUERY SELECT FALSE, 'User is already a member of this group'::TEXT;
    RETURN;
  END IF;

  -- Update join request status to 'approved'
  -- User is NOT added as member yet - they must pay first
  UPDATE group_join_requests
  SET 
    status = 'approved',
    reviewed_by = p_reviewer_id,
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id;
  
  -- Create notification for the approved user
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    related_group_id
  ) 
  SELECT 
    v_user_id,
    'member_joined',
    'Join Request Approved',
    'Your request to join ' || g.name || ' has been approved! Please complete your payment to become a member.',
    v_group_id
  FROM groups g
  WHERE g.id = v_group_id;

  RETURN QUERY SELECT TRUE, 'Join request approved. User can now proceed with payment.'::TEXT;

EXCEPTION
  WHEN OTHERS THEN
  RAISE WARNING 'Error in approve_join_request: %', SQLERRM;
  RETURN QUERY SELECT FALSE, 'An error occurred while approving the request. Please try again.'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION approve_join_request IS 
  'Approves a join request. User must then pay to become a member. Returns success status and error message.';

-- ============================================================================
-- UPDATED FUNCTION: Process approved join request payment
-- ============================================================================
-- This function is called after an approved join request and successful payment

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
  v_next_position INTEGER;
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

  -- Check if user has an approved join request
  SELECT status INTO v_join_request_status
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

  RETURN QUERY SELECT TRUE, 'Successfully joined group'::TEXT, v_next_position;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in process_approved_join_payment: %', SQLERRM;
    RETURN QUERY SELECT FALSE, 'An error occurred while processing payment'::TEXT, 0::INTEGER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION process_approved_join_payment IS 
  'Processes verified payment for an approved join request and adds member';

GRANT EXECUTE ON FUNCTION process_approved_join_payment TO authenticated;

-- ============================================================================
-- Add completed status to group_join_requests
-- ============================================================================

ALTER TABLE group_join_requests 
DROP CONSTRAINT IF EXISTS group_join_requests_status_check;

ALTER TABLE group_join_requests
ADD CONSTRAINT group_join_requests_status_check 
CHECK (status IN ('pending', 'approved', 'rejected', 'completed'));

COMMENT ON COLUMN group_join_requests.status IS 
  'Status of join request: pending (waiting for admin), approved (admin approved, waiting for payment), rejected (admin rejected), completed (payment processed, user is now member)';
