-- ============================================================================
-- SYSTEM ADMIN VERIFICATION SCRIPT
-- ============================================================================
-- This script verifies that the System Admin feature is correctly installed
-- Run this in Supabase SQL Editor after applying the migration
-- ============================================================================

-- ============================================================================
-- STEP 1: Verify Functions Exist
-- ============================================================================

SELECT 
  'CHECKING FUNCTIONS' as test_category,
  routine_name,
  routine_type,
  CASE 
    WHEN routine_name IS NOT NULL THEN '✓ EXISTS'
    ELSE '✗ MISSING'
  END as status
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN (
  'log_admin_action',
  'get_all_users_admin',
  'get_all_groups_admin',
  'suspend_user_admin',
  'deactivate_group_admin',
  'get_admin_analytics',
  'get_audit_logs_admin',
  'get_user_details_admin',
  'prevent_admin_group_membership',
  'prevent_admin_payouts'
)
ORDER BY routine_name;

-- ============================================================================
-- STEP 2: Verify Triggers Exist
-- ============================================================================

SELECT 
  'CHECKING TRIGGERS' as test_category,
  trigger_name,
  event_object_table as table_name,
  CASE 
    WHEN trigger_name IS NOT NULL THEN '✓ EXISTS'
    ELSE '✗ MISSING'
  END as status
FROM information_schema.triggers
WHERE trigger_schema = 'public'
AND trigger_name IN ('prevent_admin_membership', 'prevent_admin_payout')
ORDER BY trigger_name;

-- ============================================================================
-- STEP 3: Verify is_admin Column Exists
-- ============================================================================

SELECT 
  'CHECKING COLUMNS' as test_category,
  column_name,
  data_type,
  column_default,
  CASE 
    WHEN column_name IS NOT NULL THEN '✓ EXISTS'
    ELSE '✗ MISSING'
  END as status
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'users'
AND column_name = 'is_admin';

-- ============================================================================
-- STEP 4: Check Existing Admin Users
-- ============================================================================

SELECT 
  'CHECKING ADMIN USERS' as test_category,
  COUNT(*) as admin_count,
  CASE 
    WHEN COUNT(*) > 0 THEN '✓ ADMINS EXIST'
    ELSE '⚠ NO ADMINS - Create one!'
  END as status
FROM users
WHERE is_admin = TRUE;

-- Show admin users
SELECT 
  'ADMIN USER LIST' as info,
  email,
  full_name,
  is_admin,
  created_at
FROM users
WHERE is_admin = TRUE
ORDER BY created_at;

-- ============================================================================
-- STEP 5: Test Function Permissions
-- ============================================================================

-- Check if authenticated users can execute admin functions
SELECT 
  'CHECKING PERMISSIONS' as test_category,
  routine_name,
  grantee,
  privilege_type,
  CASE 
    WHEN privilege_type = 'EXECUTE' AND grantee = 'authenticated' THEN '✓ GRANTED'
    ELSE '⚠ CHECK PERMISSIONS'
  END as status
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
AND routine_name IN (
  'get_all_users_admin',
  'get_all_groups_admin',
  'suspend_user_admin',
  'deactivate_group_admin',
  'get_admin_analytics',
  'get_audit_logs_admin',
  'get_user_details_admin'
)
AND grantee = 'authenticated'
ORDER BY routine_name;

-- ============================================================================
-- STEP 6: Test is_current_user_admin Function
-- ============================================================================

SELECT 
  'TESTING ADMIN CHECK' as test_category,
  is_current_user_admin() as current_user_is_admin,
  CASE 
    WHEN is_current_user_admin() = TRUE THEN '✓ CURRENT USER IS ADMIN'
    ELSE '✗ CURRENT USER IS NOT ADMIN'
  END as status;

-- ============================================================================
-- STEP 7: Verify Audit Logs Table
-- ============================================================================

SELECT 
  'CHECKING AUDIT LOGS' as test_category,
  table_name,
  CASE 
    WHEN table_name IS NOT NULL THEN '✓ TABLE EXISTS'
    ELSE '✗ TABLE MISSING'
  END as status
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name = 'audit_logs';

-- Check audit logs table structure
SELECT 
  'AUDIT LOGS COLUMNS' as info,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'audit_logs'
ORDER BY ordinal_position;

-- ============================================================================
-- STEP 8: Summary Report
-- ============================================================================

SELECT 
  '====== INSTALLATION SUMMARY ======' as report,
  '' as detail
UNION ALL
SELECT 
  'Functions Installed:' as report,
  COUNT(*)::text as detail
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE '%admin%'
UNION ALL
SELECT 
  'Triggers Installed:' as report,
  COUNT(*)::text as detail
FROM information_schema.triggers
WHERE trigger_schema = 'public'
AND trigger_name IN ('prevent_admin_membership', 'prevent_admin_payout')
UNION ALL
SELECT 
  'Admin Users:' as report,
  COUNT(*)::text as detail
FROM users
WHERE is_admin = TRUE
UNION ALL
SELECT 
  'Audit Log Entries:' as report,
  COUNT(*)::text as detail
FROM audit_logs
UNION ALL
SELECT 
  '=====================================' as report,
  '' as detail;

-- ============================================================================
-- OPTIONAL: Test Admin Functions (Only run if you are an admin)
-- ============================================================================

-- Uncomment the following to test admin functions
-- Make sure you're logged in as an admin user first!

/*
-- Test get_admin_analytics
SELECT 'Testing get_admin_analytics()' as test;
SELECT * FROM get_admin_analytics();

-- Test get_all_users_admin (first 5 users)
SELECT 'Testing get_all_users_admin()' as test;
SELECT * FROM get_all_users_admin(5, 0, NULL, NULL);

-- Test get_all_groups_admin (first 5 groups)
SELECT 'Testing get_all_groups_admin()' as test;
SELECT * FROM get_all_groups_admin(5, 0, NULL, NULL);

-- Test get_audit_logs_admin (last 10 logs)
SELECT 'Testing get_audit_logs_admin()' as test;
SELECT * FROM get_audit_logs_admin(10, 0, NULL, NULL, NULL);
*/

-- ============================================================================
-- INSTALLATION COMPLETE
-- ============================================================================

SELECT 
  '🎉 VERIFICATION COMPLETE!' as status,
  'Review the results above to ensure everything is installed correctly.' as message
UNION ALL
SELECT 
  'Next Steps:' as status,
  '1. Promote a user to admin using: UPDATE users SET is_admin = TRUE WHERE email = ''your-email@example.com'';' as message
UNION ALL
SELECT 
  '' as status,
  '2. Log out and log back in with the admin account' as message
UNION ALL
SELECT 
  '' as status,
  '3. Navigate to /admin to access the System Admin Dashboard' as message
UNION ALL
SELECT 
  '' as status,
  '4. Test all tabs: Overview, Users, Groups, Audit Logs' as message;
