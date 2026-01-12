-- ============================================================================
-- SYSTEM ADMIN FUNCTIONS
-- ============================================================================
-- This file contains RPC functions specifically for platform administrators
-- to manage the entire Smart Ajo system.
--
-- IMPORTANT: 
-- - All functions require the caller to be a system admin (is_admin = TRUE)
-- - All admin actions are logged to audit_logs table
-- - Admins CANNOT contribute to groups or receive payouts
-- ============================================================================

-- ============================================================================
-- HELPER FUNCTION: log_admin_action
-- ============================================================================
-- Logs admin actions to the audit_logs table
-- ============================================================================

CREATE OR REPLACE FUNCTION log_admin_action(
  p_action VARCHAR(100),
  p_resource_type VARCHAR(50),
  p_resource_id UUID,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    details,
    created_at
  ) VALUES (
    auth.uid(),
    p_action,
    p_resource_type,
    p_resource_id,
    p_details,
    NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_admin_action IS 
  'Logs admin actions to audit_logs table for compliance and security tracking';

-- ============================================================================
-- RPC: get_all_users_admin
-- ============================================================================
-- Retrieves all users with pagination and optional filters
-- Only accessible by system admins
-- ============================================================================

CREATE OR REPLACE FUNCTION get_all_users_admin(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_search TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  email VARCHAR(255),
  phone VARCHAR(20),
  full_name VARCHAR(255),
  is_verified BOOLEAN,
  is_active BOOLEAN,
  is_admin BOOLEAN,
  kyc_status VARCHAR(50),
  created_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  total_groups BIGINT,
  total_contributions BIGINT
) AS $$
BEGIN
  -- Check if current user is admin
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Access denied. System admin privileges required.';
  END IF;

  -- Log the action
  PERFORM log_admin_action('view_all_users', 'users', NULL, 
    jsonb_build_object('limit', p_limit, 'offset', p_offset, 'search', p_search));

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
  LEFT JOIN contributions c ON u.id = c.user_id
  WHERE 
    (p_search IS NULL OR 
     u.full_name ILIKE '%' || p_search || '%' OR 
     u.email ILIKE '%' || p_search || '%' OR
     u.phone ILIKE '%' || p_search || '%')
    AND (p_is_active IS NULL OR u.is_active = p_is_active)
  GROUP BY u.id
  ORDER BY u.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_all_users_admin IS 
  'Returns all users with pagination and optional search/filters. Admin only.';

GRANT EXECUTE ON FUNCTION get_all_users_admin TO authenticated;

-- ============================================================================
-- RPC: get_all_groups_admin
-- ============================================================================
-- Retrieves all groups with metadata and pagination
-- Only accessible by system admins
-- ============================================================================

CREATE OR REPLACE FUNCTION get_all_groups_admin(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_status VARCHAR(20) DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  name VARCHAR(255),
  description TEXT,
  created_by UUID,
  creator_name VARCHAR(255),
  creator_email VARCHAR(255),
  contribution_amount DECIMAL(15, 2),
  frequency VARCHAR(20),
  total_members INTEGER,
  current_members INTEGER,
  status VARCHAR(20),
  current_cycle INTEGER,
  total_cycles INTEGER,
  created_at TIMESTAMPTZ,
  start_date TIMESTAMPTZ,
  total_contributions_paid BIGINT,
  total_amount_collected DECIMAL(15, 2)
) AS $$
BEGIN
  -- Check if current user is admin
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Access denied. System admin privileges required.';
  END IF;

  -- Log the action
  PERFORM log_admin_action('view_all_groups', 'groups', NULL,
    jsonb_build_object('limit', p_limit, 'offset', p_offset, 'status', p_status, 'search', p_search));

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
    COUNT(CASE WHEN c.status = 'paid' THEN 1 END) AS total_contributions_paid,
    COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END), 0) AS total_amount_collected
  FROM groups g
  LEFT JOIN users u ON g.created_by = u.id
  LEFT JOIN contributions c ON g.id = c.group_id
  WHERE 
    (p_status IS NULL OR g.status = p_status)
    AND (p_search IS NULL OR 
         g.name ILIKE '%' || p_search || '%' OR
         g.description ILIKE '%' || p_search || '%')
  GROUP BY g.id, u.full_name, u.email
  ORDER BY g.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_all_groups_admin IS 
  'Returns all groups with metadata and pagination. Admin only.';

