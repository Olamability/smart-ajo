-- ============================================================================
-- Migration: Fix Slots Trigger Order and Backfill Data
-- ============================================================================
-- 1. Fixes Trigger Race Condition: Ensures slots are created BEFORE adding creator.
-- 2. Backfills Missing Slots: Creates slots for existing groups that have none.
-- 3. Syncs Slot Status: Updates slots to match existing members and requests.
-- ============================================================================

-- ============================================================================
-- STEP 1: Fix Trigger Order
-- ============================================================================
-- We rename the triggers to control execution order alphabetically.
-- "trigger_01_..." runs before "trigger_02_..."

-- Drop existing triggers
DROP TRIGGER IF EXISTS trigger_auto_initialize_slots ON groups;
DROP TRIGGER IF EXISTS trigger_auto_add_creator ON groups;

-- Recreate "Initialize Slots" trigger with '01' prefix (RUNS FIRST)
CREATE TRIGGER trigger_01_auto_initialize_slots
AFTER INSERT ON groups
FOR EACH ROW
EXECUTE FUNCTION auto_initialize_slots();

-- Recreate "Add Creator" trigger with '02' prefix (RUNS SECOND)
CREATE TRIGGER trigger_02_auto_add_creator
AFTER INSERT ON groups
FOR EACH ROW
EXECUTE FUNCTION auto_add_creator_as_member();

-- ============================================================================
-- STEP 2: Data Backfill & Synchronization
-- ============================================================================

DO $$
DECLARE
  group_rec RECORD;
  slots_created INTEGER := 0;
BEGIN
  -- A. Initialize slots for any group that doesn't have them
  FOR group_rec IN SELECT * FROM groups LOOP
    -- The initialize_group_slots function handles the check internally,
    -- but we can wrap it to be safe and track progress
    PERFORM initialize_group_slots(group_rec.id, group_rec.total_members);
  END LOOP;

  -- B. Sync "Assigned" Slots (from Group Members)
  -- If a member exists at position X, slot X must be 'assigned' to them
  UPDATE group_payout_slots gps
  SET 
    status = 'assigned',
    assigned_to = gm.user_id,
    assigned_at = gm.created_at, -- Use member creation time
    updated_at = NOW()
  FROM group_members gm
  WHERE gps.group_id = gm.group_id 
    AND gps.slot_number = gm.position
    AND (gps.status != 'assigned' OR gps.assigned_to IS DISTINCT FROM gm.user_id);

  -- C. Sync "Reserved" Slots (from Pending Join Requests)
  -- If a pending request exists for slot Y, slot Y should be 'reserved' (if available)
  UPDATE group_payout_slots gps
  SET 
    status = 'reserved',
    reserved_by = gjr.user_id,
    reserved_at = gjr.created_at,
    updated_at = NOW()
  FROM group_join_requests gjr
  WHERE gps.group_id = gjr.group_id 
    AND gps.slot_number = gjr.preferred_slot
    AND gjr.status = 'pending'
    AND gps.status = 'available'; -- Only reserve if currently available

  RAISE NOTICE 'Migration, backfill, and sync completed successfully.';
END $$;
