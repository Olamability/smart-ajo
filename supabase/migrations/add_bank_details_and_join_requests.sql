-- ============================================================================
-- MIGRATION: Add Bank Details and Join Requests
-- ============================================================================
-- This migration adds:
-- 1. Bank account fields to users table for payouts
-- 2. Join requests table for group membership approval workflow
-- 3. Functions to manage join requests
-- ============================================================================

-- ============================================================================
-- ADD BANK ACCOUNT FIELDS TO USERS TABLE
-- ============================================================================

-- Add bank account columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_code VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_number VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_name VARCHAR(255);

-- Create index for bank details lookup
CREATE INDEX IF NOT EXISTS idx_users_account_number ON users(account_number) WHERE account_number IS NOT NULL;

COMMENT ON COLUMN users.bank_name IS 'Name of the bank for payout disbursements';
COMMENT ON COLUMN users.bank_code IS 'Bank code for Paystack and other payment gateways';
COMMENT ON COLUMN users.account_number IS 'Bank account number (10 digits)';
COMMENT ON COLUMN users.account_name IS 'Account holder name (should match bank records)';

-- ============================================================================
-- CREATE JOIN REQUESTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS group_join_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Request Details
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  message TEXT, -- Optional message from user when requesting to join
  
  -- Admin Actions
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(group_id, user_id) -- One request per user per group
);

-- Indexes for join_requests table
CREATE INDEX idx_group_join_requests_group_id ON group_join_requests(group_id);
CREATE INDEX idx_group_join_requests_user_id ON group_join_requests(user_id);
CREATE INDEX idx_group_join_requests_status ON group_join_requests(group_id, status);
CREATE INDEX idx_group_join_requests_pending ON group_join_requests(group_id, status) WHERE status = 'pending';

COMMENT ON TABLE group_join_requests IS 'Stores requests from users to join groups, requiring admin approval';

-- Add trigger for updated_at
CREATE TRIGGER update_group_join_requests_updated_at 
  BEFORE UPDATE ON group_join_requests
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES FOR JOIN REQUESTS
-- ============================================================================

-- Enable RLS
ALTER TABLE group_join_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own join requests
CREATE POLICY group_join_requests_select_own ON group_join_requests
  FOR SELECT
  USING (auth.uid() = user_id);

-- Group creators and admins can view requests for their groups
CREATE POLICY group_join_requests_select_creator ON group_join_requests
  FOR SELECT
  USING (
    is_group_creator(auth.uid(), group_join_requests.group_id) OR
    is_current_user_admin()
  );

-- Users can create their own join requests
CREATE POLICY group_join_requests_insert_own ON group_join_requests
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Group creators and admins can update join requests (for approval/rejection)
CREATE POLICY group_join_requests_update_creator ON group_join_requests
  FOR UPDATE
  USING (
    is_group_creator(auth.uid(), group_join_requests.group_id) OR
    is_current_user_admin()
  );

-- Service role can do anything
CREATE POLICY group_join_requests_service_role_all ON group_join_requests
  FOR ALL
  USING (
    CASE 
      WHEN current_setting('role', true) = 'service_role' THEN true
      ELSE false
    END
  );

-- ============================================================================
-- FUNCTION: Request to join a group
-- ============================================================================

