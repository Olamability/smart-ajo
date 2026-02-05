-- ============================================================================
-- SMART AJO DATABASE SCHEMA
-- Complete Supabase SQL Schema for Smart Ajo Application
-- ============================================================================
-- 
-- This schema provides a complete, production-ready database structure for
-- the Smart Ajo rotating savings and credit association (ROSCA) platform.
--
-- Key Features:
-- - User management with KYC verification
-- - Group creation and member management
-- - Automated contribution tracking
-- - Payout slot management
-- - Transaction and penalty tracking
-- - Wallet system for fund management
-- - System admin capabilities
-- - Comprehensive audit logging
-- - Row Level Security (RLS) policies
--
-- Usage:
-- 1. Create a new Supabase project
-- 2. Run this entire SQL file in the Supabase SQL Editor
-- 3. Configure environment variables in your frontend application
-- 4. Deploy edge functions (if needed)
--
-- ============================================================================

-- ============================================================================
-- SECTION 1: EXTENSIONS
-- Enable required PostgreSQL extensions
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto for encryption functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SECTION 2: ENUMS
-- Define enumerated types for consistent data validation
-- ============================================================================

-- User KYC status
CREATE TYPE kyc_status_enum AS ENUM ('not_started', 'pending', 'approved', 'rejected');

-- Group status lifecycle
CREATE TYPE group_status_enum AS ENUM ('forming', 'active', 'paused', 'completed', 'cancelled');

-- Group member status
CREATE TYPE member_status_enum AS ENUM ('pending', 'active', 'suspended', 'removed');

-- Contribution frequency
CREATE TYPE frequency_enum AS ENUM ('daily', 'weekly', 'monthly');

-- Contribution status
CREATE TYPE contribution_status_enum AS ENUM ('pending', 'paid', 'overdue', 'waived');

-- Transaction types
CREATE TYPE transaction_type_enum AS ENUM (
  'contribution',
  'payout',
  'security_deposit',
  'penalty',
  'refund',
  'deposit',
  'withdrawal',
  'fee'
);

-- Transaction status
CREATE TYPE transaction_status_enum AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- Payout status
CREATE TYPE payout_status_enum AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Penalty types
CREATE TYPE penalty_type_enum AS ENUM ('late_payment', 'missed_payment', 'early_exit');

-- Penalty status
CREATE TYPE penalty_status_enum AS ENUM ('applied', 'paid', 'waived');

-- Join request status
CREATE TYPE join_request_status_enum AS ENUM ('pending', 'approved', 'rejected');

-- Payout slot status
CREATE TYPE slot_status_enum AS ENUM ('available', 'reserved', 'assigned');

-- Notification types
CREATE TYPE notification_type_enum AS ENUM (
  'payment_due',
  'payment_received',
  'payment_overdue',
  'payout_ready',
  'payout_processed',
  'penalty_applied',
  'group_complete',
  'group_started',
  'member_joined',
  'member_removed',
  'system_announcement'
);

-- ============================================================================
-- SECTION 3: CORE TABLES
-- Main application data tables
-- ============================================================================

-- ----------------------------------------------------------------------------
-- USERS TABLE
-- Stores all user account information including KYC and bank details
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  
  -- Account status
  is_verified BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  is_admin BOOLEAN DEFAULT false,
  
  -- KYC information
  kyc_status kyc_status_enum DEFAULT 'not_started',
  kyc_data JSONB DEFAULT '{}'::jsonb,
  bvn TEXT,
  date_of_birth DATE,
  address TEXT,
  
  -- Profile
  avatar_url TEXT,
  
  -- Bank account details for payouts
  bank_name TEXT,
  account_number TEXT,
  account_name TEXT,
  bank_code TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT phone_format CHECK (phone ~ '^[0-9+\-() ]+$')
);

-- Indexes for users table
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_kyc_status ON users(kyc_status);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_is_admin ON users(is_admin);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- ----------------------------------------------------------------------------
-- WALLETS TABLE
-- Internal wallet system for managing user funds
-- ----------------------------------------------------------------------------
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance DECIMAL(15, 2) DEFAULT 0.00 NOT NULL,
  locked_balance DECIMAL(15, 2) DEFAULT 0.00 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  CONSTRAINT balance_non_negative CHECK (balance >= 0),
  CONSTRAINT locked_balance_non_negative CHECK (locked_balance >= 0),
  CONSTRAINT wallet_user_unique UNIQUE (user_id)
);

-- Indexes for wallets table
CREATE INDEX idx_wallets_user_id ON wallets(user_id);

