-- ============================================================================
-- MASTER MIGRATION: REBUILD PAYMENT & GROUP SYSTEM
-- ============================================================================
-- This migration performs a complete reset of the payment and group architecture.
-- 
-- DESTRUCTIVE ACTIONS:
-- 1. DROPS tables: contributions, payments, group_join_requests, group_payout_slots, group_members, transactions, notifications, groups
-- 
-- CREATIVE ACTIONS:
-- 1. CREATES tables: groups, group_members, group_payout_slots, payments, contributions, group_join_requests, transactions, notifications
-- 2. SETS UP RLS triggers
-- 3. DEFINES Indexes
-- 4. RESTORES Functions/RPCs (request_to_join, approve_join, etc.)
-- ============================================================================

-- 1. DROP EXISTING TABLES (Order matters for foreign keys)
DROP TABLE IF EXISTS contributions CASCADE;
DROP TABLE IF EXISTS group_join_requests CASCADE;
DROP TABLE IF EXISTS group_payout_slots CASCADE;
DROP TABLE IF EXISTS group_members CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
-- Also create users table IF it doesn't exist (Frontend expects public.users)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    full_name TEXT,
    email TEXT,
    phone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. EXTENSIONS & UTILS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Helper: Check if user is group creator
CREATE OR REPLACE FUNCTION is_group_creator(p_user_id UUID, p_group_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM groups WHERE id = p_group_id AND created_by = p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. GROUPS TABLE
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by UUID NOT NULL REFERENCES auth.users(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    creator_profile_image TEXT,
    creator_phone VARCHAR(20),
    contribution_amount BIGINT NOT NULL CHECK (contribution_amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    total_members INTEGER NOT NULL CHECK (total_members > 0),
    current_members INTEGER NOT NULL DEFAULT 0,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'forming' CHECK (status IN ('forming', 'active', 'paused', 'completed', 'cancelled', 'open')),
    security_deposit_amount BIGINT NOT NULL DEFAULT 0,
    security_deposit_percentage DECIMAL(5,2) DEFAULT 0,
    service_fee_percentage DECIMAL(5,2) DEFAULT 0,
    current_cycle INTEGER NOT NULL DEFAULT 1,
    total_cycles INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraint: Cannot have more members than total
    CONSTRAINT check_member_limit CHECK (current_members <= total_members)
);

CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Groups are viewable by everyone" ON groups FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create groups" ON groups FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Creators can update their groups" ON groups FOR UPDATE USING (auth.uid() = created_by);

-- 5. GROUP MEMBERS TABLE
CREATE TABLE group_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id), -- Changed to reference public.users
    position INTEGER, -- Payout slot (1 to total_members)
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'left', 'pending')),
    has_paid_security_deposit BOOLEAN NOT NULL DEFAULT FALSE,
    security_deposit_amount BIGINT DEFAULT 0,
    security_deposit_paid_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_creator BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Constraints
    UNIQUE(group_id, user_id),      -- User can join group only once
    UNIQUE(group_id, position)      -- Slot must be unique within group
);

CREATE TRIGGER update_members_updated_at BEFORE UPDATE ON group_members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members viewable by active users" ON group_members FOR SELECT USING (true);
CREATE POLICY "Service Role manages members" ON group_members USING (auth.role() = 'service_role');

-- 6. GROUP PAYOUT SLOTS (Added)
CREATE TABLE group_payout_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    slot_number INTEGER NOT NULL CHECK (slot_number >= 1),
    payout_cycle INTEGER NOT NULL CHECK (payout_cycle >= 1),
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'assigned')),
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ,
    reserved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reserved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(group_id, slot_number),
    UNIQUE(group_id, payout_cycle)
);
CREATE INDEX idx_group_payout_slots_group_id ON group_payout_slots(group_id);
ALTER TABLE group_payout_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Slots public" ON group_payout_slots FOR SELECT USING (true);
CREATE POLICY "Service Role manages slots" ON group_payout_slots USING (auth.role() = 'service_role');

-- 7. PAYMENTS TABLE
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference VARCHAR(255) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id), -- Payments stick to AUTH user for security
    amount BIGINT NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'abandoned')),
    email VARCHAR(255) NOT NULL,
    channel VARCHAR(50) NOT NULL,
    authorization_code VARCHAR(255),
    customer_code VARCHAR(255),
    gateway_response TEXT,
    fees BIGINT DEFAULT 0,
    paid_at TIMESTAMPTZ,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    paystack_id BIGINT,
    domain VARCHAR(10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_reference ON payments(reference);
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own payments" ON payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users initiate payments" ON payments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service Role updates payments" ON payments FOR UPDATE USING (auth.role() = 'service_role');

-- 8. GROUP JOIN REQUESTS
CREATE TABLE group_join_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
    preferred_slot INTEGER,
    message TEXT, -- Added missing column
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(group_id, user_id)
);

