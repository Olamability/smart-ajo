-- ============================================================================
-- Migration: Fix Group Member Count
-- ============================================================================
-- This migration adds a trigger to automatically update the current_members
-- count in the groups table when members join or leave.
--
-- Issue: When a group is created, current_members defaults to 1, but when
-- the creator is added as a member, it doesn't increment, causing it to show
-- 1/10 correctly. However, when another member joins, if we don't have this
-- trigger, it would still show 1/10 instead of 2/10.
--
-- Solution: 
-- 1. Add trigger to auto-update current_members on group_members INSERT/DELETE
-- 2. Update validate_group_capacity to count actual members, not rely on cached count
-- 3. Fix existing groups' current_members to match actual member count
-- ============================================================================

-- ============================================================================
-- STEP 1: Create function to update group member count
-- ============================================================================

CREATE OR REPLACE FUNCTION update_group_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Increment current_members when a new member joins
    UPDATE groups
    SET current_members = current_members + 1,
        updated_at = NOW()
    WHERE id = NEW.group_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    -- Decrement current_members when a member leaves
    UPDATE groups
    SET current_members = GREATEST(0, current_members - 1),
        updated_at = NOW()
    WHERE id = OLD.group_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 2: Create trigger on group_members table
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_update_group_member_count ON group_members;

CREATE TRIGGER trigger_update_group_member_count
AFTER INSERT OR DELETE ON group_members
FOR EACH ROW
EXECUTE FUNCTION update_group_member_count();

COMMENT ON TRIGGER trigger_update_group_member_count ON group_members IS 
  'Automatically updates the current_members count in groups table when members join or leave';

-- ============================================================================
-- STEP 3: Update validate_group_capacity to use actual count
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_group_capacity()
RETURNS TRIGGER AS $$
DECLARE
  v_total_members INTEGER;
  v_current_members INTEGER;
BEGIN
  -- Get group member counts (using actual count from group_members table)
  SELECT g.total_members, COALESCE(COUNT(gm.id), 0)
  INTO v_total_members, v_current_members
  FROM groups g
  LEFT JOIN group_members gm ON gm.group_id = g.id
  WHERE g.id = NEW.group_id
  GROUP BY g.id, g.total_members;
  
  -- If no result, fetch just total_members
  IF v_total_members IS NULL THEN
    SELECT total_members INTO v_total_members FROM groups WHERE id = NEW.group_id;
    v_current_members := 0;
  END IF;
  
  -- Check if group is full
  IF v_current_members >= v_total_members THEN
    RAISE EXCEPTION 'Group is full (% / % members)', v_current_members, v_total_members;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 4: Fix existing groups' current_members to match actual count
-- ============================================================================

UPDATE groups g
SET current_members = COALESCE((
  SELECT COUNT(*)
  FROM group_members gm
  WHERE gm.group_id = g.id
), 0),
updated_at = NOW()
WHERE id IN (
  SELECT id FROM groups
);

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================
-- Run this to verify the fix worked:
--
-- SELECT 
--   g.id,
--   g.name,
--   g.current_members as cached_count,
--   COUNT(gm.id) as actual_count,
--   g.total_members,
--   CASE 
--     WHEN g.current_members = COUNT(gm.id) THEN '✓ Match'
--     ELSE '✗ Mismatch'
--   END as status
-- FROM groups g
-- LEFT JOIN group_members gm ON gm.group_id = g.id
-- GROUP BY g.id, g.name, g.current_members, g.total_members
-- ORDER BY g.created_at DESC;
-- ============================================================================