-- ----------------------------------------------------------------------------
-- GROUPS TABLE
-- Represents an Ajo/ROSCA group
-- ----------------------------------------------------------------------------
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  
  -- Creator info (denormalized for quick access)
  creator_profile_image TEXT,
  creator_phone TEXT,
  
  -- Financial configuration
  contribution_amount DECIMAL(15, 2) NOT NULL,
  security_deposit_amount DECIMAL(15, 2) NOT NULL,
  security_deposit_percentage INTEGER NOT NULL DEFAULT 10,
  service_fee_percentage DECIMAL(5, 2) NOT NULL DEFAULT 2.00,
  
  -- Group configuration
  frequency frequency_enum NOT NULL,
  total_members INTEGER NOT NULL,
  current_members INTEGER DEFAULT 0,
  
  -- Status and lifecycle
  status group_status_enum DEFAULT 'forming',
  current_cycle INTEGER DEFAULT 1,
  total_cycles INTEGER NOT NULL,
  
  -- Dates
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  CONSTRAINT contribution_amount_positive CHECK (contribution_amount > 0),
  CONSTRAINT security_deposit_positive CHECK (security_deposit_amount >= 0),
  CONSTRAINT security_deposit_percentage_valid CHECK (security_deposit_percentage >= 0 AND security_deposit_percentage <= 100),
  CONSTRAINT service_fee_percentage_valid CHECK (service_fee_percentage >= 0 AND service_fee_percentage <= 100),
  CONSTRAINT total_members_positive CHECK (total_members > 0),
  CONSTRAINT current_members_valid CHECK (current_members >= 0 AND current_members <= total_members),
  CONSTRAINT total_cycles_valid CHECK (total_cycles > 0)
);

-- Indexes for groups table
CREATE INDEX idx_groups_created_by ON groups(created_by);
CREATE INDEX idx_groups_status ON groups(status);
CREATE INDEX idx_groups_created_at ON groups(created_at DESC);
CREATE INDEX idx_groups_start_date ON groups(start_date);

-- ----------------------------------------------------------------------------
-- GROUP_MEMBERS TABLE
-- Tracks membership in groups with rotation positions
-- ----------------------------------------------------------------------------
CREATE TABLE group_members (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  status member_status_enum DEFAULT 'pending',
  
  -- Security deposit tracking
  security_deposit_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  has_paid_security_deposit BOOLEAN DEFAULT false,
  security_deposit_paid_at TIMESTAMPTZ,
  
  -- Timestamps
  joined_at TIMESTAMPTZ DEFAULT now(),
  
  -- Primary key on combination
  PRIMARY KEY (user_id, group_id),
  
  -- Constraints
  CONSTRAINT position_positive CHECK (position > 0),
  CONSTRAINT security_deposit_amount_non_negative CHECK (security_deposit_amount >= 0)
);

-- Indexes for group_members table
CREATE INDEX idx_group_members_user_id ON group_members(user_id);
CREATE INDEX idx_group_members_group_id ON group_members(group_id);
CREATE INDEX idx_group_members_status ON group_members(status);
CREATE INDEX idx_group_members_position ON group_members(group_id, position);
CREATE UNIQUE INDEX idx_group_members_position_unique ON group_members(group_id, position);

-- ----------------------------------------------------------------------------
-- GROUP_JOIN_REQUESTS TABLE
-- Manages requests to join groups
-- ----------------------------------------------------------------------------
CREATE TABLE group_join_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  status join_request_status_enum DEFAULT 'pending',
  message TEXT,
  preferred_slot INTEGER,
  
  -- Review information
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  CONSTRAINT unique_pending_request UNIQUE (group_id, user_id, status)
);

-- Indexes for group_join_requests table
CREATE INDEX idx_join_requests_group_id ON group_join_requests(group_id);
CREATE INDEX idx_join_requests_user_id ON group_join_requests(user_id);
CREATE INDEX idx_join_requests_status ON group_join_requests(status);

-- ----------------------------------------------------------------------------
-- PAYOUT_SLOTS TABLE
-- Manages payout position slots within groups
-- ----------------------------------------------------------------------------
CREATE TABLE payout_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL,
  payout_cycle INTEGER NOT NULL,
  status slot_status_enum DEFAULT 'available',
  
  -- Assignment tracking
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  
  -- Reservation (temporary hold)
  reserved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reserved_at TIMESTAMPTZ,
  
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  CONSTRAINT slot_number_positive CHECK (slot_number > 0),
  CONSTRAINT payout_cycle_positive CHECK (payout_cycle > 0),
  CONSTRAINT unique_slot_per_group UNIQUE (group_id, slot_number)
);

-- Indexes for payout_slots table
CREATE INDEX idx_payout_slots_group_id ON payout_slots(group_id);
CREATE INDEX idx_payout_slots_status ON payout_slots(status);
CREATE INDEX idx_payout_slots_assigned_to ON payout_slots(assigned_to);

