-- Migration: Fix RLS Infinite Recursion in group_members SELECT Policy
-- Date: 2026-02-05
-- Description: Removes recursive self-reference from "Users can view group members" policy
--              that was causing "infinite recursion detected in policy for relation 'group_members'" errors.
--
-- Background:
-- The "Users can view group members" SELECT policy on group_members table contained a
-- subquery that checked if a user is a member of a group by querying the same group_members
-- table. This creates a circular dependency:
-- 1. User queries group_members table
-- 2. RLS policy checks if user is in the group by querying group_members
-- 3. That query triggers the RLS policy again (infinite loop)
-- 4. PostgreSQL detects recursion and throws error 42P17
--
-- Solution:
-- Simplify the policy to only check:
-- 1. Direct ownership (user's own membership record)
-- 2. Group creator status (querying groups table, not group_members)
--
-- The recursive check that allowed users to see other members of groups they belong to
-- is removed. Instead, users can still access group member information through:
-- - JOIN queries from groups table to group_members
-- - Public group information views
-- - API functions that use service role
--
-- This maintains security while preventing infinite recursion.

-- ============================================================================
-- FIX GROUP_MEMBERS TABLE SELECT POLICY
-- ============================================================================

-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can view group members" ON group_members;

-- Recreate without recursive self-reference
CREATE POLICY "Users can view group members"
  ON group_members FOR SELECT
  USING (
    -- Users can view their own membership record
    auth.uid() = user_id 
    OR
    -- Group creators can view all members of their groups
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id 
        AND g.created_by = auth.uid()
    )
  );

-- ============================================================================
-- VERIFICATION
-- ============================================================================
--
-- After running this migration:
-- 1. Have all users log out and log back in
-- 2. Test these queries should work without recursion errors:
--    - SELECT * FROM group_members WHERE user_id = auth.uid();
--    - Groups page should load member information via JOIN queries
--    - Dashboard should display user's groups and memberships
-- 3. Verify no "infinite recursion" errors in browser console
--
-- Note: If users need to see other members of groups they belong to,
-- the frontend should use JOIN queries like:
--   SELECT g.*, gm.* 
--   FROM groups g
--   JOIN group_members gm ON g.id = gm.group_id
--   WHERE g.id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
--
-- This avoids direct recursive queries on group_members table.
-- ============================================================================