GRANT EXECUTE ON FUNCTION get_all_groups_admin TO authenticated;

-- ============================================================================
-- RPC: suspend_user_admin
-- ============================================================================
-- Suspends or activates a user account
-- Only accessible by system admins
-- ============================================================================

CREATE OR REPLACE FUNCTION suspend_user_admin(
  p_user_id UUID,
  p_is_active BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_user_email VARCHAR(255);
  v_action VARCHAR(50);
BEGIN
  -- Check if current user is admin
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Access denied. System admin privileges required.';
  END IF;

  -- Cannot suspend yourself
  IF p_user_id = auth.uid() THEN
    RETURN QUERY SELECT FALSE, 'Cannot suspend your own account'::TEXT;
    RETURN;
  END IF;

  -- Cannot suspend other admins
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND is_admin = TRUE) THEN
    RETURN QUERY SELECT FALSE, 'Cannot suspend another admin account'::TEXT;
    RETURN;
  END IF;

  -- Get user email for logging
  SELECT email INTO v_user_email FROM users WHERE id = p_user_id;

  IF v_user_email IS NULL THEN
    RETURN QUERY SELECT FALSE, 'User not found'::TEXT;
    RETURN;
  END IF;

  -- Update user status
  UPDATE users
  SET is_active = p_is_active,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- Determine action for logging
  v_action := CASE WHEN p_is_active THEN 'activate_user' ELSE 'suspend_user' END;

  -- Log the action
  PERFORM log_admin_action(
    v_action,
    'users',
    p_user_id,
    jsonb_build_object(
      'user_email', v_user_email,
      'is_active', p_is_active,
      'reason', p_reason
    )
  );

  RETURN QUERY SELECT TRUE, 
    CASE 
      WHEN p_is_active THEN 'User activated successfully'
      ELSE 'User suspended successfully'
    END::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION suspend_user_admin IS 
  'Suspends or activates a user account. Admin only.';

GRANT EXECUTE ON FUNCTION suspend_user_admin TO authenticated;

-- ============================================================================
-- RPC: deactivate_group_admin
-- ============================================================================
-- Freezes (pauses) or activates a group
-- Only accessible by system admins
-- ============================================================================