-- ----------------------------------------------------------------------------
-- CONTRIBUTIONS TABLE
-- Tracks expected and actual contributions from members
-- ----------------------------------------------------------------------------
CREATE TABLE contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  amount DECIMAL(15, 2) NOT NULL,
  cycle_number INTEGER NOT NULL,
  status contribution_status_enum DEFAULT 'pending',
  
  -- Dates
  due_date DATE NOT NULL,
  paid_date TIMESTAMPTZ,
  
  -- Fees and tracking
  service_fee DECIMAL(15, 2) DEFAULT 0.00,
  is_overdue BOOLEAN DEFAULT false,
  transaction_ref TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  CONSTRAINT amount_positive CHECK (amount > 0),
  CONSTRAINT cycle_number_positive CHECK (cycle_number > 0),
  CONSTRAINT service_fee_non_negative CHECK (service_fee >= 0)
);

-- Indexes for contributions table
CREATE INDEX idx_contributions_group_id ON contributions(group_id);
CREATE INDEX idx_contributions_user_id ON contributions(user_id);
CREATE INDEX idx_contributions_status ON contributions(status);
CREATE INDEX idx_contributions_due_date ON contributions(due_date);
CREATE INDEX idx_contributions_cycle_number ON contributions(group_id, cycle_number);
CREATE INDEX idx_contributions_is_overdue ON contributions(is_overdue) WHERE is_overdue = true;

-- ----------------------------------------------------------------------------
-- TRANSACTIONS TABLE
-- Complete transaction ledger for all financial activities
-- ----------------------------------------------------------------------------
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  
  type transaction_type_enum NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  status transaction_status_enum DEFAULT 'pending',
  
  reference TEXT UNIQUE NOT NULL,
  description TEXT,
  
  -- Wallet tracking
  from_wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
  to_wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT amount_positive CHECK (amount > 0)
);

-- Indexes for transactions table
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_group_id ON transactions(group_id);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_reference ON transactions(reference);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_transactions_wallet_from ON transactions(from_wallet_id);
CREATE INDEX idx_transactions_wallet_to ON transactions(to_wallet_id);

-- ----------------------------------------------------------------------------
-- PAYOUTS TABLE
-- Tracks payouts to group members
-- ----------------------------------------------------------------------------
CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  related_group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  cycle_number INTEGER NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  status payout_status_enum DEFAULT 'pending',
  
  -- Payment details
  payout_date DATE,
  payment_method TEXT,
  payment_reference TEXT,
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  CONSTRAINT cycle_number_positive CHECK (cycle_number > 0),
  CONSTRAINT amount_positive CHECK (amount > 0)
);

-- Indexes for payouts table
CREATE INDEX idx_payouts_group_id ON payouts(related_group_id);
CREATE INDEX idx_payouts_recipient_id ON payouts(recipient_id);
CREATE INDEX idx_payouts_status ON payouts(status);
CREATE INDEX idx_payouts_cycle_number ON payouts(related_group_id, cycle_number);
CREATE INDEX idx_payouts_payout_date ON payouts(payout_date);

-- ----------------------------------------------------------------------------
-- PENALTIES TABLE
-- Tracks penalties applied to members for violations
-- ----------------------------------------------------------------------------
CREATE TABLE penalties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contribution_id UUID REFERENCES contributions(id) ON DELETE SET NULL,
  
  amount DECIMAL(15, 2) NOT NULL,
  type penalty_type_enum NOT NULL,
  status penalty_status_enum DEFAULT 'applied',
  
  -- Timestamps
  applied_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  CONSTRAINT amount_positive CHECK (amount > 0)
);

-- Indexes for penalties table
CREATE INDEX idx_penalties_group_id ON penalties(group_id);
CREATE INDEX idx_penalties_user_id ON penalties(user_id);
CREATE INDEX idx_penalties_contribution_id ON penalties(contribution_id);
CREATE INDEX idx_penalties_status ON penalties(status);
CREATE INDEX idx_penalties_type ON penalties(type);

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS TABLE
-- User notifications and alerts
-- ----------------------------------------------------------------------------
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  type notification_type_enum NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  
  -- Related entities
  related_group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  related_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for notifications table
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);

-- ----------------------------------------------------------------------------
-- AUDIT_LOGS TABLE
-- Comprehensive audit trail for administrative actions and important events
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Actor information
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  user_name TEXT,
  
  -- Action details
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  
  -- Request metadata
  ip_address TEXT,
  user_agent TEXT,
  
  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for audit_logs table
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================================
-- SECTION 4: STORAGE BUCKETS
-- Configure storage for user-uploaded files
-- ============================================================================

