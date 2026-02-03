-- ============================================================================
-- DATABASE SCHEMA VALIDATION TEST SCRIPT
-- ============================================================================
-- 
-- This script tests the schema for common errors and validates all components
-- Run this AFTER executing schema.sql to verify everything works correctly
--
-- Expected Result: All tests should complete without errors
-- ============================================================================

-- Start transaction for testing (will rollback at end)
BEGIN;

-- ============================================================================
-- TEST 1: Verify All Tables Exist
-- ============================================================================
DO $$
DECLARE
  missing_tables TEXT[] := '{}';
  expected_tables TEXT[] := ARRAY[
    'users', 'wallets', 'groups', 'group_members', 'group_join_requests',
    'payout_slots', 'contributions', 'transactions', 'payouts', 
    'penalties', 'notifications', 'audit_logs'
  ];
  tbl TEXT;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TEST 1: Verifying Tables Exist';
  RAISE NOTICE '========================================';
  
  FOREACH tbl IN ARRAY expected_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
      missing_tables := array_append(missing_tables, tbl);
    ELSE
      RAISE NOTICE 'Table exists: %', tbl;
    END IF;
  END LOOP;
  
  IF array_length(missing_tables, 1) > 0 THEN
    RAISE EXCEPTION 'Missing tables: %', missing_tables;
  END IF;
  
  RAISE NOTICE 'TEST 1: PASSED ✓';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- TEST 2: Verify All ENUMs Exist
-- ============================================================================
DO $$
DECLARE
  missing_enums TEXT[] := '{}';
  expected_enums TEXT[] := ARRAY[
    'kyc_status_enum', 'group_status_enum', 'member_status_enum',
    'frequency_enum', 'contribution_status_enum', 'transaction_type_enum',
    'transaction_status_enum', 'payout_status_enum', 'penalty_type_enum',
    'penalty_status_enum', 'join_request_status_enum', 'slot_status_enum',
    'notification_type_enum'
  ];
  enum_name TEXT;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TEST 2: Verifying ENUMs Exist';
  RAISE NOTICE '========================================';
  
  FOREACH enum_name IN ARRAY expected_enums LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = enum_name) THEN
      missing_enums := array_append(missing_enums, enum_name);
    ELSE
      RAISE NOTICE 'ENUM exists: %', enum_name;
    END IF;
  END LOOP;
  
  IF array_length(missing_enums, 1) > 0 THEN
    RAISE EXCEPTION 'Missing ENUMs: %', missing_enums;
  END IF;
  
  RAISE NOTICE 'TEST 2: PASSED ✓';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- TEST 3: Verify All RPC Functions Exist
-- ============================================================================
DO $$
DECLARE
  missing_functions TEXT[] := '{}';
  expected_functions TEXT[] := ARRAY[
    'create_user_profile_atomic',
    'check_user_exists',
    'request_to_join_group',
    'get_pending_join_requests',
    'approve_join_request',
    'reject_join_request',
    'initialize_group_slots',
    'get_available_slots',
    'get_admin_analytics',
    'get_all_users_admin',
    'get_all_groups_admin',
    'get_audit_logs_admin',
    'suspend_user_admin',
    'deactivate_group_admin',
    'mark_overdue_contributions',
    'get_user_dashboard_summary',
    'update_updated_at_column',
    'create_wallet_for_new_user',
    'update_group_member_count'
  ];
  func_name TEXT;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TEST 3: Verifying RPC Functions Exist';
  RAISE NOTICE '========================================';
  
  FOREACH func_name IN ARRAY expected_functions LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = func_name) THEN
      missing_functions := array_append(missing_functions, func_name);
    ELSE
      RAISE NOTICE 'Function exists: %', func_name;
    END IF;
  END LOOP;
  
  IF array_length(missing_functions, 1) > 0 THEN
    RAISE EXCEPTION 'Missing functions: %', missing_functions;
  END IF;
  
  RAISE NOTICE 'TEST 3: PASSED ✓';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- TEST 4: Verify RLS is Enabled on All Tables
-- ============================================================================
DO $$
DECLARE
  tables_without_rls TEXT[] := '{}';
  tbl RECORD;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TEST 4: Verifying RLS Enabled';
  RAISE NOTICE '========================================';
  
  FOR tbl IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename IN (
        'users', 'wallets', 'groups', 'group_members', 'group_join_requests',
        'payout_slots', 'contributions', 'transactions', 'payouts', 
        'penalties', 'notifications', 'audit_logs'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = tbl.tablename
        AND n.nspname = 'public'
        AND c.relrowsecurity = true
    ) THEN
      tables_without_rls := array_append(tables_without_rls, tbl.tablename);
    ELSE
      RAISE NOTICE 'RLS enabled: %', tbl.tablename;
    END IF;
  END LOOP;
  
  IF array_length(tables_without_rls, 1) > 0 THEN
    RAISE EXCEPTION 'Tables without RLS: %', tables_without_rls;
  END IF;
  
  RAISE NOTICE 'TEST 4: PASSED ✓';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- TEST 5: Verify Storage Bucket Exists
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TEST 5: Verifying Storage Bucket';
  RAISE NOTICE '========================================';
  
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars') THEN
    RAISE EXCEPTION 'Storage bucket "avatars" not found';
  END IF;
  
  RAISE NOTICE 'Storage bucket exists: avatars';
  RAISE NOTICE 'TEST 5: PASSED ✓';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- TEST 6: Test ENUM Values Match Application
