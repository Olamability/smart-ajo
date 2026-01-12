-- ============================================================================
-- MIGRATION: Add Payout Slot System
-- ============================================================================
-- This migration adds:
-- 1. Payout slots table for managing slot-based payout order
-- 2. Slot preference field to join requests
-- 3. Functions to manage slots
-- 4. Views for slot availability
-- ============================================================================

-- ============================================================================
-- CREATE PAYOUT SLOTS TABLE
-- ============================================================================
-- Tracks payout slots for each group, showing availability and assignment
-- Each slot corresponds to a position in the payout rotation

CREATE TABLE IF NOT EXISTS group_payout_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  
  -- Slot Details
  slot_number INTEGER NOT NULL CHECK (slot_number >= 1),
  payout_cycle INTEGER NOT NULL CHECK (payout_cycle >= 1), -- Which cycle this slot receives payout
  
  -- Slot Status
  status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'assigned')),
  
  -- Assignment Details
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  reserved_by UUID REFERENCES users(id) ON DELETE SET NULL, -- User who requested this slot
  reserved_at TIMESTAMPTZ,
  
  -- Metadata
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(group_id, slot_number),
  UNIQUE(group_id, payout_cycle)
);

-- Indexes for payout_slots table
CREATE INDEX idx_group_payout_slots_group_id ON group_payout_slots(group_id);
CREATE INDEX idx_group_payout_slots_status ON group_payout_slots(group_id, status);
CREATE INDEX idx_group_payout_slots_available ON group_payout_slots(group_id) 
  WHERE status = 'available';
CREATE INDEX idx_group_payout_slots_assigned_to ON group_payout_slots(assigned_to) 
  WHERE assigned_to IS NOT NULL;

COMMENT ON TABLE group_payout_slots IS 
  'Tracks payout slots for groups, showing which positions are available, reserved, or assigned';
COMMENT ON COLUMN group_payout_slots.slot_number IS 
  'Position in payout order (1 = first to receive payout, etc.)';
COMMENT ON COLUMN group_payout_slots.payout_cycle IS 
  'The cycle number when this slot receives payout (usually same as slot_number)';
COMMENT ON COLUMN group_payout_slots.status IS 
  'available: open for selection, reserved: in pending join request, assigned: confirmed member';

-- Add trigger for updated_at
CREATE TRIGGER update_group_payout_slots_updated_at 
  BEFORE UPDATE ON group_payout_slots
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- UPDATE JOIN REQUESTS TABLE
-- ============================================================================
-- Add preferred_slot field to join requests

ALTER TABLE group_join_requests 
  ADD COLUMN IF NOT EXISTS preferred_slot INTEGER CHECK (preferred_slot >= 1);

CREATE INDEX IF NOT EXISTS idx_group_join_requests_preferred_slot 
  ON group_join_requests(group_id, preferred_slot) 
  WHERE preferred_slot IS NOT NULL;

COMMENT ON COLUMN group_join_requests.preferred_slot IS 
  'The slot number the user prefers to take in the payout rotation';

-- ============================================================================
-- RLS POLICIES FOR PAYOUT SLOTS
-- ============================================================================

-- Enable RLS
ALTER TABLE group_payout_slots ENABLE ROW LEVEL SECURITY;

-- Anyone can view slots for visible groups
CREATE POLICY group_payout_slots_select_all ON group_payout_slots
  FOR SELECT
  USING (true); -- Slots are public information for transparency

-- Only system can insert/update/delete slots directly
-- Slots are managed through functions
CREATE POLICY group_payout_slots_modify_system ON group_payout_slots
  FOR ALL
  USING (
    CASE 
      WHEN current_setting('role', true) = 'service_role' THEN true
      ELSE false
    END
  );

-- ============================================================================
-- FUNCTION: Initialize slots for a group
-- ============================================================================
-- Creates all payout slots when a group is created

