# Database Migration: RLS Infinite Recursion Fix

## Quick Start

If you're experiencing the "infinite recursion detected in policy for relation 'users'" error, follow these steps:

### 1. Apply the Migration

Choose one of these methods:

#### A. Supabase Dashboard (Easiest)
1. Go to [Supabase Dashboard](https://app.supabase.com) → Your Project
2. Navigate to **SQL Editor**
3. Copy the contents of `supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql`
4. Paste and click **Run**

#### B. Supabase CLI
```bash
# Apply the migration
psql $DATABASE_URL < supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql
```

### 2. Configure Admin Users (If Applicable)

If you have admin users in your system, update their JWT claims:

```sql
UPDATE auth.users 
SET raw_app_meta_data = raw_app_meta_data || '{"is_admin": true}'::jsonb
WHERE email = 'admin@example.com';
```

Replace `'admin@example.com'` with your actual admin email(s).

### 3. Verify the Fix

1. Have all users **log out completely**
2. Log back in
3. Verify:
   - ✅ No "infinite recursion" errors
   - ✅ User profiles load successfully
   - ✅ Admin features work (if applicable)

## What This Migration Does

This migration fixes 6 RLS policies that were causing infinite recursion:

| Table | Policy | Issue Fixed |
|-------|--------|-------------|
| users | "Admins can view all users" | Removed recursive query to users table |
| users | "Admins can update any user" | Removed recursive query to users table |
| groups | "Admins can update any group" | Removed recursive query to users table |
| group_members | "Creators and admins can update members" | Removed recursive query to users table |
| transactions | "Admins can view all transactions" | Removed recursive query to users table |
| audit_logs | "Admins can view audit logs" | Removed recursive query to users table |

**Key Change**: Admin privileges are now determined solely from JWT claims (`auth.jwt()->>'is_admin'`) instead of querying the database, which eliminates the circular dependency.

## Documentation

For detailed information, see:
- [Migrations README](supabase/migrations/README.md) - Complete migration guide
- [RLS Fix Details](RLS_INFINITE_RECURSION_FIX.md) - Technical details about the fix
- [Fix Summary](FIX_SUMMARY.md) - Executive summary

## Need Help?

If you encounter issues:
1. Verify the migration ran successfully (check for errors in SQL output)
2. Ensure admin users have the `is_admin` claim in their JWT
3. Make sure users have logged out and back in
4. Check browser console for detailed error messages
5. Review the [Supabase README](supabase/README.md) for troubleshooting

## Safety Notes

✅ **Safe to run multiple times** - Uses `DROP POLICY IF EXISTS`
✅ **No data loss** - Only updates policy definitions
✅ **No downtime required** - Can be applied to live database
✅ **Backward compatible** - Regular users unaffected