CREATE TRIGGER update_join_requests_updated_at BEFORE UPDATE ON group_join_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE group_join_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view requests" ON group_join_requests FOR SELECT USING (true);
CREATE POLICY "Users create requests" ON group_join_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Creators manage requests" ON group_join_requests FOR UPDATE USING (
    EXISTS (SELECT 1 FROM groups WHERE id = group_join_requests.group_id AND created_by = auth.uid())
);

-- 9. CONTRIBUTIONS
CREATE TABLE contributions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    cycle_number INTEGER NOT NULL,
    amount BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'failed', 'waived')),
    due_date TIMESTAMPTZ NOT NULL,
    paid_date TIMESTAMPTZ,
    transaction_ref VARCHAR(255) REFERENCES payments(reference), -- Changed from transaction_reference to transaction_ref to match frontend usage often? Or keep consistent. Sticking to 'transaction_ref' as seen in legacy logic.
    penalty DECIMAL(15,2) DEFAULT 0,
    service_fee DECIMAL(15,2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(group_id, user_id, cycle_number)
);

CREATE TRIGGER update_contributions_updated_at BEFORE UPDATE ON contributions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Contributions viewable" ON contributions FOR SELECT USING (true);
CREATE POLICY "Service Role manages contributions" ON contributions USING (auth.role() = 'service_role');

-- 10. TRANSACTIONS
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    group_id UUID REFERENCES groups(id), 
    type VARCHAR(50) NOT NULL, 
    amount BIGINT NOT NULL,
    currency VARCHAR(3) DEFAULT 'NGN',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reference VARCHAR(255) UNIQUE, 
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service Role manages transactions" ON transactions USING (auth.role() = 'service_role');

-- 11. NOTIFICATIONS
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    related_group_id UUID REFERENCES groups(id),
    related_transaction_id UUID REFERENCES transactions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service Role manages notifications" ON notifications USING (auth.role() = 'service_role');

-- ============================================================================
-- LOGIC FUNCTIONS (RPCs)
-- ============================================================================

