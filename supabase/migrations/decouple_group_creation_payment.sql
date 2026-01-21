-- ============================================================================
-- Migration: Decouple Group Creation from Payment
-- ============================================================================
-- This migration separates membership from payment, allowing:
-- 1. Group creators to be added as members immediately upon group creation
-- 2. Members to join groups before making payment
-- 3. Payment to be tracked separately from membership status
-- ============================================================================

-- ============================================================================
-- STEP 1: Add new database function to add members without payment
-- ============================================================================

-- Drop existing function if it exists to allow changing return type
DROP FUNCTION IF EXISTS add_member_to_group(UUID, UUID, BOOLEAN, INTEGER);

CREATE OR REPLACE FUNCTION add_member_to_group(
  p_group_id UUID,
  p_user_id UUID,
  p_is_creator BOOLEAN DEFAULT FALSE,
  p_preferred_slot INTEGER DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  error_message TEXT,
  position INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_group_record RECORD;
  v_next_position INTEGER;
  v_assigned_position INTEGER;
  v_member_exists BOOLEAN;
BEGIN
  -- Check if group exists and get details
  SELECT * INTO v_group_record
  FROM groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Group not found'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Check if user is already a member
  SELECT EXISTS(
    SELECT 1 FROM group_members 
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) INTO v_member_exists;

  IF v_member_exists THEN
    RETURN QUERY SELECT FALSE, 'User is already a member of this group'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Check if group is full
  IF v_group_record.current_members >= v_group_record.total_members THEN
    RETURN QUERY SELECT FALSE, 'Group is full'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Determine position
  IF p_preferred_slot IS NOT NULL THEN
    -- Check if preferred slot is available
    IF EXISTS(SELECT 1 FROM group_members WHERE group_id = p_group_id AND position = p_preferred_slot) THEN
      RETURN QUERY SELECT FALSE, 'Preferred slot is already taken'::TEXT, NULL::INTEGER;
      RETURN;
    END IF;
    v_assigned_position := p_preferred_slot;
  ELSE
    -- Find next available position
    SELECT COALESCE(MIN(slot_number), 1) INTO v_assigned_position
    FROM generate_series(1, v_group_record.total_members) AS slot_number
    WHERE slot_number NOT IN (
      SELECT position FROM group_members WHERE group_id = p_group_id
    );
  END IF;

  -- Add member to group
  INSERT INTO group_members (
    group_id,
    user_id,
    position,
    has_paid_security_deposit,
    security_deposit_amount,
    status,
    is_creator
  ) VALUES (
    p_group_id,
    p_user_id,
    v_assigned_position,
    FALSE, -- Payment will be tracked separately
    v_group_record.security_deposit_amount,
    'active', -- Member is active immediately, payment tracked separately
    p_is_creator
  );

  -- Update group's current_members count
  UPDATE groups
  SET 
    current_members = current_members + 1,
    updated_at = NOW()
  WHERE id = p_group_id;

  -- Create pending contribution record for the first cycle
  -- (will be marked as paid when payment is verified)
  INSERT INTO contributions (
    group_id,
    user_id,
    cycle_number,
    amount,
    due_date,
    status
  ) VALUES (
    p_group_id,
    p_user_id,
    v_group_record.current_cycle,
    v_group_record.contribution_amount,
    v_group_record.start_date,
    'pending' -- Will be updated to 'paid' when payment is verified
  );

  -- Return success
  RETURN QUERY SELECT TRUE, 'Member added successfully'::TEXT, v_assigned_position;
END;
$$;

-- ============================================================================
-- STEP 2: Modify group creation to auto-add creator as member
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_add_creator_as_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result RECORD;
BEGIN
  -- Add the creator as a member immediately with position 1
  SELECT * INTO v_result
  FROM add_member_to_group(
    NEW.id,
    NEW.created_by,
    TRUE, -- is_creator
    1 -- preferred slot 1 for creator
  );

  IF NOT v_result.success THEN
    RAISE EXCEPTION 'Failed to add creator as member: %', v_result.error_message;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger to auto-add creator when group is created
DROP TRIGGER IF EXISTS trigger_auto_add_creator ON groups;
CREATE TRIGGER trigger_auto_add_creator
AFTER INSERT ON groups
FOR EACH ROW
EXECUTE FUNCTION auto_add_creator_as_member();

-- ============================================================================
-- STEP 3: Update payment processing to only update payment status
-- ============================================================================

-- Modified function to process security deposit payment without adding member
CREATE OR REPLACE FUNCTION process_security_deposit_payment(
  p_payment_reference VARCHAR,
  p_group_id UUID,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_record RECORD;
  v_group_record RECORD;
  v_member_exists BOOLEAN;
BEGIN
  -- Get payment record
  SELECT * INTO v_payment_record
  FROM payments
  WHERE reference = p_payment_reference;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Payment record not found'::TEXT;
    RETURN;
  END IF;

  -- Verify payment is verified
  IF NOT v_payment_record.verified THEN
    RETURN QUERY SELECT FALSE, 'Payment has not been verified yet'::TEXT;
    RETURN;
  END IF;

  -- Get group record
  SELECT * INTO v_group_record
  FROM groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Group not found'::TEXT;
    RETURN;
  END IF;

  -- Check if user is a member
  SELECT EXISTS(
    SELECT 1 FROM group_members 
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) INTO v_member_exists;

  IF NOT v_member_exists THEN
    RETURN QUERY SELECT FALSE, 'User is not a member of this group'::TEXT;
    RETURN;
  END IF;

  -- Update member's security deposit status
  UPDATE group_members
  SET 
    has_paid_security_deposit = TRUE,
    security_deposit_paid_at = NOW(),
    updated_at = NOW()
  WHERE group_id = p_group_id AND user_id = p_user_id;

  -- Mark the first contribution as paid
  UPDATE contributions
  SET 
    status = 'paid',
    paid_date = NOW(),
    transaction_reference = p_payment_reference
  WHERE 
    group_id = p_group_id 
    AND user_id = p_user_id 
    AND cycle_number = v_group_record.current_cycle
    AND status = 'pending';

  RETURN QUERY SELECT TRUE, 'Payment processed successfully'::TEXT;
END;
$$;

-- ============================================================================
-- STEP 4: Update existing payment processing functions
-- ============================================================================

-- Drop existing function to allow changing return type
DROP FUNCTION IF EXISTS process_group_creation_payment(VARCHAR, UUID, UUID, INTEGER);

-- Update process_group_creation_payment to use new flow
CREATE OR REPLACE FUNCTION process_group_creation_payment(
  p_payment_reference VARCHAR,
  p_group_id UUID,
  p_user_id UUID,
  p_preferred_slot INTEGER DEFAULT 1
)
RETURNS TABLE(
  success BOOLEAN,
  error_message TEXT,
  position INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_record RECORD;
  v_process_result RECORD;
BEGIN
  -- Get payment record
  SELECT * INTO v_payment_record
  FROM payments
  WHERE reference = p_payment_reference;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Payment record not found'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Verify payment is verified
  IF NOT v_payment_record.verified THEN
    RETURN QUERY SELECT FALSE, 'Payment has not been verified yet'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Process the security deposit payment (member should already be added)
  SELECT * INTO v_process_result
  FROM process_security_deposit_payment(p_payment_reference, p_group_id, p_user_id);

  IF NOT v_process_result.success THEN
    RETURN QUERY SELECT FALSE, v_process_result.error_message, NULL::INTEGER;
    RETURN;
  END IF;

  -- Get the member's position
  RETURN QUERY 
  SELECT TRUE, 'Payment processed successfully'::TEXT, gm.position
  FROM group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = p_user_id;
END;
$$;

-- Drop existing function to allow changing return type
DROP FUNCTION IF EXISTS process_group_join_payment(VARCHAR, UUID, UUID);

-- Update process_group_join_payment to use new flow
CREATE OR REPLACE FUNCTION process_group_join_payment(
  p_payment_reference VARCHAR,
  p_group_id UUID,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  error_message TEXT,
  position INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_record RECORD;
  v_process_result RECORD;
BEGIN
  -- Get payment record
  SELECT * INTO v_payment_record
  FROM payments
  WHERE reference = p_payment_reference;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Payment record not found'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Verify payment is verified
  IF NOT v_payment_record.verified THEN
    RETURN QUERY SELECT FALSE, 'Payment has not been verified yet'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Process the security deposit payment (member should already be added)
  SELECT * INTO v_process_result
  FROM process_security_deposit_payment(p_payment_reference, p_group_id, p_user_id);

  IF NOT v_process_result.success THEN
    RETURN QUERY SELECT FALSE, v_process_result.error_message, NULL::INTEGER;
    RETURN;
  END IF;

  -- Get the member's position
  RETURN QUERY 
  SELECT TRUE, 'Payment processed successfully'::TEXT, gm.position
  FROM group_members gm
  WHERE gm.group_id = p_group_id AND gm.user_id = p_user_id;
END;
$$;

-- ============================================================================
-- STEP 5: Update join request approval to add member immediately
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_join_request(
  p_request_id UUID,
  p_reviewer_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request_record RECORD;
  v_group_record RECORD;
  v_add_member_result RECORD;
BEGIN
  -- Get join request
  SELECT * INTO v_request_record
  FROM group_join_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Join request not found'::TEXT;
    RETURN;
  END IF;

  -- Check if request is pending
  IF v_request_record.status != 'pending' THEN
    RETURN QUERY SELECT FALSE, 'Join request has already been processed'::TEXT;
    RETURN;
  END IF;

  -- Get group record
  SELECT * INTO v_group_record
  FROM groups
  WHERE id = v_request_record.group_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Group not found'::TEXT;
    RETURN;
  END IF;

  -- Verify reviewer is the group creator
  IF v_group_record.created_by != p_reviewer_id THEN
    RETURN QUERY SELECT FALSE, 'Only the group creator can approve join requests'::TEXT;
    RETURN;
  END IF;

  -- Add member to group immediately
  SELECT * INTO v_add_member_result
  FROM add_member_to_group(
    v_request_record.group_id,
    v_request_record.user_id,
    FALSE, -- not creator
    v_request_record.preferred_slot
  );

  IF NOT v_add_member_result.success THEN
    RETURN QUERY SELECT FALSE, v_add_member_result.error_message;
    RETURN;
  END IF;

  -- Update join request status
  UPDATE group_join_requests
  SET 
    status = 'approved',
    reviewed_by = p_reviewer_id,
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id;

  RETURN QUERY SELECT TRUE, 'Join request approved and member added successfully'::TEXT;
END;
$$;

-- ============================================================================
-- STEP 6: Add helpful views for tracking unpaid members
-- ============================================================================

CREATE OR REPLACE VIEW members_with_payment_status AS
SELECT 
  gm.id,
  gm.group_id,
  gm.user_id,
  u.full_name,
  u.email,
  gm.position,
  gm.has_paid_security_deposit,
  gm.security_deposit_amount,
  gm.security_deposit_paid_at,
  gm.status AS member_status,
  gm.is_creator,
  gm.joined_at,
  CASE 
    WHEN gm.has_paid_security_deposit THEN 'paid'
    WHEN gm.joined_at < NOW() - INTERVAL '7 days' THEN 'overdue'
    ELSE 'pending'
  END AS payment_status,
  g.name AS group_name,
  g.contribution_amount,
  g.frequency
FROM group_members gm
JOIN users u ON gm.user_id = u.id
JOIN groups g ON gm.group_id = g.id;

-- Grant permissions
GRANT SELECT ON members_with_payment_status TO authenticated;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON FUNCTION add_member_to_group IS 'Adds a member to a group without requiring payment upfront. Payment is tracked separately.';
COMMENT ON FUNCTION auto_add_creator_as_member IS 'Automatically adds the group creator as a member when a group is created.';
COMMENT ON FUNCTION process_security_deposit_payment IS 'Processes security deposit payment for an existing member, updating payment status.';
COMMENT ON VIEW members_with_payment_status IS 'View showing all members with their payment status (paid, pending, overdue).';