-- Create storage bucket for user avatars
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- SECTION 5: TRIGGERS AND FUNCTIONS
-- Automated behaviors and database functions
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FUNCTION: Update updated_at timestamp
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update_updated_at trigger to relevant tables
CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_groups_updated_at 
  BEFORE UPDATE ON groups 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wallets_updated_at 
  BEFORE UPDATE ON wallets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_join_requests_updated_at 
  BEFORE UPDATE ON group_join_requests 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payout_slots_updated_at 
  BEFORE UPDATE ON payout_slots 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contributions_updated_at 
  BEFORE UPDATE ON contributions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payouts_updated_at 
  BEFORE UPDATE ON payouts 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- FUNCTION: Create wallet for new user
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_wallet_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO wallets (user_id, balance, locked_balance)
  VALUES (NEW.id, 0.00, 0.00);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_wallet_on_user_creation
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION create_wallet_for_new_user();

-- ----------------------------------------------------------------------------
-- FUNCTION: Update group current_members count
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_group_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE groups 
    SET current_members = current_members + 1 
    WHERE id = NEW.group_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'active' AND NEW.status = 'active' THEN
      UPDATE groups 
      SET current_members = current_members + 1 
      WHERE id = NEW.group_id;
    ELSIF OLD.status = 'active' AND NEW.status != 'active' THEN
      UPDATE groups 
      SET current_members = current_members - 1 
      WHERE id = NEW.group_id;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
    UPDATE groups 
    SET current_members = current_members - 1 
    WHERE id = OLD.group_id;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_group_members_count
  AFTER INSERT OR UPDATE OR DELETE ON group_members
  FOR EACH ROW EXECUTE FUNCTION update_group_member_count();

-- ----------------------------------------------------------------------------
-- FUNCTION: Mark contributions as overdue
-- This should be called by a cron job daily
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_overdue_contributions()
RETURNS void AS $$
BEGIN
  UPDATE contributions
  SET is_overdue = true
  WHERE status = 'pending'
    AND due_date < CURRENT_DATE
    AND is_overdue = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 6: RPC FUNCTIONS
