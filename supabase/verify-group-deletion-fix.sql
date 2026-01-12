-- ============================================================================
-- VERIFICATION SCRIPT: Group Deletion Policy Fix
-- ============================================================================
-- This script verifies that the groups_delete_creator_empty policy was
-- successfully applied and is working as expected.
--
-- Run this script in the Supabase SQL Editor after deploying the migration.
-- ============================================================================

-- Step 1: Verify the policy exists
DO $$
DECLARE
  policy_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_policy 
    WHERE polrelid = 'groups'::regclass
    AND polname = 'groups_delete_creator_empty'
  ) INTO policy_exists;
  
  IF policy_exists THEN
    RAISE NOTICE '✓ Policy "groups_delete_creator_empty" exists';
  ELSE
    RAISE EXCEPTION '✗ Policy "groups_delete_creator_empty" NOT found';
  END IF;
END $$;

-- Step 2: Show the policy definition
SELECT 
  polname as policy_name,
  polcmd as command,
  CASE polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END as command_type,
  pg_get_expr(polqual, polrelid) as using_expression,
  pg_get_expr(polwithcheck, polrelid) as with_check_expression
FROM pg_policy 
WHERE polrelid = 'groups'::regclass
  AND polname = 'groups_delete_creator_empty';

-- Step 3: List all RLS policies on groups table
SELECT 
  polname as policy_name,
  CASE polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END as operation,
  pg_get_expr(polqual, polrelid) as using_expression
FROM pg_policy 
WHERE polrelid = 'groups'::regclass
ORDER BY 
  CASE polcmd
    WHEN 'r' THEN 1
    WHEN 'a' THEN 2
    WHEN 'w' THEN 3
    WHEN 'd' THEN 4
    WHEN '*' THEN 5
  END;

-- Step 4: Check for orphaned groups (created but no members, older than 1 hour)
-- These might have been created before the fix was deployed
SELECT 
  g.id, 
  g.name, 
  g.created_by, 
  g.current_members,
  g.status,
  g.created_at,
  COALESCE(COUNT(gm.id), 0) as actual_member_count,
  AGE(NOW(), g.created_at) as age
FROM groups g
LEFT JOIN group_members gm ON g.id = gm.group_id
WHERE g.current_members = 0 
  AND g.status = 'forming'
  AND g.created_at < NOW() - INTERVAL '1 hour'
GROUP BY g.id, g.name, g.created_by, g.current_members, g.status, g.created_at
HAVING COALESCE(COUNT(gm.id), 0) = 0
ORDER BY g.created_at DESC
LIMIT 20;

-- Step 5: Count groups by status and member count
SELECT 
  status,
  current_members,
  COUNT(*) as group_count
FROM groups
GROUP BY status, current_members
ORDER BY status, current_members;

-- Step 6: Check for failed payments with associated groups
SELECT 
  g.id as group_id,
  g.name as group_name,
  g.current_members,
  g.status as group_status,
  g.created_at as group_created,
  p.reference as payment_reference,
  p.status as payment_status,
  p.verified as payment_verified,
  p.created_at as payment_created
FROM groups g
LEFT JOIN payments p ON 
  p.metadata->>'group_id' = g.id::text 
  AND p.metadata->>'type' = 'group_creation'
WHERE g.current_members = 0 
  AND g.status = 'forming'
  AND g.created_at > NOW() - INTERVAL '7 days'
ORDER BY g.created_at DESC
LIMIT 20;

-- Step 7: Summary Report
DO $$
DECLARE
  total_groups INTEGER;
  empty_groups INTEGER;
  orphaned_groups INTEGER;
  policy_exists BOOLEAN;
BEGIN
  -- Count total groups
  SELECT COUNT(*) INTO total_groups FROM groups;
  
  -- Count empty groups (current_members = 0)
  SELECT COUNT(*) INTO empty_groups FROM groups WHERE current_members = 0;
  
  -- Count orphaned groups (empty and older than 1 hour)
  SELECT COUNT(*) INTO orphaned_groups 
  FROM groups g
  LEFT JOIN group_members gm ON g.id = gm.group_id
  WHERE g.current_members = 0 
    AND g.status = 'forming'
    AND g.created_at < NOW() - INTERVAL '1 hour'
  GROUP BY g.id
  HAVING COUNT(gm.id) = 0;
  
  -- Check policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policy 
    WHERE polrelid = 'groups'::regclass
    AND polname = 'groups_delete_creator_empty'
  ) INTO policy_exists;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'GROUP DELETION POLICY VERIFICATION';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Policy Exists: %', CASE WHEN policy_exists THEN '✓ YES' ELSE '✗ NO' END;
  RAISE NOTICE 'Total Groups: %', total_groups;
  RAISE NOTICE 'Empty Groups (current_members=0): %', empty_groups;
  RAISE NOTICE 'Orphaned Groups (>1 hour old, empty): %', COALESCE(orphaned_groups, 0);
  RAISE NOTICE '';
  
  IF NOT policy_exists THEN
    RAISE NOTICE '⚠️  WARNING: Policy not found. Run the migration first.';
  ELSIF orphaned_groups > 0 THEN
    RAISE NOTICE '⚠️  WARNING: Found % orphaned groups. These may have been created before the fix.', orphaned_groups;
    RAISE NOTICE '    Consider cleaning them up manually or investigating why they exist.';
  ELSE
    RAISE NOTICE '✓ SUCCESS: No orphaned groups found. Policy is working correctly!';
  END IF;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- CLEANUP SCRIPT (Optional - Use with caution)
-- ============================================================================
-- If you find orphaned groups and want to clean them up manually,
-- uncomment and run this section. ONLY run this if you're sure these
-- groups are truly orphaned and not legitimate groups waiting for members.
-- ============================================================================

-- UNCOMMENT TO ENABLE CLEANUP:
/*
-- Preview groups that would be deleted
SELECT 
  g.id, 
  g.name, 
  g.created_by,
  u.full_name as creator_name,
  u.email as creator_email,
  g.created_at,
  AGE(NOW(), g.created_at) as age
FROM groups g
LEFT JOIN users u ON g.created_by = u.id
LEFT JOIN group_members gm ON g.id = gm.group_id
WHERE g.current_members = 0 
  AND g.status = 'forming'
  AND g.created_at < NOW() - INTERVAL '1 hour'
GROUP BY g.id, g.name, g.created_by, u.full_name, u.email, g.created_at
HAVING COUNT(gm.id) = 0
ORDER BY g.created_at;

-- If you're absolutely sure, run this to delete orphaned groups:
-- WARNING: This cannot be undone!
/*
DELETE FROM groups
WHERE id IN (
  SELECT g.id
  FROM groups g
  LEFT JOIN group_members gm ON g.id = gm.group_id
  WHERE g.current_members = 0 
    AND g.status = 'forming'
    AND g.created_at < NOW() - INTERVAL '1 hour'
  GROUP BY g.id
  HAVING COUNT(gm.id) = 0
);
*/
*/
