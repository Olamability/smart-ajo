-- ============================================================================
-- Migration: Fix Creator Slot Selection and Member Counts
-- ============================================================================
-- 1. Disables "Auto-Add Creator" so creators can manually join and pick ANY slot.
-- 2. Fixes "Double Counting" by cleaning up duplicate triggers.
-- 3. Recalculates correct member counts for all groups.
-- ============================================================================

-- ============================================================================
-- STEP 1: Disable Auto-Add Creator
-- ============================================================================

-- Drop all versions of the auto-add trigger
DROP TRIGGER IF EXISTS trigger_auto_add_creator ON groups;
DROP TRIGGER IF EXISTS trigger_02_auto_add_creator ON groups;

-- Drop the function itself to prevent accidental re-attachment
DROP FUNCTION IF EXISTS auto_add_creator_as_member();

-- ============================================================================
-- STEP 2: Fix Double Counting (Trigger Cleanup)
-- ============================================================================

-- Ensure we only have ONE trigger for updating counts
DROP TRIGGER IF EXISTS trigger_update_group_member_count ON group_members;

CREATE TRIGGER trigger_update_group_member_count
AFTER INSERT OR DELETE ON group_members
FOR EACH ROW
EXECUTE FUNCTION update_group_member_count();

-- ============================================================================
-- STEP 3: Recalculate Member Counts (Data Repair)
-- ============================================================================

DO $$
BEGIN
  -- Update every group's member count based on the actual number of rows in group_members
  UPDATE groups g
  SET 
    current_members = (
      SELECT COUNT(*) 
      FROM group_members gm 
      WHERE gm.group_id = g.id
    ),
    updated_at = NOW();

  RAISE NOTICE 'Member counts recalculated successfully.';
END $$;
