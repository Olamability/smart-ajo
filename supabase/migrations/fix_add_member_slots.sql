-- ============================================================================
-- Migration: Fix Add Member to Group with Slot Sync
-- ============================================================================
-- This migration updates the add_member_to_group function to:
-- 1. Properly check group_payout_slots for availability
-- 2. Update slot status to 'assigned' when adding a member
-- 3. Handle reserved slots correctly (allow if reserved by same user)
-- ============================================================================

CREATE OR REPLACE FUNCTION add_member_to_group(
  p_group_id UUID,
  p_user_id UUID,
  p_is_creator BOOLEAN DEFAULT FALSE,
  p_preferred_slot INTEGER DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  error_message TEXT,
  member_position INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_group_record RECORD;
  v_next_position INTEGER;
  v_assigned_position INTEGER;
  v_member_exists BOOLEAN;
  v_slot_status VARCHAR(20);
  v_reserved_by UUID;
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
    -- If already a member, return success with current position
    -- This makes the function idempotent
    SELECT position INTO v_assigned_position
    FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id;
    
    RETURN QUERY SELECT TRUE, 'User is already a member'::TEXT, v_assigned_position;
    RETURN;
  END IF;

  -- Check if group is full
  IF v_group_record.current_members >= v_group_record.total_members THEN
    RETURN QUERY SELECT FALSE, 'Group is full'::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  -- Determine position and validate slot
  IF p_preferred_slot IS NOT NULL THEN
    -- Check slot status in group_payout_slots
    SELECT status, reserved_by INTO v_slot_status, v_reserved_by
    FROM group_payout_slots
    WHERE group_id = p_group_id AND slot_number = p_preferred_slot;
    
    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, 'Invalid slot number'::TEXT, NULL::INTEGER;
      RETURN;
    END IF;

    -- detailed slot validation
    IF v_slot_status = 'assigned' THEN
       RETURN QUERY SELECT FALSE, 'Slot is already assigned to another member'::TEXT, NULL::INTEGER;
       RETURN;
    ELSIF v_slot_status = 'reserved' THEN
       IF v_reserved_by != p_user_id THEN
          RETURN QUERY SELECT FALSE, 'Slot is reserved by another user'::TEXT, NULL::INTEGER;
          RETURN;
       END IF;
       -- If reserved by THIS user, it's fine to proceed
    END IF;
    
    -- Double check group_members table just in case (redundancy)
    IF EXISTS(SELECT 1 FROM group_members WHERE group_id = p_group_id AND position = p_preferred_slot) THEN
      RETURN QUERY SELECT FALSE, 'Slot position already taken in members list'::TEXT, NULL::INTEGER;
      RETURN;
    END IF;

    v_assigned_position := p_preferred_slot;
  ELSE
    -- Find next available position from group_payout_slots
    -- Prefer 'available' slots
    SELECT slot_number INTO v_assigned_position
    FROM group_payout_slots
    WHERE group_id = p_group_id AND status = 'available'
    ORDER BY slot_number ASC
    LIMIT 1;
    
    IF v_assigned_position IS NULL THEN
       RETURN QUERY SELECT FALSE, 'No available slots found'::TEXT, NULL::INTEGER;
       RETURN;
    END IF;
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
    'active', -- Member is active immediately
    p_is_creator
  );

  -- IMPORTANT: Update slot status to 'assigned'
  UPDATE group_payout_slots
  SET 
    status = 'assigned',
    assigned_to = p_user_id,
    assigned_at = NOW(),
    reserved_by = NULL,
    reserved_at = NULL,
    updated_at = NOW()
  WHERE group_id = p_group_id AND slot_number = v_assigned_position;

  -- Create pending contribution record for the first cycle
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
    'pending'
  );

  -- Return success
  RETURN QUERY SELECT TRUE, 'Member added successfully'::TEXT, v_assigned_position;
END;
$$;

COMMENT ON FUNCTION add_member_to_group IS 
  'Adds a member to a group and updates slot status. Idempotent if user is already a member.';