CREATE OR REPLACE FUNCTION request_to_join_group(
  p_group_id UUID,
  p_user_id UUID,
  p_message TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_group_status VARCHAR(20);
  v_current_members INTEGER;
  v_total_members INTEGER;
  v_existing_member BOOLEAN;
  v_existing_request BOOLEAN;
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
  
  -- Create the join request
  INSERT INTO group_join_requests (group_id, user_id, message, status)
  VALUES (p_group_id, p_user_id, p_message, 'pending')
  ON CONFLICT (group_id, user_id) 
  DO UPDATE SET 
    status = 'pending',
    message = p_message,
    updated_at = NOW();
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  -- Log the actual error for debugging but return a generic message to users
  RAISE WARNING 'Error in request_to_join_group: %', SQLERRM;
  RETURN QUERY SELECT FALSE, 'An error occurred while processing your join request. Please try again.'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION request_to_join_group IS 
  'Creates a join request for a user to join a group. Returns success status and error message.';

GRANT EXECUTE ON FUNCTION request_to_join_group TO authenticated;

-- ============================================================================
-- FUNCTION: Approve join request
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
  v_next_position INTEGER;
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
  
  -- Get security deposit amount
  SELECT security_deposit_amount INTO v_security_deposit_amount
  FROM groups WHERE id = v_group_id;
  
  -- Get the next available position
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_next_position
  FROM group_members 
  WHERE group_id = v_group_id;
  
  -- Add user as a member with pending status (waiting for security deposit)
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
    v_next_position,
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
    'Your request to join the group has been approved. Please pay the security deposit to complete your membership.',
    v_group_id
  );
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  -- Log the actual error for debugging but return a generic message to users
  RAISE WARNING 'Error in approve_join_request: %', SQLERRM;
  RETURN QUERY SELECT FALSE, 'An error occurred while approving the request. Please try again.'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION approve_join_request IS 
  'Approves a join request and adds the user as a pending member. Returns success status and error message.';

GRANT EXECUTE ON FUNCTION approve_join_request TO authenticated;

-- ============================================================================
-- FUNCTION: Reject join request
-- ============================================================================

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
    RETURN QUERY SELECT FALSE, 'Only the group creator can reject join requests'::TEXT;
    RETURN;
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
  -- Log the actual error for debugging but return a generic message to users
  RAISE WARNING 'Error in reject_join_request: %', SQLERRM;
  RETURN QUERY SELECT FALSE, 'An error occurred while rejecting the request. Please try again.'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION reject_join_request IS 
  'Rejects a join request. Returns success status and error message.';

GRANT EXECUTE ON FUNCTION reject_join_request TO authenticated;

-- ============================================================================
-- FUNCTION: Get pending join requests for a group
-- ============================================================================

CREATE OR REPLACE FUNCTION get_pending_join_requests(p_group_id UUID)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_name VARCHAR(255),
  user_email VARCHAR(255),
  message TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gjr.id,
    gjr.user_id,
    u.full_name,
    u.email,
    gjr.message,
    gjr.created_at
  FROM group_join_requests gjr
  JOIN users u ON gjr.user_id = u.id
  WHERE gjr.group_id = p_group_id
  AND gjr.status = 'pending'
  ORDER BY gjr.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_pending_join_requests IS 
  'Returns all pending join requests for a specific group.';

GRANT EXECUTE ON FUNCTION get_pending_join_requests TO authenticated;

-- ============================================================================
-- UPDATE: Fix group member count sync trigger
-- ============================================================================
-- Update the trigger to not count pending members (waiting for security deposit)
-- in the group's current_members count

CREATE OR REPLACE FUNCTION sync_group_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Only increment count for active members, not pending ones
    IF NEW.status = 'active' THEN
      UPDATE groups 
      SET current_members = current_members + 1,
          updated_at = NOW()
      WHERE id = NEW.group_id;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    -- Decrement count when member is removed
    UPDATE groups 
    SET current_members = GREATEST(0, current_members - 1),
        updated_at = NOW()
    WHERE id = OLD.group_id;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Handle status changes
    IF OLD.status != 'active' AND NEW.status = 'active' THEN
      -- Member became active (e.g., paid security deposit)
      UPDATE groups 
      SET current_members = current_members + 1,
          updated_at = NOW()
      WHERE id = NEW.group_id;
    ELSIF OLD.status = 'active' AND NEW.status != 'active' THEN
      -- Member became inactive
      UPDATE groups 
      SET current_members = GREATEST(0, current_members - 1),
          updated_at = NOW()
      WHERE id = NEW.group_id;
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate the trigger to include UPDATE operations
DROP TRIGGER IF EXISTS sync_group_member_count_trigger ON group_members;
CREATE TRIGGER sync_group_member_count_trigger
AFTER INSERT OR DELETE OR UPDATE OF status ON group_members
FOR EACH ROW EXECUTE FUNCTION sync_group_member_count();

COMMENT ON FUNCTION sync_group_member_count IS 
  'Keeps the groups.current_members count in sync with active members only';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