CREATE OR REPLACE FUNCTION deactivate_group_admin(
  p_group_id UUID,
  p_new_status VARCHAR(20),
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_group_name VARCHAR(255);
  v_old_status VARCHAR(20);
BEGIN
  -- Check if current user is admin
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Access denied. System admin privileges required.';
  END IF;

  -- Validate status
  IF p_new_status NOT IN ('active', 'paused', 'cancelled') THEN
    RETURN QUERY SELECT FALSE, 'Invalid status. Must be active, paused, or cancelled'::TEXT;
    RETURN;
  END IF;

  -- Get group details
  SELECT name, status INTO v_group_name, v_old_status
  FROM groups
  WHERE id = p_group_id;

  IF v_group_name IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Group not found'::TEXT;
    RETURN;
  END IF;

  -- Update group status
  UPDATE groups
  SET status = p_new_status,
      updated_at = NOW()
  WHERE id = p_group_id;

  -- Log the action
  PERFORM log_admin_action(
    'change_group_status',
    'groups',
    p_group_id,
    jsonb_build_object(
      'group_name', v_group_name,
      'old_status', v_old_status,
      'new_status', p_new_status,
      'reason', p_reason
    )
  );

  RETURN QUERY SELECT TRUE, 
    'Group status updated to ' || p_new_status || ' successfully'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION deactivate_group_admin IS 
  'Changes group status (active/paused/cancelled). Admin only.';

GRANT EXECUTE ON FUNCTION deactivate_group_admin TO authenticated;

-- ============================================================================
-- RPC: get_admin_analytics
-- ============================================================================
-- Retrieves platform-wide statistics and analytics
-- Only accessible by system admins
-- ============================================================================

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
  total_amount_collected DECIMAL(15, 2),
  total_payouts BIGINT,
  completed_payouts BIGINT,
  total_penalties BIGINT,
  total_penalty_amount DECIMAL(15, 2),
  users_with_kyc BIGINT
) AS $$
BEGIN
  -- Check if current user is admin
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Access denied. System admin privileges required.';
  END IF;

  -- Log the action
  PERFORM log_admin_action('view_analytics', 'system', NULL, '{}'::jsonb);

  RETURN QUERY
  SELECT 
    -- User statistics
    (SELECT COUNT(*) FROM users)::BIGINT AS total_users,
    (SELECT COUNT(*) FROM users WHERE is_active = TRUE)::BIGINT AS active_users,
    (SELECT COUNT(*) FROM users WHERE is_verified = TRUE)::BIGINT AS verified_users,
    
    -- Group statistics
    (SELECT COUNT(*) FROM groups)::BIGINT AS total_groups,
    (SELECT COUNT(*) FROM groups WHERE status = 'active')::BIGINT AS active_groups,
    (SELECT COUNT(*) FROM groups WHERE status = 'forming')::BIGINT AS forming_groups,
    (SELECT COUNT(*) FROM groups WHERE status = 'completed')::BIGINT AS completed_groups,
    
    -- Contribution statistics
    (SELECT COUNT(*) FROM contributions)::BIGINT AS total_contributions,
    (SELECT COUNT(*) FROM contributions WHERE status = 'paid')::BIGINT AS paid_contributions,
    (SELECT COUNT(*) FROM contributions WHERE status = 'overdue')::BIGINT AS overdue_contributions,
    (SELECT COALESCE(SUM(amount), 0) FROM contributions WHERE status = 'paid')::DECIMAL(15, 2) AS total_amount_collected,
    
    -- Payout statistics
    (SELECT COUNT(*) FROM payouts)::BIGINT AS total_payouts,
    (SELECT COUNT(*) FROM payouts WHERE status = 'completed')::BIGINT AS completed_payouts,
    
    -- Penalty statistics
    (SELECT COUNT(*) FROM penalties)::BIGINT AS total_penalties,
    (SELECT COALESCE(SUM(amount), 0) FROM penalties)::DECIMAL(15, 2) AS total_penalty_amount,
    
    -- KYC statistics
    (SELECT COUNT(*) FROM users WHERE kyc_status = 'approved')::BIGINT AS users_with_kyc;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_admin_analytics IS 
  'Returns platform-wide analytics and statistics. Admin only.';

GRANT EXECUTE ON FUNCTION get_admin_analytics TO authenticated;

-- ============================================================================
-- RPC: get_audit_logs_admin
-- ============================================================================
-- Retrieves audit logs with pagination and filters
-- Only accessible by system admins
-- ============================================================================