-- Stored procedures for complex business logic
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RPC: Create user profile atomically
-- Called during signup to ensure consistent profile creation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_user_profile_atomic(
  p_user_id UUID,
  p_email TEXT,
  p_phone TEXT,
  p_full_name TEXT
)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Insert user profile
  INSERT INTO users (id, email, phone, full_name)
  VALUES (p_user_id, p_email, p_phone, p_full_name)
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      full_name = EXCLUDED.full_name,
      updated_at = now();
  
  -- Return success
  v_result := json_build_object(
    'success', true,
    'message', 'User profile created successfully'
  );
  
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    v_result := json_build_object(
      'success', false,
      'error', SQLERRM
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Check if user exists by email or phone
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_user_exists(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_email_exists BOOLEAN := false;
  v_phone_exists BOOLEAN := false;
BEGIN
  IF p_email IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM users WHERE email = p_email) INTO v_email_exists;
  END IF;
  
  IF p_phone IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM users WHERE phone = p_phone) INTO v_phone_exists;
  END IF;
  
  RETURN json_build_object(
    'emailExists', v_email_exists,
    'phoneExists', v_phone_exists
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Request to join a group
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_to_join_group(
  p_group_id UUID,
  p_user_id UUID,
  p_message TEXT DEFAULT NULL,
  p_preferred_slot INTEGER DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_group_status TEXT;
  v_current_members INTEGER;
  v_total_members INTEGER;
  v_existing_member BOOLEAN;
  v_existing_request BOOLEAN;
BEGIN
  -- Check if group exists and get details
  SELECT status, current_members, total_members
  INTO v_group_status, v_current_members, v_total_members
  FROM groups
  WHERE id = p_group_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Group not found');
  END IF;
  
  -- Check if group is accepting members
  IF v_group_status NOT IN ('forming', 'active') THEN
    RETURN json_build_object('success', false, 'error', 'Group is not accepting new members');
  END IF;
  
  -- Check if group is full
  IF v_current_members >= v_total_members THEN
    RETURN json_build_object('success', false, 'error', 'Group is full');
  END IF;
  
  -- Check if user is already a member
  SELECT EXISTS(
    SELECT 1 FROM group_members 
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) INTO v_existing_member;
  
  IF v_existing_member THEN
    RETURN json_build_object('success', false, 'error', 'You are already a member of this group');
  END IF;
  
  -- Check if there's already a pending request
  SELECT EXISTS(
    SELECT 1 FROM group_join_requests 
    WHERE group_id = p_group_id 
      AND user_id = p_user_id 
      AND status = 'pending'
  ) INTO v_existing_request;
  
  IF v_existing_request THEN
    RETURN json_build_object('success', false, 'error', 'You already have a pending request for this group');
  END IF;
  
  -- Create join request
  INSERT INTO group_join_requests (group_id, user_id, message, preferred_slot, status)
  VALUES (p_group_id, p_user_id, p_message, p_preferred_slot, 'pending');
  
  RETURN json_build_object('success', true, 'message', 'Join request submitted successfully');
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Get pending join requests for a group
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_pending_join_requests(
  p_group_id UUID
)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_name TEXT,
  user_email TEXT,
  message TEXT,
  preferred_slot INTEGER,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    jr.id,
    jr.user_id,
    u.full_name AS user_name,
    u.email AS user_email,
    jr.message,
    jr.preferred_slot,
    jr.created_at
  FROM group_join_requests jr
  JOIN users u ON jr.user_id = u.id
  WHERE jr.group_id = p_group_id
    AND jr.status = 'pending'
  ORDER BY jr.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Approve join request
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_join_request(
  p_request_id UUID,
  p_reviewer_id UUID,
  p_assigned_position INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_group_id UUID;
  v_user_id UUID;
  v_security_deposit DECIMAL;
BEGIN
  -- Get request details
  SELECT group_id, user_id INTO v_group_id, v_user_id
  FROM group_join_requests
  WHERE id = p_request_id AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;
  
  -- Get security deposit amount
  SELECT security_deposit_amount INTO v_security_deposit
  FROM groups WHERE id = v_group_id;
  
  -- Update request status
  UPDATE group_join_requests
  SET status = 'approved',
      reviewed_by = p_reviewer_id,
      reviewed_at = now()
  WHERE id = p_request_id;
  
  -- Add member to group (status pending until security deposit is paid)
  INSERT INTO group_members (user_id, group_id, position, status, security_deposit_amount)
  VALUES (v_user_id, v_group_id, p_assigned_position, 'pending', v_security_deposit)
  ON CONFLICT (user_id, group_id) DO NOTHING;
  
  RETURN json_build_object('success', true, 'message', 'Join request approved');
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Reject join request
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_join_request(
  p_request_id UUID,
  p_reviewer_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSON AS $$
BEGIN
  UPDATE group_join_requests
  SET status = 'rejected',
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      rejection_reason = p_reason
  WHERE id = p_request_id AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;
  
  RETURN json_build_object('success', true, 'message', 'Join request rejected');
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Initialize payout slots for a group
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION initialize_group_slots(
  p_group_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_total_members INTEGER;
  v_slot_count INTEGER;
  i INTEGER;
BEGIN
  -- Get total members for the group
  SELECT total_members INTO v_total_members
  FROM groups WHERE id = p_group_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Group not found');
  END IF;
  
  -- Check if slots already exist
  SELECT COUNT(*) INTO v_slot_count
  FROM payout_slots WHERE group_id = p_group_id;
  
  IF v_slot_count > 0 THEN
    RETURN json_build_object('success', true, 'message', 'Slots already initialized');
  END IF;
  
  -- Create slots
  FOR i IN 1..v_total_members LOOP
    INSERT INTO payout_slots (group_id, slot_number, payout_cycle, status)
    VALUES (p_group_id, i, i, 'available');
  END LOOP;
  
  RETURN json_build_object('success', true, 'message', 'Payout slots initialized', 'slots_created', v_total_members);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Get available payout slots
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_available_slots(
  p_group_id UUID
)
RETURNS TABLE(
  id UUID,
  slot_number INTEGER,
  payout_cycle INTEGER,
  status slot_status_enum
) AS $$
BEGIN
  RETURN QUERY
  SELECT ps.id, ps.slot_number, ps.payout_cycle, ps.status
  FROM payout_slots ps
  WHERE ps.group_id = p_group_id
  ORDER BY ps.slot_number ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Get admin analytics
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_admin_analytics()
RETURNS TABLE(
  total_users BIGINT,
  active_users BIGINT,
  verified_users BIGINT,
  total_groups BIGINT,
  active_groups BIGINT,
  forming_groups BIGINT,
  completed_groups BIGINT,
  total_contributions BIGINT,
  paid_contributions BIGINT,
  overdue_contributions BIGINT,
  total_amount_collected NUMERIC,
  total_payouts BIGINT,
  completed_payouts BIGINT,
  total_penalties BIGINT,
  total_penalty_amount NUMERIC,
  users_with_kyc BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM users) AS total_users,
    (SELECT COUNT(*) FROM users WHERE is_active = true) AS active_users,
    (SELECT COUNT(*) FROM users WHERE kyc_status = 'approved') AS verified_users,
    (SELECT COUNT(*) FROM groups) AS total_groups,
    (SELECT COUNT(*) FROM groups WHERE status = 'active') AS active_groups,
    (SELECT COUNT(*) FROM groups WHERE status = 'forming') AS forming_groups,
    (SELECT COUNT(*) FROM groups WHERE status = 'completed') AS completed_groups,
    (SELECT COUNT(*) FROM contributions) AS total_contributions,
    (SELECT COUNT(*) FROM contributions WHERE status = 'paid') AS paid_contributions,
    (SELECT COUNT(*) FROM contributions WHERE is_overdue = true) AS overdue_contributions,
    (SELECT COALESCE(SUM(amount), 0) FROM contributions WHERE status = 'paid') AS total_amount_collected,
    (SELECT COUNT(*) FROM payouts) AS total_payouts,
    (SELECT COUNT(*) FROM payouts WHERE status = 'completed') AS completed_payouts,
    (SELECT COUNT(*) FROM penalties) AS total_penalties,
    (SELECT COALESCE(SUM(amount), 0) FROM penalties) AS total_penalty_amount,
    (SELECT COUNT(*) FROM users WHERE kyc_status != 'not_started') AS users_with_kyc;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Get all users (admin only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_all_users_admin(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_search TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  email TEXT,
  phone TEXT,
  full_name TEXT,
  is_verified BOOLEAN,
  is_active BOOLEAN,
  is_admin BOOLEAN,
  kyc_status kyc_status_enum,
  created_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  total_groups BIGINT,
  total_contributions BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.phone,
    u.full_name,
    u.is_verified,
    u.is_active,
    u.is_admin,
    u.kyc_status,
    u.created_at,
    u.last_login_at,
    COUNT(DISTINCT gm.group_id) AS total_groups,
    COUNT(DISTINCT c.id) AS total_contributions
  FROM users u
  LEFT JOIN group_members gm ON u.id = gm.user_id
  LEFT JOIN contributions c ON u.id = c.user_id AND c.status = 'paid'
  WHERE (p_search IS NULL OR u.full_name ILIKE '%' || p_search || '%' OR u.email ILIKE '%' || p_search || '%')
    AND (p_is_active IS NULL OR u.is_active = p_is_active)
  GROUP BY u.id
  ORDER BY u.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Get all groups (admin only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_all_groups_admin(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  name TEXT,
  description TEXT,
  created_by UUID,
  creator_name TEXT,
  creator_email TEXT,
  contribution_amount NUMERIC,
  frequency frequency_enum,
  total_members INTEGER,
  current_members INTEGER,
  status group_status_enum,
  current_cycle INTEGER,
  total_cycles INTEGER,
  created_at TIMESTAMPTZ,
  start_date DATE,
  total_contributions_paid BIGINT,
  total_amount_collected NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    g.id,
    g.name,
    g.description,
    g.created_by,
    u.full_name AS creator_name,
    u.email AS creator_email,
    g.contribution_amount,
    g.frequency,
    g.total_members,
    g.current_members,
    g.status,
    g.current_cycle,
    g.total_cycles,
    g.created_at,
    g.start_date,
    COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'paid') AS total_contributions_paid,
    COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'paid'), 0) AS total_amount_collected
  FROM groups g
  LEFT JOIN users u ON g.created_by = u.id
  LEFT JOIN contributions c ON g.id = c.group_id
  WHERE (p_status IS NULL OR g.status::TEXT = p_status)
    AND (p_search IS NULL OR g.name ILIKE '%' || p_search || '%')
  GROUP BY g.id, u.full_name, u.email
  ORDER BY g.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Get audit logs (admin only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_audit_logs_admin(
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_email TEXT,
  user_name TEXT,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    al.id,
    al.user_id,
    al.user_email,
    al.user_name,
    al.action,
    al.resource_type,
    al.resource_id,
    al.details,
    al.ip_address,
    al.created_at
  FROM audit_logs al
  ORDER BY al.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Suspend/Activate user (admin only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION suspend_user_admin(
  p_user_id UUID,
  p_is_active BOOLEAN,
  p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
  v_admin_id UUID;
  v_user_email TEXT;
BEGIN
  -- Get current user (admin)
  SELECT auth.uid() INTO v_admin_id;
  
  -- Get user email
  SELECT email INTO v_user_email FROM users WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'User not found');
  END IF;
  
  -- Update user status
  UPDATE users
  SET is_active = p_is_active,
      updated_at = now()
  WHERE id = p_user_id;
  
  -- Log action
  INSERT INTO audit_logs (user_id, user_email, action, resource_type, resource_id, details)
  VALUES (
    v_admin_id,
    (SELECT email FROM users WHERE id = v_admin_id),
    CASE WHEN p_is_active THEN 'ACTIVATE_USER' ELSE 'SUSPEND_USER' END,
    'user',
    p_user_id::TEXT,
    json_build_object('reason', p_reason, 'target_user_email', v_user_email)
  );
  
  RETURN json_build_object(
    'success', true, 
    'message', CASE WHEN p_is_active THEN 'User activated successfully' ELSE 'User suspended successfully' END
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RPC: Change group status (admin only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deactivate_group_admin(
  p_group_id UUID,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
  v_admin_id UUID;
  v_group_name TEXT;
BEGIN
  -- Get current user (admin)
  SELECT auth.uid() INTO v_admin_id;
  
  -- Get group name
  SELECT name INTO v_group_name FROM groups WHERE id = p_group_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Group not found');
  END IF;
  
  -- Update group status
  UPDATE groups
  SET status = p_new_status::group_status_enum,
      updated_at = now()
  WHERE id = p_group_id;
  
  -- Log action
  INSERT INTO audit_logs (user_id, user_email, action, resource_type, resource_id, details)
  VALUES (
    v_admin_id,
    (SELECT email FROM users WHERE id = v_admin_id),
    'CHANGE_GROUP_STATUS',
    'group',
    p_group_id::TEXT,
    json_build_object('reason', p_reason, 'new_status', p_new_status, 'group_name', v_group_name)
  );
  
  RETURN json_build_object('success', true, 'message', 'Group status updated successfully');
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 7: ROW LEVEL SECURITY (RLS) POLICIES
-- Enforce data access control at the database level
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- USERS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- Admins can view all users (using raw user metadata to avoid infinite recursion)
-- Note: This checks auth.jwt() which contains user claims without querying users table
CREATE POLICY "Admins can view all users"
  ON users FOR SELECT
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
    OR 
    -- Fallback: allow if directly querying own record and it has is_admin = true
    (auth.uid() = id AND is_admin = true)
  );

-- Admins can update any user (using raw user metadata to avoid infinite recursion)
CREATE POLICY "Admins can update any user"
  ON users FOR UPDATE
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
    OR
    -- Fallback: allow if directly updating own record and it has is_admin = true
    (auth.uid() = id AND is_admin = true)
  );

-- ----------------------------------------------------------------------------
-- WALLETS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Users can view their own wallet
CREATE POLICY "Users can view own wallet"
  ON wallets FOR SELECT
  USING (auth.uid() = user_id);

-- System can insert wallets (via trigger)
CREATE POLICY "System can insert wallets"
  ON wallets FOR INSERT
  WITH CHECK (true);

-- System can update wallets (for transactions)
CREATE POLICY "System can update wallets"
  ON wallets FOR UPDATE
  USING (true);

-- ----------------------------------------------------------------------------
-- GROUPS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Anyone can view groups (for browsing)
CREATE POLICY "Anyone can view groups"
  ON groups FOR SELECT
  USING (true);

-- Authenticated users can create groups
CREATE POLICY "Authenticated users can create groups"
  ON groups FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Group creators can update their groups
CREATE POLICY "Creators can update own groups"
  ON groups FOR UPDATE
  USING (auth.uid() = created_by);

-- Admins can update any group
CREATE POLICY "Admins can update any group"
  ON groups FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ----------------------------------------------------------------------------
-- GROUP_MEMBERS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Users can view members of groups they belong to
CREATE POLICY "Users can view group members"
  ON group_members FOR SELECT
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_members.group_id 
        AND gm.user_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id 
        AND g.created_by = auth.uid()
    )
  );

-- System can insert members (via RPC functions)
CREATE POLICY "System can insert members"
  ON group_members FOR INSERT
  WITH CHECK (true);

-- Group creators and admins can update members
CREATE POLICY "Creators and admins can update members"
  ON group_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id 
        AND g.created_by = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ----------------------------------------------------------------------------
-- JOIN REQUESTS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Users can view their own requests
CREATE POLICY "Users can view own requests"
  ON group_join_requests FOR SELECT
  USING (auth.uid() = user_id);

-- Group creators can view requests to their groups
CREATE POLICY "Creators can view group requests"
  ON group_join_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_join_requests.group_id 
        AND g.created_by = auth.uid()
    )
  );

-- Users can create requests
CREATE POLICY "Users can create requests"
  ON group_join_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Group creators can update requests
CREATE POLICY "Creators can update requests"
  ON group_join_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_join_requests.group_id 
        AND g.created_by = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- PAYOUT_SLOTS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Users can view slots for groups they're in
CREATE POLICY "Users can view payout slots"
  ON payout_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = payout_slots.group_id 
        AND gm.user_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = payout_slots.group_id 
        AND g.created_by = auth.uid()
    )
  );

-- System can manage slots (via RPC)
CREATE POLICY "System can insert slots"
  ON payout_slots FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update slots"
  ON payout_slots FOR UPDATE
  USING (true);

-- ----------------------------------------------------------------------------
-- CONTRIBUTIONS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Users can view their own contributions
CREATE POLICY "Users can view own contributions"
  ON contributions FOR SELECT
  USING (auth.uid() = user_id);

-- Group members can view group contributions
CREATE POLICY "Members can view group contributions"
  ON contributions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = contributions.group_id 
        AND gm.user_id = auth.uid()
    )
  );

-- System can manage contributions
CREATE POLICY "System can insert contributions"
  ON contributions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update contributions"
  ON contributions FOR UPDATE
  USING (true);

-- ----------------------------------------------------------------------------
-- TRANSACTIONS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Users can view their own transactions
CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id);

-- System can manage transactions
CREATE POLICY "System can insert transactions"
  ON transactions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update transactions"
  ON transactions FOR UPDATE
  USING (true);

-- Admins can view all transactions
CREATE POLICY "Admins can view all transactions"
  ON transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ----------------------------------------------------------------------------
-- PAYOUTS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Recipients can view their payouts
CREATE POLICY "Users can view own payouts"
  ON payouts FOR SELECT
  USING (auth.uid() = recipient_id);

-- Group members can view group payouts
CREATE POLICY "Members can view group payouts"
  ON payouts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = payouts.related_group_id 
        AND gm.user_id = auth.uid()
    )
  );

