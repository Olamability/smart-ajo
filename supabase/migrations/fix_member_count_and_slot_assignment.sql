-- ============================================================================
-- MIGRATION: Fix Member Count Display and Allow Creator Slot Selection
-- ============================================================================
-- This migration addresses three critical issues:
-- 1. Dashboard showing 2 members instead of 1 when group is created
-- 2. Creator being auto-assigned to slot 1 (should allow selection)
-- 3. Payment not reflecting on platform
--
-- Changes:
-- 1. Change schema default for current_members from 1 to 0
-- 2. Disable auto-add creator trigger (creator added after payment with selected slot)
-- 3. Ensure verify-payment Edge Function properly handles creator membership
-- ============================================================================

-- STEP 1: Change schema default for current_members from 1 to 0
-- This ensures consistency with the code that explicitly sets current_members to 0
ALTER TABLE groups 
ALTER COLUMN current_members SET DEFAULT 0;

-- STEP 2: Drop the auto-add creator trigger
-- Creator will be added to the group after payment with their selected slot
DROP TRIGGER IF EXISTS trigger_auto_add_creator ON groups;

-- STEP 3: Keep the auto_add_creator_as_member function for potential future use
-- but it won't be triggered automatically
-- The function is retained in case manual membership addition is needed
COMMENT ON FUNCTION auto_add_creator_as_member IS 
  'DISABLED: Creator is now added to group after payment with selected slot. Function retained for manual use only.';

-- STEP 4: Fix any existing groups that have incorrect member counts
-- This handles groups created before this migration
UPDATE groups g
SET current_members = COALESCE((
  SELECT COUNT(*)
  FROM group_members gm
  WHERE gm.group_id = g.id
), 0)
WHERE g.current_members != COALESCE((
  SELECT COUNT(*)
  FROM group_members gm
  WHERE gm.group_id = g.id
), 0);

-- STEP 5: Add a note about the change
COMMENT ON COLUMN groups.current_members IS 
  'Count of active members in the group. Automatically updated by trigger when members join/leave. Default 0 (creator added after payment).';

-- ============================================================================
-- VERIFICATION QUERIES (Run these to verify the migration)
-- ============================================================================

-- Check groups with mismatched member counts
-- SELECT 
--   g.id,
--   g.name,
--   g.current_members as stored_count,
--   COUNT(gm.id) as actual_count,
--   (g.current_members - COUNT(gm.id)) as difference
-- FROM groups g
-- LEFT JOIN group_members gm ON gm.group_id = g.id
-- GROUP BY g.id, g.name, g.current_members
-- HAVING g.current_members != COUNT(gm.id)
-- ORDER BY g.created_at DESC;

-- Check groups created recently (last 24 hours)
-- SELECT 
--   g.id,
--   g.name,
--   g.created_by,
--   g.current_members,
--   g.status,
--   COUNT(gm.id) as actual_members,
--   g.created_at
-- FROM groups g
-- LEFT JOIN group_members gm ON gm.group_id = g.id
-- WHERE g.created_at > NOW() - INTERVAL '24 hours'
-- GROUP BY g.id
-- ORDER BY g.created_at DESC;

