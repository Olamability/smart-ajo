-- Migration: Add is_admin field to users table
-- This migration adds platform admin functionality to the SmartAjo system

-- Add is_admin column to users table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN users.is_admin IS 'Platform administrator flag - allows full access to all groups and data';
  END IF;
END $$;

-- Create index on is_admin if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);

-- Update RLS policies to allow admin access
-- These policies are already updated in the main schema.sql file
-- This is just a reference for what changed:

-- Groups policies updated:
--   - groups_select_public: Added admin check
--   - groups_update_creator: Added admin check

-- Group members policies updated:
--   - group_members_select_own_groups: Added admin check
--   - group_members_update_own: Added admin check

-- Contributions policies updated:
--   - contributions_select_own_groups: Added admin check
--   - contributions_update_own: Added admin check

-- Payouts policies updated:
--   - payouts_select_own_groups: Added admin check

-- Penalties policies updated:
--   - penalties_select_own: Added admin check

-- Transactions policies updated:
--   - transactions_select_own: Added admin check

-- Notifications policies updated:
--   - notifications_select_own: Added admin check

-- Note: The is_current_user_admin() function is defined in the main schema.sql file.
-- If you're running this migration on an existing database, ensure the function exists.

-- Function to promote a user to admin (use with caution)
CREATE OR REPLACE FUNCTION promote_user_to_admin(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Find user by email
  SELECT id INTO v_user_id
  FROM users
  WHERE email = user_email;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;

  -- Update user to admin
  UPDATE users
  SET is_admin = TRUE, updated_at = NOW()
  WHERE id = v_user_id;

  RETURN TRUE;
END;
$$;

-- Function to revoke admin privileges
CREATE OR REPLACE FUNCTION revoke_admin_privileges(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Find user by email
  SELECT id INTO v_user_id
  FROM users
  WHERE email = user_email;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', user_email;
  END IF;

  -- Revoke admin privileges
  UPDATE users
  SET is_admin = FALSE, updated_at = NOW()
  WHERE id = v_user_id;

  RETURN TRUE;
END;
$$;

-- Function to check if current user is admin (for backwards compatibility with migration)
-- Note: This function is also defined in the main schema.sql file
-- We include it here to ensure migrations work standalone
CREATE OR REPLACE FUNCTION is_current_user_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_is_admin
  FROM users
  WHERE id = auth.uid();

  RETURN COALESCE(v_is_admin, FALSE);
END;
$$;

-- Comment the changes
COMMENT ON FUNCTION promote_user_to_admin IS 'Promotes a user to platform administrator role by email';
COMMENT ON FUNCTION revoke_admin_privileges IS 'Revokes platform administrator privileges from a user by email';
COMMENT ON FUNCTION is_current_user_admin IS 'Returns TRUE if the current authenticated user is a platform admin';
