-- ============================================================================
-- Test Script: Verify Member Counting Fix
-- ============================================================================
-- This script tests that member counting works correctly after the fix
-- Run this in a test environment to verify the double counting bug is resolved
-- ============================================================================

-- Setup: Create test data
DO $$
DECLARE
  v_test_user_id UUID;
  v_test_group_id UUID;
  v_initial_count INTEGER;
  v_after_add_count INTEGER;
  v_actual_member_count INTEGER;
BEGIN
  RAISE NOTICE '=== Starting Member Counting Test ===';
  
  -- Create a test user if doesn't exist
  INSERT INTO users (id, email, phone, full_name)
  VALUES (
    gen_random_uuid(),
    'test_' || gen_random_uuid() || '@test.com',
    '+234' || floor(random() * 9000000000 + 1000000000)::text,
    'Test User'
  )
  RETURNING id INTO v_test_user_id;
  
  RAISE NOTICE 'Created test user: %', v_test_user_id;
  
  -- Create a test group WITHOUT the trigger (manual insert)
  -- This simulates the API behavior
  INSERT INTO groups (
    id,
    name,
    description,
    created_by,
    contribution_amount,
    frequency,
    total_members,
    current_members,
    security_deposit_amount,
    security_deposit_percentage,
    status,
    start_date,
    current_cycle,
    total_cycles
  ) VALUES (
    gen_random_uuid(),
    'Test Group ' || gen_random_uuid()::text,
    'Test group for member counting',
    v_test_user_id,
    5000,
    'monthly',
    10,
    0, -- Start at 0, as API does
    1000,
    20,
    'forming',
    NOW() + INTERVAL '7 days',
    1,
    10
  )
  RETURNING id, current_members INTO v_test_group_id, v_initial_count;
  
  RAISE NOTICE 'Created test group: % with initial count: %', v_test_group_id, v_initial_count;
  
  -- Verify initial count is 0
  IF v_initial_count != 0 THEN
    RAISE WARNING 'Initial count should be 0, got %', v_initial_count;
  END IF;
  
  -- Add creator as member using the fixed function
  PERFORM add_member_to_group(
    v_test_group_id,
    v_test_user_id,
    TRUE, -- is_creator
    1     -- preferred_slot
  );
  
  -- Get the count after adding member
  SELECT current_members INTO v_after_add_count
  FROM groups
  WHERE id = v_test_group_id;
  
  -- Get actual member count from group_members table
  SELECT COUNT(*) INTO v_actual_member_count
  FROM group_members
  WHERE group_id = v_test_group_id;
  
  RAISE NOTICE 'After adding creator:';
  RAISE NOTICE '  stored current_members: %', v_after_add_count;
  RAISE NOTICE '  actual group_members rows: %', v_actual_member_count;
  
  -- Verify counts match and equal 1
  IF v_after_add_count = 1 AND v_actual_member_count = 1 THEN
    RAISE NOTICE '✓ TEST PASSED: Member count is correct (1)';
  ELSIF v_after_add_count = 2 THEN
    RAISE WARNING '✗ TEST FAILED: Double counting detected! Count is 2 instead of 1';
  ELSIF v_after_add_count != v_actual_member_count THEN
    RAISE WARNING '✗ TEST FAILED: Stored count (%) does not match actual count (%)', 
      v_after_add_count, v_actual_member_count;
  ELSE
    RAISE WARNING '✗ TEST FAILED: Unexpected count %', v_after_add_count;
  END IF;
  
  -- Cleanup test data
  DELETE FROM groups WHERE id = v_test_group_id;
  DELETE FROM users WHERE id = v_test_user_id;
  
  RAISE NOTICE '=== Test Complete - Cleanup Done ===';
END $$;

-- ============================================================================
-- Additional Test: Verify Trigger Exists
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_update_group_member_count'
  ) THEN
    RAISE WARNING '⚠ trigger_update_group_member_count is MISSING!';
  ELSE
    RAISE NOTICE '✓ trigger_update_group_member_count exists';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_auto_add_creator'
  ) THEN
    RAISE WARNING '⚠ trigger_auto_add_creator is MISSING!';
  ELSE
    RAISE NOTICE '✓ trigger_auto_add_creator exists';
  END IF;
END $$;

-- ============================================================================
-- Audit Existing Groups (Optional - run in production to check for issues)
-- ============================================================================

-- Uncomment to check existing groups for counting discrepancies:
/*
SELECT 
  g.id,
  g.name,
  g.current_members AS stored_count,
  COUNT(gm.id) AS actual_count,
  CASE 
    WHEN g.current_members = COUNT(gm.id) THEN '✓ OK'
    WHEN g.current_members = COUNT(gm.id) * 2 THEN '✗ DOUBLE COUNTED'
    ELSE '⚠ MISMATCH'
  END AS status
FROM groups g
LEFT JOIN group_members gm ON gm.group_id = g.id
GROUP BY g.id, g.name, g.current_members
ORDER BY 
  CASE 
    WHEN g.current_members = COUNT(gm.id) THEN 1
    WHEN g.current_members = COUNT(gm.id) * 2 THEN 2
    ELSE 3
  END,
  g.created_at DESC;
*/

-- ============================================================================
-- Fix Existing Incorrect Counts (Optional - run in production if issues found)
-- ============================================================================

-- Uncomment to fix existing groups with incorrect counts:
/*
UPDATE groups g
SET current_members = (
  SELECT COUNT(*) FROM group_members WHERE group_id = g.id
),
updated_at = NOW()
WHERE g.current_members != (
  SELECT COUNT(*) FROM group_members WHERE group_id = g.id
);
*/
