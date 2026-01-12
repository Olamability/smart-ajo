# Deployment Instructions for Signup Fix

## Overview
This document provides step-by-step instructions for deploying the signup duplicate key error fix to your Supabase instance.

## Prerequisites
- Access to Supabase SQL Editor or psql command line
- Admin/Service Role access to your Supabase project
- Backup of current database state (recommended)

## Deployment Steps

### Step 1: Backup Current Functions (Recommended)

Before making any changes, backup your current functions:

```sql
-- Backup current create_user_profile_atomic function
SELECT pg_get_functiondef('create_user_profile_atomic'::regproc);

-- Save the output to a file for rollback if needed
```

### Step 2: Deploy New SQL Functions

#### Option A: Using Supabase SQL Editor

1. Log into your Supabase dashboard
2. Navigate to the SQL Editor
3. Copy the contents of `supabase/functions.sql` (lines 29-148)
4. Paste into the SQL Editor
5. Click "Run" to execute

#### Option B: Using psql Command Line

```bash
# Connect to your Supabase database
psql "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].supabase.co:5432/postgres"

# Run the functions.sql file (only the updated functions)
\i supabase/functions.sql
```

#### Option C: Apply Only the Changed Functions

If you prefer to apply only the changed functions:

```sql
-- 1. Create/Replace check_user_exists function
CREATE OR REPLACE FUNCTION check_user_exists(
  p_email VARCHAR(255) DEFAULT NULL,
  p_phone VARCHAR(20) DEFAULT NULL
)
RETURNS TABLE(
  email_exists BOOLEAN,
  phone_exists BOOLEAN,
  user_id UUID
) AS $$
DECLARE
  v_email_user_id UUID;
  v_phone_user_id UUID;
BEGIN
  -- Check if email exists
  IF p_email IS NOT NULL THEN
    SELECT id INTO v_email_user_id
    FROM users
    WHERE email = p_email
    LIMIT 1;
  END IF;
  
  -- Check if phone exists
  IF p_phone IS NOT NULL THEN
    SELECT id INTO v_phone_user_id
    FROM users
    WHERE phone = p_phone
    LIMIT 1;
  END IF;
  
  -- Return results
  -- Note: If email and phone belong to different users, both flags can be true
  -- The user_id returns the conflicting user ID (email takes precedence if both exist)
  RETURN QUERY SELECT 
    v_email_user_id IS NOT NULL,
    v_phone_user_id IS NOT NULL,
    COALESCE(v_email_user_id, v_phone_user_id); -- Return email ID first, fallback to phone ID
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_user_exists IS 
  'Checks if a user exists with given email or phone. Public function for pre-signup validation.';

-- Grant execute permission to anon users (for signup validation)
GRANT EXECUTE ON FUNCTION check_user_exists TO anon, authenticated;

-- 2. Create/Replace create_user_profile_atomic function
CREATE OR REPLACE FUNCTION create_user_profile_atomic(
  p_user_id UUID,
  p_email VARCHAR(255),
  p_phone VARCHAR(20),
  p_full_name VARCHAR(255)
)
RETURNS TABLE(success BOOLEAN, user_id UUID, error_message TEXT) AS $$
DECLARE
  v_existing_email_user UUID;
  v_existing_phone_user UUID;
BEGIN
  -- Check for existing email
  SELECT id INTO v_existing_email_user
  FROM users
  WHERE email = p_email AND id != p_user_id
  LIMIT 1;
  
  IF v_existing_email_user IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Email is already registered'::TEXT;
    RETURN; -- Exit function early after returning error
  END IF;
  
  -- Check for existing phone
  SELECT id INTO v_existing_phone_user
  FROM users
  WHERE phone = p_phone AND id != p_user_id
  LIMIT 1;
  
  IF v_existing_phone_user IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Phone number is already registered'::TEXT;
    RETURN; -- Exit function early after returning error
  END IF;
  
  -- Attempt to insert user profile
  -- ON CONFLICT ensures we don't create duplicates
  INSERT INTO users (id, email, phone, full_name, is_verified, is_active, kyc_status)
  VALUES (p_user_id, p_email, p_phone, p_full_name, FALSE, TRUE, 'not_started')
  ON CONFLICT (id) DO NOTHING;
  
  -- Check if the user now exists (either just created or already existed)
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RETURN QUERY SELECT TRUE, p_user_id, NULL::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Failed to create user profile'::TEXT;
  END IF;
  
EXCEPTION WHEN OTHERS THEN
  -- Catch any errors and return them with better messages
  -- Provide user-friendly error messages for common constraint violations
  IF SQLERRM LIKE '%users_email_key%' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Email is already registered'::TEXT;
  ELSIF SQLERRM LIKE '%users_phone_key%' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Phone number is already registered'::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_user_profile_atomic IS 
  'Atomically creates a user profile, handling race conditions and returning status';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_user_profile_atomic TO authenticated;
```

### Step 3: Verify Functions are Deployed

Run these queries to verify the functions exist:

