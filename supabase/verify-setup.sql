-- ============================================================================
-- SUPABASE VERIFICATION SCRIPT
-- ============================================================================
-- Run this script in Supabase SQL Editor AFTER running schema.sql and functions.sql
-- to verify everything is set up correctly
-- ============================================================================

-- ============================================================================
-- 1. Verify All Tables Exist
-- ============================================================================
SELECT 
  'Tables Check' as check_type,
  CASE 
    WHEN COUNT(*) >= 10 THEN 'PASS ✓'
    ELSE 'FAIL ✗ - Missing tables'
  END as status,
  COUNT(*) as table_count,
  ARRAY_AGG(tablename ORDER BY tablename) as tables
FROM pg_tables 
WHERE schemaname = 'public'
  AND tablename IN (
    'users', 'email_verification_tokens', 'groups', 'group_members',
    'contributions', 'payouts', 'penalties', 'transactions',
    'notifications', 'audit_logs'
  );

-- ============================================================================
-- 2. Verify RLS is Enabled on All Tables
-- ============================================================================
SELECT 
  'RLS Check' as check_type,
  CASE 
    WHEN COUNT(*) = 0 THEN 'PASS ✓ - All tables have RLS enabled'
    ELSE 'FAIL ✗ - Some tables missing RLS'
  END as status,
  ARRAY_AGG(tablename) as tables_without_rls
FROM pg_tables t
WHERE schemaname = 'public'
  AND tablename IN (
    'users', 'email_verification_tokens', 'groups', 'group_members',
    'contributions', 'payouts', 'penalties', 'transactions',
    'notifications', 'audit_logs'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relname = t.tablename
      AND c.relrowsecurity = true
  );

-- ============================================================================
-- 3. Verify Critical RLS Policies Exist
-- ============================================================================
SELECT 
  'RLS Policies Check' as check_type,
  CASE 
    WHEN COUNT(*) >= 20 THEN 'PASS ✓'
    ELSE 'FAIL ✗ - Missing policies'
  END as status,
  COUNT(*) as policy_count,
  STRING_AGG(DISTINCT tablename, ', ' ORDER BY tablename) as tables_with_policies
FROM pg_policies
WHERE schemaname = 'public';

-- ============================================================================
-- 4. Verify group_members Policy is Fixed (No Recursion)
-- ============================================================================
SELECT 
  'group_members Policy Check' AS check_type,
  CASE 
    WHEN qual LIKE '%gm.id != group_members.id%' 
      OR qual LIKE '%gm.id <> group_members.id%'
      THEN 'PASS ✓ - Policy fixed'
    WHEN qual LIKE '%FROM group_members gm%'
      THEN 'WARNING ⚠ - Potential recursion'
    ELSE 'PASS ✓'
  END AS status,
  policyname,
  LEFT(qual, 200) AS policy_definition_preview
FROM pg_policies
WHERE tablename = 'group_members'
  AND policyname = 'group_members_select_own_groups';

-- ============================================================================
-- 5. Verify Critical Functions Exist
-- ============================================================================
SELECT 
  'Functions Check' as check_type,
  CASE 
    WHEN COUNT(*) >= 10 THEN 'PASS ✓'
    ELSE 'FAIL ✗ - Missing functions'
  END as status,
  COUNT(*) as function_count,
  ARRAY_AGG(routine_name ORDER BY routine_name) as functions
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION'
  AND routine_name IN (
    'create_user_profile_atomic',
    'create_user_profile',
    'update_updated_at_column',
    'calculate_next_payout_recipient',
    'is_cycle_complete',
    'calculate_payout_amount',
    'process_cycle_completion',
    'create_cycle_contributions',
    'get_user_stats',
    'get_group_progress'
  );

