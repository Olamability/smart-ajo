-- ============================================================================
-- MIGRATION: Prevent Group Creator from Requesting to Join Their Own Group
-- ============================================================================
-- This migration adds validation to prevent group creators from requesting
-- to join their own groups. If payment fails after group creation, the creator
-- should retry payment, not request to join.
-- ============================================================================

-- Update the request_to_join_group function to check if user is the creator
CREATE OR REPLACE FUNCTION request_to_join_group(
  p_group_id UUID,
  p_user_id UUID,
  p_preferred_slot INTEGER DEFAULT NULL,
  p_message TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_group_status VARCHAR(20);
  v_current_members INTEGER;
  v_total_members INTEGER;
  v_group_creator_id UUID;
  v_existing_member BOOLEAN;
  v_existing_request BOOLEAN;
  v_slot_status VARCHAR(20);
BEGIN
  -- Validate inputs
  IF p_group_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Group ID cannot be NULL'::TEXT;
    RETURN;
  END IF;
  
  IF p_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'User ID cannot be NULL'::TEXT;
    RETURN;
  END IF;
  
  -- Check if group exists and get details including creator
  SELECT status, current_members, total_members, created_by
  INTO v_group_status, v_current_members, v_total_members, v_group_creator_id
  FROM groups 
  WHERE id = p_group_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Group not found'::TEXT;
    RETURN;
  END IF;
  
  -- NEW CHECK: Prevent group creator from requesting to join their own group
  IF v_group_creator_id = p_user_id THEN
    RETURN QUERY SELECT FALSE, 'You are the creator of this group. Please complete your payment to become the admin.'::TEXT;
    RETURN;
  END IF;
  
  -- Check if group is accepting members
  IF v_group_status != 'forming' THEN
    RETURN QUERY SELECT FALSE, 'Group is not accepting new members'::TEXT;
    RETURN;
  END IF;
  
  -- Check if group is full
  IF v_current_members >= v_total_members THEN
    RETURN QUERY SELECT FALSE, 'Group is full'::TEXT;
    RETURN;
  END IF;
  
  -- Validate preferred slot if provided
  IF p_preferred_slot IS NOT NULL THEN
    IF p_preferred_slot < 1 OR p_preferred_slot > v_total_members THEN
      RETURN QUERY SELECT FALSE, 
        'Invalid slot number. Must be between 1 and ' || v_total_members::TEXT;
      RETURN;
    END IF;
    
    -- Check if slot is available
    SELECT status INTO v_slot_status
    FROM group_payout_slots
    WHERE group_id = p_group_id AND slot_number = p_preferred_slot;
    
    IF v_slot_status IS NULL THEN
      RETURN QUERY SELECT FALSE, 'Slot information not found'::TEXT;
      RETURN;
    END IF;
    
    IF v_slot_status != 'available' THEN
      RETURN QUERY SELECT FALSE, 'This slot is not available'::TEXT;
      RETURN;
    END IF;
  END IF;
  
  -- Check if user is already a member
  SELECT EXISTS(
    SELECT 1 FROM group_members 
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) INTO v_existing_member;
  
  IF v_existing_member THEN
    RETURN QUERY SELECT FALSE, 'You are already a member of this group'::TEXT;
    RETURN;
  END IF;
  
  -- Check if user already has a pending request
  SELECT EXISTS(
    SELECT 1 FROM group_join_requests 
    WHERE group_id = p_group_id 
    AND user_id = p_user_id 
    AND status = 'pending'
  ) INTO v_existing_request;
  
  IF v_existing_request THEN
    RETURN QUERY SELECT FALSE, 'You already have a pending request for this group'::TEXT;
    RETURN;
  END IF;
  
  -- Reserve the slot if specified
  IF p_preferred_slot IS NOT NULL THEN
    UPDATE group_payout_slots
    SET 
      status = 'reserved',
      reserved_by = p_user_id,
      reserved_at = NOW(),
      updated_at = NOW()
    WHERE group_id = p_group_id 
    AND slot_number = p_preferred_slot
    AND status = 'available'; -- Only reserve if still available
    
    -- Check if reservation succeeded
    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, 'Slot was taken by another user. Please try again.'::TEXT;
      RETURN;
    END IF;
  END IF;
  
  -- Create the join request
  INSERT INTO group_join_requests (
    group_id, 
    user_id, 
    preferred_slot,
    message, 
    status
  ) VALUES (
    p_group_id, 
    p_user_id, 
    p_preferred_slot,
    p_message, 
    'pending'
  )
  ON CONFLICT (group_id, user_id) 
  DO UPDATE SET 
    status = 'pending',
    preferred_slot = p_preferred_slot,
    message = p_message,
    updated_at = NOW();
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  -- Release slot if something went wrong
  IF p_preferred_slot IS NOT NULL THEN
    UPDATE group_payout_slots
    SET 
      status = 'available',
      reserved_by = NULL,
      reserved_at = NULL,
      updated_at = NOW()
    WHERE group_id = p_group_id 
    AND slot_number = p_preferred_slot
    AND reserved_by = p_user_id;
  END IF;
  
  RAISE WARNING 'Error in request_to_join_group: %', SQLERRM;
  RETURN QUERY SELECT FALSE, 'An error occurred while processing your join request. Please try again.'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION request_to_join_group IS 
  'Creates a join request with slot preference. Prevents group creator from requesting to join their own group. Reserves the slot if specified.';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