```sql
-- Check if check_user_exists exists
SELECT routine_name, routine_type, data_type
FROM information_schema.routines 
WHERE routine_name = 'check_user_exists'
  AND routine_schema = 'public';

-- Check if create_user_profile_atomic exists
SELECT routine_name, routine_type, data_type
FROM information_schema.routines 
WHERE routine_name = 'create_user_profile_atomic'
  AND routine_schema = 'public';

-- Test check_user_exists function (should return all false for new user)
SELECT * FROM check_user_exists('newuser@test.com', '+1234567890');

-- Test with existing user (if you have one)
SELECT * FROM check_user_exists('existing@test.com', NULL);
```

### Step 4: Deploy Frontend Changes

#### Option A: Via CI/CD Pipeline

If you have a CI/CD pipeline set up:

1. Merge the PR `fix-signup-duplicate-key-error`
2. The pipeline should automatically build and deploy
3. Monitor the deployment logs

#### Option B: Manual Deployment

```bash
# 1. Pull the latest changes
git checkout main
git pull origin main

# 2. Build the frontend
npm run build

# 3. Deploy to your hosting provider
# (Specific commands depend on your hosting provider)
# Examples:
# - Vercel: vercel --prod
# - Netlify: netlify deploy --prod
# - AWS S3: aws s3 sync dist/ s3://your-bucket/
```

### Step 5: Verify Deployment

#### Test the New Flow:

1. **Test Case 1: New User Signup**
   - Try to sign up with a completely new email and phone
   - Should succeed without errors

2. **Test Case 2: Duplicate Email**
   - Try to sign up with an existing email
   - Should see: "An account with this email already exists. Please sign in instead."
   - No orphaned auth user should be created

3. **Test Case 3: Duplicate Phone**
   - Try to sign up with an existing phone number
   - Should see: "An account with this phone number already exists. Please use a different phone number."
   - No orphaned auth user should be created

#### Check Database State:

```sql
-- Check for orphaned auth users (should be none after fix)
SELECT au.id, au.email, au.created_at
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
WHERE pu.id IS NULL
  AND au.created_at > '2026-01-11'  -- After deployment date
ORDER BY au.created_at DESC;

-- Check that duplicates are still prevented
SELECT email, COUNT(*) 
FROM public.users 
GROUP BY email 
HAVING COUNT(*) > 1;

SELECT phone, COUNT(*) 
FROM public.users 
GROUP BY phone 
HAVING COUNT(*) > 1;
```

### Step 6: Monitor for Issues

After deployment, monitor:

1. **Supabase Logs**: Check for any RPC errors
2. **Frontend Error Tracking**: Monitor for any signup errors
3. **User Feedback**: Watch for any user-reported issues
4. **Signup Success Rate**: Should improve after deployment

## Rollback Plan

If you need to rollback:

### Rollback SQL Functions:

```sql
-- Option 1: Drop the new function
DROP FUNCTION IF EXISTS check_user_exists(VARCHAR, VARCHAR);

-- Option 2: Restore from backup (if you saved it)
-- Paste your backed-up function definition here

-- Restore previous create_user_profile_atomic if needed
-- Paste your backed-up function definition here
```

### Rollback Frontend:

```bash
# Revert the commit
git revert c48fc9f

# Deploy the reverted version
npm run build
# Deploy using your hosting provider's commands
```

## Post-Deployment Checklist

- [ ] Database functions deployed successfully
- [ ] Functions verified with test queries
- [ ] Frontend deployed to production
- [ ] Test Case 1 (new user) passed
- [ ] Test Case 2 (duplicate email) passed
- [ ] Test Case 3 (duplicate phone) passed
- [ ] No orphaned auth users in database
- [ ] Logs show no errors
- [ ] Monitoring set up
- [ ] Documentation updated
- [ ] Team notified of changes

## Troubleshooting

### Issue: "Function check_user_exists does not exist"

**Solution**: The function wasn't deployed. Re-run Step 2.

### Issue: "Permission denied for function check_user_exists"

**Solution**: Run the GRANT statements:
```sql
GRANT EXECUTE ON FUNCTION check_user_exists TO anon, authenticated;
```

### Issue: Frontend still showing old error messages

**Solution**: 
1. Clear browser cache
2. Verify frontend deployment succeeded
3. Check that the new code is actually deployed

### Issue: Rate limiting still occurring

**Solution**: 
1. This fix prevents the root cause, but existing rate limits may still apply
2. Wait for Supabase's rate limit window to expire (usually 45-60 seconds)
3. If persistent, check Supabase project settings

## Support

If you encounter issues during deployment:

1. Check the Supabase logs in your dashboard
2. Review browser console for frontend errors
3. Verify all SQL statements executed without errors
4. Consult SIGNUP_FIX_TESTING.md for detailed test cases
5. Roll back if critical issues are found

## Success Metrics

After deployment, you should see:

- ✅ Reduced signup error rate
- ✅ No orphaned auth users in the database
- ✅ No duplicate key constraint violations
- ✅ Better user experience with clear error messages
- ✅ Reduced rate limiting incidents
- ✅ Faster signup success path

---

**Deployment Date**: _To be filled after deployment_  
**Deployed By**: _To be filled after deployment_  
**Environment**: _Production / Staging_  
**Status**: _Success / Rolled Back_