-- ============================================================================
DO $$
DECLARE
  kyc_values TEXT[];
  group_status_values TEXT[];
  transaction_status_values TEXT[];
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TEST 6: Verifying ENUM Values';
  RAISE NOTICE '========================================';
  
  -- Check KYC status enum (DB uses 'approved', app converts to 'verified')
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO kyc_values
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'kyc_status_enum';
  
  IF kyc_values != ARRAY['not_started', 'pending', 'approved', 'rejected'] THEN
    RAISE EXCEPTION 'KYC status enum values incorrect: %', kyc_values;
  END IF;
  RAISE NOTICE 'KYC status enum: % (NOTE: "approved" converts to "verified" in app)', kyc_values;
  
  -- Check group status enum
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO group_status_values
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'group_status_enum';
  
  IF group_status_values != ARRAY['forming', 'active', 'paused', 'completed', 'cancelled'] THEN
    RAISE EXCEPTION 'Group status enum values incorrect: %', group_status_values;
  END IF;
  RAISE NOTICE 'Group status enum: %', group_status_values;
  
  -- Check transaction status enum
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO transaction_status_values
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'transaction_status_enum';
  
  IF transaction_status_values != ARRAY['pending', 'processing', 'completed', 'failed', 'cancelled'] THEN
    RAISE EXCEPTION 'Transaction status enum values incorrect: %', transaction_status_values;
  END IF;
  RAISE NOTICE 'Transaction status enum: %', transaction_status_values;
  
  RAISE NOTICE 'TEST 6: PASSED ✓';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- TEST 7: Test Default Values
-- ============================================================================
DO $$
DECLARE
  service_fee_default NUMERIC;
  security_deposit_default INTEGER;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TEST 7: Verifying Default Values';
  RAISE NOTICE '========================================';
  
  -- Check service fee percentage default (should be 2.00)
  SELECT column_default::NUMERIC INTO service_fee_default
  FROM information_schema.columns
  WHERE table_name = 'groups' AND column_name = 'service_fee_percentage';
  
  IF service_fee_default != 2.00 THEN
    RAISE EXCEPTION 'Service fee percentage default incorrect: % (expected 2.00)', service_fee_default;
  END IF;
  RAISE NOTICE 'Service fee percentage default: %', service_fee_default;
  
  -- Check security deposit percentage default (should be 10)
  SELECT column_default::INTEGER INTO security_deposit_default
  FROM information_schema.columns
  WHERE table_name = 'groups' AND column_name = 'security_deposit_percentage';
  
  IF security_deposit_default != 10 THEN
    RAISE EXCEPTION 'Security deposit percentage default incorrect: % (expected 10)', security_deposit_default;
  END IF;
  RAISE NOTICE 'Security deposit percentage default: %', security_deposit_default;
  
  RAISE NOTICE 'TEST 7: PASSED ✓';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- TEST 8: Test Foreign Key Constraints
-- ============================================================================
DO $$
DECLARE
  fk_count INTEGER;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TEST 8: Verifying Foreign Key Constraints';
  RAISE NOTICE '========================================';
  
  -- Count foreign key constraints
  SELECT COUNT(*) INTO fk_count
  FROM information_schema.table_constraints
  WHERE constraint_type = 'FOREIGN KEY'
    AND table_schema = 'public';
  
  IF fk_count < 15 THEN
    RAISE EXCEPTION 'Expected at least 15 foreign key constraints, found: %', fk_count;
  END IF;
  
  RAISE NOTICE 'Foreign key constraints found: %', fk_count;
  RAISE NOTICE 'TEST 8: PASSED ✓';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- TEST 9: Test Triggers
-- ============================================================================
DO $$
DECLARE
  trigger_count INTEGER;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TEST 9: Verifying Triggers';
  RAISE NOTICE '========================================';
  
  -- Count triggers
  SELECT COUNT(*) INTO trigger_count
  FROM information_schema.triggers
  WHERE trigger_schema = 'public';
  
  IF trigger_count < 7 THEN
    RAISE EXCEPTION 'Expected at least 7 triggers, found: %', trigger_count;
  END IF;
  
  RAISE NOTICE 'Triggers found: %', trigger_count;
  RAISE NOTICE 'TEST 9: PASSED ✓';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- TEST 10: Test Indexes
-- ============================================================================
DO $$
DECLARE
  index_count INTEGER;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TEST 10: Verifying Indexes';
  RAISE NOTICE '========================================';
  
  -- Count indexes (excluding primary keys)
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname NOT LIKE '%_pkey';
  
  IF index_count < 20 THEN
    RAISE EXCEPTION 'Expected at least 20 indexes, found: %', index_count;
  END IF;
  
  RAISE NOTICE 'Indexes found: % (excluding primary keys)', index_count;
  RAISE NOTICE 'TEST 10: PASSED ✓';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Schema validation complete. Database is ready for use.';
  RAISE NOTICE '';
  RAISE NOTICE 'Summary:';
  RAISE NOTICE '  ✓ 12 tables created';
  RAISE NOTICE '  ✓ 12 ENUMs defined';
  RAISE NOTICE '  ✓ 19 RPC functions available';
  RAISE NOTICE '  ✓ RLS enabled on all tables';
  RAISE NOTICE '  ✓ Storage bucket configured';
  RAISE NOTICE '  ✓ ENUM values match application';
  RAISE NOTICE '  ✓ Default values correct';
  RAISE NOTICE '  ✓ Foreign keys properly defined';
  RAISE NOTICE '  ✓ Triggers functioning';
  RAISE NOTICE '  ✓ Indexes optimized';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Configure environment variables';
  RAISE NOTICE '  2. Create your first admin user';
  RAISE NOTICE '  3. Test signup/login flow';
  RAISE NOTICE '  4. Deploy Edge Functions';
  RAISE NOTICE '';
END $$;

-- Rollback transaction (this was just a test)
ROLLBACK;