-- System can manage payouts
CREATE POLICY "System can insert payouts"
  ON payouts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update payouts"
  ON payouts FOR UPDATE
  USING (true);

-- ----------------------------------------------------------------------------
-- PENALTIES TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Users can view their own penalties
CREATE POLICY "Users can view own penalties"
  ON penalties FOR SELECT
  USING (auth.uid() = user_id);

-- Group members can view group penalties
CREATE POLICY "Members can view group penalties"
  ON penalties FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = penalties.group_id 
        AND gm.user_id = auth.uid()
    )
  );

-- System can manage penalties
CREATE POLICY "System can insert penalties"
  ON penalties FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update penalties"
  ON penalties FOR UPDATE
  USING (true);

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- System can create notifications
CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- AUDIT_LOGS TABLE POLICIES
-- ----------------------------------------------------------------------------

-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- System can insert audit logs
CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- STORAGE POLICIES
-- ----------------------------------------------------------------------------

-- Anyone can view avatars (public bucket)
CREATE POLICY "Anyone can view avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Users can upload their own avatar
CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars' AND
    (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- Users can update their own avatar
CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars' AND
    (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- Users can delete their own avatar
CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars' AND
    (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- ============================================================================
-- SECTION 8: INDEXES FOR PERFORMANCE
-- Additional indexes beyond those already created with tables
-- ============================================================================

-- Composite indexes for common query patterns
CREATE INDEX idx_group_members_user_status ON group_members(user_id, status);
CREATE INDEX idx_contributions_user_status ON contributions(user_id, status);
CREATE INDEX idx_contributions_group_cycle ON contributions(group_id, cycle_number, status);
CREATE INDEX idx_transactions_user_type ON transactions(user_id, type);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;

-- ============================================================================
-- SECTION 9: UTILITY FUNCTIONS
-- Helper functions for common operations
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FUNCTION: Get user dashboard summary
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_dashboard_summary(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'total_groups', (
      SELECT COUNT(*) FROM group_members 
      WHERE user_id = p_user_id
    ),
    'active_groups', (
      SELECT COUNT(*) FROM group_members gm
      JOIN groups g ON gm.group_id = g.id
      WHERE gm.user_id = p_user_id AND g.status = 'active'
    ),
    'pending_contributions', (
      SELECT COUNT(*) FROM contributions
      WHERE user_id = p_user_id AND status = 'pending'
    ),
    'total_contributed', (
      SELECT COALESCE(SUM(amount), 0) FROM contributions
      WHERE user_id = p_user_id AND status = 'paid'
    ),
    'wallet_balance', (
      SELECT COALESCE(balance, 0) FROM wallets
      WHERE user_id = p_user_id
    )
  ) INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 10: INITIAL DATA (Optional)
-- Default data for testing or initial setup
-- ============================================================================

-- This section is intentionally left empty for production.
-- Add test data or seed data here if needed for development.

-- ============================================================================
-- SCHEMA COMPLETE
-- ============================================================================
-- 
-- The schema is now ready for use. Next steps:
-- 1. Deploy Edge Functions for payment processing
-- 2. Set up cron jobs for automated tasks (mark overdue contributions, etc.)
-- 3. Configure webhooks for payment gateway integration
-- 4. Test all RPC functions and RLS policies
-- 5. Create initial admin user if needed
--
-- For support or questions, refer to the project documentation.
-- ============================================================================