CREATE OR REPLACE FUNCTION initialize_group_slots(
  p_group_id UUID,
  p_total_slots INTEGER
)
RETURNS TABLE(success BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_existing_slots INTEGER;
  v_slot_num INTEGER;
BEGIN
  -- Validate inputs
  IF p_group_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Group ID cannot be NULL'::TEXT;
    RETURN;
  END IF;
  
  IF p_total_slots IS NULL OR p_total_slots < 2 THEN
    RETURN QUERY SELECT FALSE, 'Total slots must be at least 2'::TEXT;
    RETURN;
  END IF;
  
  -- Check if slots already exist
  SELECT COUNT(*) INTO v_existing_slots
  FROM group_payout_slots
  WHERE group_id = p_group_id;
  
  IF v_existing_slots > 0 THEN
    RETURN QUERY SELECT FALSE, 'Slots already initialized for this group'::TEXT;
    RETURN;
  END IF;
  
  -- Create slots for each position
  FOR v_slot_num IN 1..p_total_slots LOOP
    INSERT INTO group_payout_slots (
      group_id,
      slot_number,
      payout_cycle,
      status
    ) VALUES (
      p_group_id,
      v_slot_num,
      v_slot_num, -- Payout cycle matches slot number
      'available'
    );
  END LOOP;
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in initialize_group_slots: %', SQLERRM;
  RETURN QUERY SELECT FALSE, 'Failed to initialize slots'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION initialize_group_slots IS 
  'Creates payout slots for a new group based on total_members';

GRANT EXECUTE ON FUNCTION initialize_group_slots TO authenticated;

-- ============================================================================
-- FUNCTION: Get available slots for a group
-- ============================================================================

CREATE OR REPLACE FUNCTION get_available_slots(p_group_id UUID)
RETURNS TABLE(
  slot_number INTEGER,
  payout_cycle INTEGER,
  status VARCHAR(20)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gps.slot_number,
    gps.payout_cycle,
    gps.status
  FROM group_payout_slots gps
  WHERE gps.group_id = p_group_id
  ORDER BY gps.slot_number ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_available_slots IS 
  'Returns all slots for a group with their availability status';

GRANT EXECUTE ON FUNCTION get_available_slots TO authenticated, anon;

-- ============================================================================
-- UPDATE: Request to join a group with slot preference
-- ============================================================================

DROP FUNCTION IF EXISTS request_to_join_group(UUID, UUID, TEXT);

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
  
  -- Check if group exists and get details
  SELECT status, current_members, total_members 
  INTO v_group_status, v_current_members, v_total_members
  FROM groups 
  WHERE id = p_group_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Group not found'::TEXT;
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
        'Invalid slot number. Must be between 1 and ' || v_total_members::TEXT::TEXT;
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
  'Creates a join request with slot preference. Reserves the slot if specified.';

GRANT EXECUTE ON FUNCTION request_to_join_group TO authenticated;

-- ============================================================================
-- UPDATE: Approve join request with slot assignment
-- ============================================================================

DROP FUNCTION IF EXISTS approve_join_request(UUID, UUID);

CREATE OR REPLACE FUNCTION approve_join_request(
  p_request_id UUID,
  p_reviewer_id UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_group_id UUID;
  v_user_id UUID;
  v_request_status VARCHAR(20);
  v_preferred_slot INTEGER;
  v_slot_status VARCHAR(20);
  v_security_deposit_amount DECIMAL(15, 2);
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
  SELECT group_id, user_id, status, preferred_slot
  INTO v_group_id, v_user_id, v_request_status, v_preferred_slot
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
  
  -- Get security deposit amount
  SELECT security_deposit_amount INTO v_security_deposit_amount
  FROM groups WHERE id = v_group_id;
  
  -- Verify slot is still reserved or available
  IF v_preferred_slot IS NOT NULL THEN
    SELECT status INTO v_slot_status
    FROM group_payout_slots
    WHERE group_id = v_group_id AND slot_number = v_preferred_slot;
    
    IF v_slot_status NOT IN ('available', 'reserved') THEN
      RETURN QUERY SELECT FALSE, 'The requested slot is no longer available'::TEXT;
      RETURN;
    END IF;
    
    -- Assign the slot to the user
    UPDATE group_payout_slots
    SET 
      status = 'assigned',
      assigned_to = v_user_id,
      assigned_at = NOW(),
      reserved_by = NULL,
      reserved_at = NULL,
      updated_at = NOW()
    WHERE group_id = v_group_id AND slot_number = v_preferred_slot;
  END IF;
  
  -- Add user as a member with pending status and assigned position
  INSERT INTO group_members (
    group_id, 
    user_id, 
    position, 
    status, 
    has_paid_security_deposit,
    security_deposit_amount
  ) VALUES (
    v_group_id,
    v_user_id,
    v_preferred_slot, -- Use the requested slot as position
    'pending', -- Status remains pending until security deposit is paid
    FALSE,
    v_security_deposit_amount
  );
  
  -- Update join request status
  UPDATE group_join_requests
  SET 
    status = 'approved',
    reviewed_by = p_reviewer_id,
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id;
  
  -- Create notification for the user
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    related_group_id
  ) VALUES (
    v_user_id,
    'member_joined',
    'Join Request Approved',
    'Your request to join the group has been approved. You have been assigned slot #' || 
    COALESCE(v_preferred_slot::TEXT, 'TBD') || 
    '. Please pay the security deposit to complete your membership.',
    v_group_id
  );
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in approve_join_request: %', SQLERRM;
  RETURN QUERY SELECT FALSE, 'An error occurred while approving the request. Please try again.'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION approve_join_request IS 
  'Approves a join request, assigns the preferred slot, and adds user as pending member';

GRANT EXECUTE ON FUNCTION approve_join_request TO authenticated;

-- ============================================================================
-- UPDATE: Reject join request - release reserved slot
-- ============================================================================

DROP FUNCTION IF EXISTS reject_join_request(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION reject_join_request(
  p_request_id UUID,
  p_reviewer_id UUID,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_group_id UUID;
  v_user_id UUID;
  v_request_status VARCHAR(20);
  v_preferred_slot INTEGER;
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
  SELECT group_id, user_id, status, preferred_slot
  INTO v_group_id, v_user_id, v_request_status, v_preferred_slot
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
    RETURN QUERY SELECT FALSE, 'Only the group creator can reject join requests'::TEXT;
    RETURN;
  END IF;
  
  -- Release reserved slot if any
  IF v_preferred_slot IS NOT NULL THEN
    UPDATE group_payout_slots
    SET 
      status = 'available',
      reserved_by = NULL,
      reserved_at = NULL,
      updated_at = NOW()
    WHERE group_id = v_group_id 
    AND slot_number = v_preferred_slot
    AND reserved_by = v_user_id;
  END IF;
  
  -- Update join request status
  UPDATE group_join_requests
  SET 
    status = 'rejected',
    reviewed_by = p_reviewer_id,
    reviewed_at = NOW(),
    rejection_reason = p_rejection_reason,
    updated_at = NOW()
  WHERE id = p_request_id;
  
  -- Create notification for the user
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    related_group_id
  ) VALUES (
    v_user_id,
    'general',
    'Join Request Rejected',
    CASE 
      WHEN p_rejection_reason IS NOT NULL THEN 
        'Your request to join the group has been rejected. Reason: ' || p_rejection_reason
      ELSE 
        'Your request to join the group has been rejected.'
    END,
    v_group_id
  );
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in reject_join_request: %', SQLERRM;
  RETURN QUERY SELECT FALSE, 'An error occurred while rejecting the request. Please try again.'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION reject_join_request IS 
  'Rejects a join request and releases any reserved slot';

GRANT EXECUTE ON FUNCTION reject_join_request TO authenticated;

-- ============================================================================
-- TRIGGER: Auto-initialize slots when group is created
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_initialize_slots()
RETURNS TRIGGER AS $$
BEGIN
  -- Initialize slots for new group
  PERFORM initialize_group_slots(NEW.id, NEW.total_members);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_initialize_slots
AFTER INSERT ON groups
FOR EACH ROW
EXECUTE FUNCTION auto_initialize_slots();

COMMENT ON FUNCTION auto_initialize_slots IS 
  'Automatically initializes payout slots when a new group is created';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