-- A. INITIALIZE SLOTS
DROP FUNCTION IF EXISTS initialize_group_slots(UUID, INTEGER);
CREATE OR REPLACE FUNCTION initialize_group_slots(
  p_group_id UUID,
  p_total_slots INTEGER
)
RETURNS TABLE(success BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_existing_slots INTEGER;
  v_slot_num INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_existing_slots FROM group_payout_slots WHERE group_id = p_group_id;
  IF v_existing_slots > 0 THEN
    RETURN QUERY SELECT FALSE, 'Slots already initialized'::TEXT;
    RETURN;
  END IF;
  
  FOR v_slot_num IN 1..p_total_slots LOOP
    INSERT INTO group_payout_slots (group_id, slot_number, payout_cycle, status) 
    VALUES (p_group_id, v_slot_num, v_slot_num, 'available');
  END LOOP;
  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- B. AUTO-INIT TRIGGER
DROP FUNCTION IF EXISTS auto_initialize_slots() CASCADE;
CREATE OR REPLACE FUNCTION auto_initialize_slots()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM initialize_group_slots(NEW.id, NEW.total_members);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_initialize_slots
AFTER INSERT ON groups
FOR EACH ROW
EXECUTE FUNCTION auto_initialize_slots();

-- C. GET AVAILABLE SLOTS
DROP FUNCTION IF EXISTS get_available_slots(UUID);
CREATE OR REPLACE FUNCTION get_available_slots(p_group_id UUID)
RETURNS TABLE(
  slot_number INTEGER,
  payout_cycle INTEGER,
  status VARCHAR(20)
) AS $$
BEGIN
  RETURN QUERY
  SELECT gps.slot_number, gps.payout_cycle, gps.status
  FROM group_payout_slots gps
  WHERE gps.group_id = p_group_id
  ORDER BY gps.slot_number ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- D. REQUEST TO JOIN
DROP FUNCTION IF EXISTS request_to_join_group(UUID, UUID, INTEGER, TEXT);
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
  v_slot_status VARCHAR(20);
BEGIN
  -- Checks
  SELECT status, current_members, total_members INTO v_group_status, v_current_members, v_total_members
  FROM groups WHERE id = p_group_id;
  
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'Group not found'::TEXT; RETURN; END IF;
  IF v_group_status != 'forming' THEN RETURN QUERY SELECT FALSE, 'Group not accepting members'::TEXT; RETURN; END IF;
  IF v_current_members >= v_total_members THEN RETURN QUERY SELECT FALSE, 'Group is full'::TEXT; RETURN; END IF;
  
  IF EXISTS (SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = p_user_id) THEN
    RETURN QUERY SELECT FALSE, 'Already a member'::TEXT; RETURN;
  END IF;
  
  IF EXISTS (SELECT 1 FROM group_join_requests WHERE group_id = p_group_id AND user_id = p_user_id AND status = 'pending') THEN
    RETURN QUERY SELECT FALSE, 'Pending request exists'::TEXT; RETURN;
  END IF;

  -- Slot check
  IF p_preferred_slot IS NOT NULL THEN
    SELECT status INTO v_slot_status FROM group_payout_slots WHERE group_id = p_group_id AND slot_number = p_preferred_slot;
    IF v_slot_status != 'available' THEN RETURN QUERY SELECT FALSE, 'Slot not available'::TEXT; RETURN; END IF;
    
    -- Reserve
    UPDATE group_payout_slots SET status = 'reserved', reserved_by = p_user_id, reserved_at = NOW() 
    WHERE group_id = p_group_id AND slot_number = p_preferred_slot AND status = 'available';
    IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'Slot taken'::TEXT; RETURN; END IF;
  END IF;

  INSERT INTO group_join_requests (group_id, user_id, preferred_slot, message, status)
  VALUES (p_group_id, p_user_id, p_preferred_slot, p_message, 'pending');
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  -- Rollback reservation if insert fails
  IF p_preferred_slot IS NOT NULL THEN
     UPDATE group_payout_slots SET status = 'available', reserved_by = NULL WHERE group_id = p_group_id AND slot_number = p_preferred_slot AND reserved_by = p_user_id;
  END IF;
  RAISE WARNING 'Error: %', SQLERRM;
  RETURN QUERY SELECT FALSE, 'Internal Error'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- E. GET PENDING REQUESTS
DROP FUNCTION IF EXISTS get_pending_join_requests(UUID);
CREATE OR REPLACE FUNCTION get_pending_join_requests(p_group_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_name TEXT,
  user_email TEXT,
  preferred_slot INTEGER,
  message TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gjr.id, gjr.user_id, 
    u.full_name, u.email, 
    gjr.preferred_slot, gjr.message, gjr.created_at
  FROM group_join_requests gjr
  JOIN users u ON gjr.user_id = u.id
  WHERE gjr.group_id = p_group_id AND gjr.status = 'pending'
  ORDER BY gjr.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- F. APPROVE REQUEST
DROP FUNCTION IF EXISTS approve_join_request(UUID, UUID);
CREATE OR REPLACE FUNCTION approve_join_request(
  p_request_id UUID,
  p_reviewer_id UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT) AS $$
DECLARE
  v_group_id UUID;
  v_user_id UUID;
  v_preferred_slot INTEGER;
BEGIN
  SELECT group_id, user_id, preferred_slot INTO v_group_id, v_user_id, v_preferred_slot
  FROM group_join_requests WHERE id = p_request_id AND status = 'pending';
  
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'Request invalid'::TEXT; RETURN; END IF;
  
  IF NOT is_group_creator(p_reviewer_id, v_group_id) THEN
    RETURN QUERY SELECT FALSE, 'Analyze privilege'::TEXT; RETURN;
  END IF;

  IF v_preferred_slot IS NOT NULL THEN
    UPDATE group_payout_slots SET status = 'assigned', assigned_to = v_user_id, reserved_by = NULL 
    WHERE group_id = v_group_id AND slot_number = v_preferred_slot;
  END IF;

  -- Update request
  UPDATE group_join_requests SET status = 'approved', reviewed_by = p_reviewer_id, reviewed_at = NOW() WHERE id = p_request_id;
  
  -- Add notification
  INSERT INTO notifications (user_id, type, title, message, related_group_id)
  VALUES (v_user_id, 'member_joined', 'Join Approved', 'Your request is approved. Please pay.', v_group_id);

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- G. REJECT REQUEST
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
  v_preferred_slot INTEGER;
BEGIN
  SELECT group_id, user_id, preferred_slot INTO v_group_id, v_user_id, v_preferred_slot
  FROM group_join_requests WHERE id = p_request_id AND status = 'pending';
  
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'Request invalid'::TEXT; RETURN; END IF;
  
  IF NOT is_group_creator(p_reviewer_id, v_group_id) THEN
    RETURN QUERY SELECT FALSE, 'Analyze privilege'::TEXT; RETURN;
  END IF;

  IF v_preferred_slot IS NOT NULL THEN
    UPDATE group_payout_slots SET status = 'available', reserved_by = NULL WHERE group_id = v_group_id AND slot_number = v_preferred_slot;
  END IF;

  UPDATE group_join_requests SET status = 'rejected', reviewed_by = p_reviewer_id, reviewed_at = NOW(), rejection_reason = p_rejection_reason WHERE id = p_request_id;
  
  INSERT INTO notifications (user_id, type, title, message, related_group_id)
  VALUES (v_user_id, 'general', 'Join Rejected', 'Your request was rejected.', v_group_id);

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View helper
CREATE OR REPLACE VIEW members_with_payment_status AS
SELECT 
  gm.id, gm.group_id, gm.user_id, gm.position, gm.status AS member_status, 
  gm.has_paid_security_deposit, gm.joined_at, u.full_name, u.email
FROM group_members gm
JOIN users u ON gm.user_id = u.id;
GRANT SELECT ON members_with_payment_status TO authenticated;