CREATE OR REPLACE FUNCTION get_audit_logs_admin(
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0,
  p_user_id UUID DEFAULT NULL,
  p_action VARCHAR(100) DEFAULT NULL,
  p_resource_type VARCHAR(50) DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_email VARCHAR(255),
  user_name VARCHAR(255),
  action VARCHAR(100),
  resource_type VARCHAR(50),
  resource_id UUID,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Check if current user is admin
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Access denied. System admin privileges required.';
  END IF;

  RETURN QUERY
  SELECT 
    al.id,
    al.user_id,
    u.email AS user_email,
    u.full_name AS user_name,
    al.action,
    al.resource_type,
    al.resource_id,
    al.details,
    al.ip_address,
    al.created_at
  FROM audit_logs al
  LEFT JOIN users u ON al.user_id = u.id
  WHERE 
    (p_user_id IS NULL OR al.user_id = p_user_id)
    AND (p_action IS NULL OR al.action = p_action)
    AND (p_resource_type IS NULL OR al.resource_type = p_resource_type)
  ORDER BY al.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_audit_logs_admin IS 
  'Returns audit logs with pagination and filters. Admin only.';

GRANT EXECUTE ON FUNCTION get_audit_logs_admin TO authenticated;

-- ============================================================================
-- RPC: get_user_details_admin
-- ============================================================================
-- Retrieves detailed information about a specific user
-- Only accessible by system admins
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_details_admin(p_user_id UUID)
RETURNS TABLE(
  id UUID,
  email VARCHAR(255),
  phone VARCHAR(20),
  full_name VARCHAR(255),
  is_verified BOOLEAN,
  is_active BOOLEAN,
  is_admin BOOLEAN,
  kyc_status VARCHAR(50),
  kyc_data JSONB,
  avatar_url TEXT,
  date_of_birth DATE,
  address TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  total_groups BIGINT,
  active_groups BIGINT,
  total_contributions BIGINT,
  paid_contributions BIGINT,
  total_contributed_amount DECIMAL(15, 2),
  total_penalties BIGINT,
  total_penalty_amount DECIMAL(15, 2)
) AS $$
BEGIN
  -- Check if current user is admin
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Access denied. System admin privileges required.';
  END IF;

  -- Log the action
  PERFORM log_admin_action('view_user_details', 'users', p_user_id, '{}'::jsonb);

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
    u.kyc_data,
    u.avatar_url,
    u.date_of_birth,
    u.address,
    u.created_at,
    u.updated_at,
    u.last_login_at,
    COUNT(DISTINCT gm.group_id) AS total_groups,
    COUNT(DISTINCT CASE WHEN g.status = 'active' THEN gm.group_id END) AS active_groups,
    COUNT(c.id) AS total_contributions,
    COUNT(CASE WHEN c.status = 'paid' THEN c.id END) AS paid_contributions,
    COALESCE(SUM(CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END), 0) AS total_contributed_amount,
    COUNT(p.id) AS total_penalties,
    COALESCE(SUM(p.amount), 0) AS total_penalty_amount
  FROM users u
  LEFT JOIN group_members gm ON u.id = gm.user_id
  LEFT JOIN groups g ON gm.group_id = g.id
  LEFT JOIN contributions c ON u.id = c.user_id
  LEFT JOIN penalties p ON u.id = p.user_id
  WHERE u.id = p_user_id
  GROUP BY u.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_user_details_admin IS 
  'Returns detailed information about a specific user. Admin only.';

GRANT EXECUTE ON FUNCTION get_user_details_admin TO authenticated;

-- ============================================================================
-- CONSTRAINT: Prevent admins from joining groups as members
-- ============================================================================
-- This trigger prevents system admins from joining groups to ensure
-- they remain observers and cannot contribute or receive payouts
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_admin_group_membership()
RETURNS TRIGGER AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Check if user is an admin
  SELECT is_admin INTO v_is_admin
  FROM users
  WHERE id = NEW.user_id;

  IF v_is_admin = TRUE THEN
    RAISE EXCEPTION 'System administrators cannot join groups as members';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS prevent_admin_membership ON group_members;

CREATE TRIGGER prevent_admin_membership
  BEFORE INSERT OR UPDATE ON group_members
  FOR EACH ROW
  EXECUTE FUNCTION prevent_admin_group_membership();

COMMENT ON FUNCTION prevent_admin_group_membership IS 
  'Prevents system admins from joining groups to maintain separation of duties';

-- ============================================================================
-- CONSTRAINT: Prevent admins from receiving payouts
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_admin_payouts()
RETURNS TRIGGER AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Check if recipient is an admin
  SELECT is_admin INTO v_is_admin
  FROM users
  WHERE id = NEW.recipient_id;

  IF v_is_admin = TRUE THEN
    RAISE EXCEPTION 'System administrators cannot receive payouts';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS prevent_admin_payout ON payouts;

CREATE TRIGGER prevent_admin_payout
  BEFORE INSERT OR UPDATE ON payouts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_admin_payouts();

COMMENT ON FUNCTION prevent_admin_payouts IS 
  'Prevents system admins from receiving payouts to maintain separation of duties';

-- ============================================================================
-- END OF SYSTEM ADMIN FUNCTIONS
-- ============================================================================
