-- Migration: Fix RLS Infinite Recursion in Admin Policies
-- Date: 2026-02-05
-- Description: Removes recursive fallback clauses from RLS policies that were causing
--              "infinite recursion detected in policy for relation 'users'" errors.
--              Admin privileges are now determined solely from JWT claims.
--
-- Background:
-- Multiple RLS policies contained fallback clauses that queried the users table
-- while already executing within a users table policy context, creating circular
-- dependencies. This prevented users from logging in successfully.
--
-- Solution:
-- Remove all fallback clauses that query the users table. Admin checks now rely
-- exclusively on auth.jwt()->>'is_admin' which doesn't require database queries.
--
-- Affected Tables:
-- - users (2 policies)
-- - groups (1 policy)
-- - group_members (1 policy)
-- - transactions (1 policy)
-- - audit_logs (1 policy)

-- ============================================================================
-- 1. USERS TABLE POLICIES
-- ============================================================================

-- Drop and recreate: "Admins can view all users"
DROP POLICY IF EXISTS "Admins can view all users" ON users;

CREATE POLICY "Admins can view all users"
  ON users FOR SELECT
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- Drop and recreate: "Admins can update any user"
DROP POLICY IF EXISTS "Admins can update any user" ON users;

CREATE POLICY "Admins can update any user"
  ON users FOR UPDATE
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- ============================================================================
-- 2. GROUPS TABLE POLICIES
-- ============================================================================

-- Drop and recreate: "Admins can update any group"
DROP POLICY IF EXISTS "Admins can update any group" ON groups;

CREATE POLICY "Admins can update any group"
  ON groups FOR UPDATE
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- ============================================================================
-- 3. GROUP_MEMBERS TABLE POLICIES
-- ============================================================================

-- Drop and recreate: "Creators and admins can update members"
DROP POLICY IF EXISTS "Creators and admins can update members" ON group_members;

CREATE POLICY "Creators and admins can update members"
  ON group_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id 
        AND g.created_by = auth.uid()
    ) OR
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- ============================================================================
-- 4. TRANSACTIONS TABLE POLICIES
-- ============================================================================

-- Drop and recreate: "Admins can view all transactions"
DROP POLICY IF EXISTS "Admins can view all transactions" ON transactions;

CREATE POLICY "Admins can view all transactions"
  ON transactions FOR SELECT
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- ============================================================================
-- 5. AUDIT_LOGS TABLE POLICIES
-- ============================================================================

-- Drop and recreate: "Admins can view audit logs"
DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;

CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- ============================================================================
-- IMPORTANT POST-MIGRATION STEPS
-- ============================================================================
--
-- After running this migration, admin users need the 'is_admin' claim in their JWT.
-- To configure admin users, run:
--
--   UPDATE auth.users 
--   SET raw_app_meta_data = raw_app_meta_data || '{"is_admin": true}'::jsonb
--   WHERE email = 'admin@example.com';
--
-- Note: Admins must log out and back in after this change for JWT to be updated.
--
-- Verification:
-- 1. Have all users log out
-- 2. Log back in
-- 3. Confirm no "infinite recursion" errors
-- 4. Verify user profiles load successfully
--
-- ============================================================================