-- ============================================================================
-- 6. Verify create_user_profile_atomic Function Exists (Critical for Registration)
-- ============================================================================
SELECT 
  'Registration Function Check' AS check_type,
  CASE 
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name = 'create_user_profile_atomic'
    )
    THEN 'PASS ✓ - create_user_profile_atomic exists'
    ELSE 'FAIL ✗ - Missing create_user_profile_atomic (registration will fail!)'
  END AS status,
  'create_user_profile_atomic' AS routine_name,
  NULL AS return_type;


-- ============================================================================
-- 7. Verify Triggers are Set Up
-- ============================================================================
SELECT 
  'Triggers Check' as check_type,
  CASE 
    WHEN COUNT(*) >= 5 THEN 'PASS ✓'
    ELSE 'FAIL ✗ - Missing triggers'
  END as status,
  COUNT(*) as trigger_count,
  STRING_AGG(DISTINCT event_object_table, ', ' ORDER BY event_object_table) as tables_with_triggers
FROM information_schema.triggers
WHERE trigger_schema = 'public';

-- ============================================================================
-- 8. Verify Indexes Exist for Performance
-- ============================================================================
SELECT 
  'Indexes Check' as check_type,
  CASE 
    WHEN COUNT(*) >= 30 THEN 'PASS ✓'
    ELSE 'WARNING ⚠ - May need more indexes'
  END as status,
  COUNT(*) as index_count,
  STRING_AGG(DISTINCT tablename, ', ' ORDER BY tablename) as indexed_tables
FROM pg_indexes
WHERE schemaname = 'public';

-- ============================================================================
-- 9. Check for Common Issues
-- ============================================================================
SELECT 
  'Common Issues Check' as check_type,
  CASE 
    WHEN COUNT(*) = 0 THEN 'PASS ✓ - No common issues detected'
    ELSE 'WARNING ⚠ - Review issues below'
  END as status,
  ARRAY_AGG(issue) as issues
FROM (
  -- Check for policies without service_role exceptions
  SELECT 'Some tables missing service_role policies' as issue
  FROM pg_tables t
  WHERE schemaname = 'public'
    AND tablename IN ('users', 'groups', 'group_members', 'contributions')
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.tablename = t.tablename
        AND p.policyname LIKE '%service_role%'
    )
  LIMIT 1
) issues;

-- ============================================================================
-- 10. Overall Setup Status
-- ============================================================================
SELECT 
  '=== OVERALL SETUP STATUS ===' AS summary,
  CASE 
    WHEN 
      -- Check required tables
      (SELECT COUNT(*) 
       FROM pg_tables 
       WHERE schemaname = 'public' 
         AND tablename IN ('users', 'groups', 'group_members')) >= 3
      AND
      -- Check registration function
      (SELECT COUNT(*) 
       FROM information_schema.routines 
       WHERE routine_schema = 'public' 
         AND routine_name = 'create_user_profile_atomic') > 0
      AND
      -- Check RLS policy with recursion fix
      (SELECT COUNT(*) 
       FROM pg_policies 
       WHERE tablename = 'group_members' 
         AND policyname = 'group_members_select_own_groups'
         AND (qual LIKE '%gm.id != group_members.id%' 
              OR qual LIKE '%gm.id <> group_members.id%')) > 0
    THEN 'READY ✓ - Database is properly configured!'
    ELSE 'NOT READY ✗ - Please review failed checks above'
  END AS status;

-- ============================================================================
-- END OF VERIFICATION SCRIPT
-- ============================================================================
-- 
-- INTERPRETATION:
-- - PASS ✓: Everything is working correctly
-- - FAIL ✗: Critical issue that must be fixed
-- - WARNING ⚠: Non-critical issue or potential optimization
--
-- IF YOU SEE FAILURES:
-- 1. Make sure you ran schema.sql FIRST
-- 2. Then run functions.sql SECOND
-- 3. Check the Supabase logs for any errors during execution
-- 4. See SUPABASE_SETUP.md for detailed troubleshooting
-- ============================================================================
