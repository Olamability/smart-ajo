# RLS Infinite Recursion Fix

## Problem Description

Users were unable to log in due to an "infinite recursion detected in policy for relation 'users'" error when loading user profiles after successful authentication.

### Error Message
```
Failed to load user profile: infinite recursion detected in policy for relation "users"
```

### Root Cause

Multiple RLS (Row Level Security) policies contained fallback clauses that queried the `users` table while already executing within a `users` table policy context. This created a circular dependency:

1. User tries to read their profile from the `users` table
2. RLS policy checks if user is an admin by reading `is_admin` column from `users` table
3. Reading `is_admin` triggers the RLS policy again (infinite loop)
4. PostgreSQL detects the recursion and throws an error

### Affected Policies

Six policies were affected across multiple tables:

1. **users table**: `"Admins can view all users"` (SELECT)
2. **users table**: `"Admins can update any user"` (UPDATE)
3. **groups table**: `"Admins can update any group"` (UPDATE)
4. **group_members table**: `"Creators and admins can update members"` (UPDATE)
5. **transactions table**: `"Admins can view all transactions"` (SELECT)
6. **audit_logs table**: `"Admins can view audit logs"` (SELECT)

## Solution

Removed all recursive fallback clauses that queried the `users` table. Admin privileges are now determined **solely** from JWT claims using `auth.jwt()->>'is_admin'`, which doesn't require a database query.

### Before (Problematic)
```sql
CREATE POLICY "Admins can view all users"
  ON users FOR SELECT
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
    OR 
    -- Fallback causes infinite recursion!
    (auth.uid() = id AND is_admin = true)
  );
```

### After (Fixed)
```sql
CREATE POLICY "Admins can view all users"
  ON users FOR SELECT
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
  );
```

### Why This Works

1. **JWT claims are pre-populated**: The `auth.jwt()` function returns claims that are already in the JWT token, requiring no database queries
2. **No circular dependency**: Since we're not querying the `users` table within its own RLS policy, there's no recursion
3. **Regular users unaffected**: Non-admin users already have separate policies (`"Users can view own profile"`) that work correctly
4. **Admins must have JWT claim**: Admins need the `is_admin` claim set in their JWT (configured in Supabase Auth settings)

## Changes Summary

### Files Modified
- `supabase/schema.sql` - Removed 22 lines causing infinite recursion across 6 policies

### Tables Affected
- `users` - 2 policies fixed
- `groups` - 1 policy fixed
- `group_members` - 1 policy fixed  
- `transactions` - 1 policy fixed
- `audit_logs` - 1 policy fixed

## Deployment Instructions

### Prerequisites
- Access to Supabase project dashboard
- Database connection credentials (for CLI methods)
- Optional: Supabase CLI installed (`npm install -g supabase`)

### Step 1: Apply Schema Changes

#### Option A: Use Migration File (Recommended)

The easiest way to apply this fix is using the dedicated migration file:

1. Go to [Supabase Dashboard](https://app.supabase.com) → Your Project
2. Navigate to **SQL Editor**
3. Open and copy the contents of `supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql`
4. Paste into the SQL Editor
5. Click **Run** to execute

See [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) for detailed instructions.

#### Option B: Via Supabase Dashboard (Full Schema)

For new installations:
1. Log into your Supabase dashboard
2. Navigate to SQL Editor
3. Copy the contents of `supabase/schema.sql`
4. Execute the SQL to recreate all tables and policies

#### Option C: Via Supabase CLI
```bash
# Apply the migration directly
psql $DATABASE_URL < supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql

# Or link and push
supabase link --project-ref your-project-ref
supabase db push
```

#### Option D: Manual Policy Updates
If you only want to update the policies without recreating tables:

```sql
-- Drop existing policies
DROP POLICY IF EXISTS "Admins can view all users" ON users;
DROP POLICY IF EXISTS "Admins can update any user" ON users;
DROP POLICY IF EXISTS "Admins can update any group" ON groups;
DROP POLICY IF EXISTS "Creators and admins can update members" ON group_members;
DROP POLICY IF EXISTS "Admins can view all transactions" ON transactions;
DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;

-- Recreate with fixed versions
CREATE POLICY "Admins can view all users"
  ON users FOR SELECT
  USING ((auth.jwt()->>'is_admin')::boolean = true);

CREATE POLICY "Admins can update any user"
  ON users FOR UPDATE
  USING ((auth.jwt()->>'is_admin')::boolean = true);

CREATE POLICY "Admins can update any group"
  ON groups FOR UPDATE
  USING ((auth.jwt()->>'is_admin')::boolean = true);

CREATE POLICY "Creators and admins can update members"
  ON group_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id 
        AND g.created_by = auth.uid()
    ) OR
    (auth.jwt()->>'is_admin')::boolean = true
  );

CREATE POLICY "Admins can view all transactions"
  ON transactions FOR SELECT
  USING ((auth.jwt()->>'is_admin')::boolean = true);

CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  USING ((auth.jwt()->>'is_admin')::boolean = true);
```

### Step 2: Configure Admin JWT Claims (Important!)

For admin users to work correctly, you need to set the `is_admin` claim in their JWT:

1. Go to Supabase Dashboard → Authentication → Users
2. Select an admin user
3. In the "User Metadata" section, add:
   ```json
   {
     "is_admin": true
   }
   ```
4. Or use SQL:
   ```sql
   UPDATE auth.users 
   SET raw_app_meta_data = raw_app_meta_data || '{"is_admin": true}'::jsonb
   WHERE email = 'admin@example.com';
   ```

**Note**: After updating metadata, the user must log out and log back in for the JWT to be refreshed with the new claim.

### Step 3: Verify the Fix

1. Log out all active users
2. Have a test user log in
3. Verify no "infinite recursion" errors appear
4. Check that profile loads successfully
5. Test admin users can still access admin-only resources

## Testing

### Manual Test Cases

1. **Regular User Login**
   - ✅ User can log in successfully
   - ✅ User profile loads without errors
   - ✅ User can view their own profile
   - ✅ User can update their own profile

2. **Admin User Login**
   - ✅ Admin can log in successfully
   - ✅ Admin profile loads without errors
   - ✅ Admin can view all users (if JWT claim is set)
   - ✅ Admin can update any user (if JWT claim is set)

3. **Error Cases**
   - ✅ No infinite recursion errors
   - ✅ Clear error messages for invalid credentials
   - ✅ Proper handling of network errors

### SQL Test Query
```sql
-- Test that a regular user can read their own profile
SET request.jwt.claims = '{"sub": "user-uuid-here"}';
SELECT * FROM users WHERE id = 'user-uuid-here';
-- Should succeed

-- Test that admin with JWT claim can read all users
SET request.jwt.claims = '{"sub": "admin-uuid-here", "is_admin": true}';
SELECT * FROM users;
-- Should succeed
```

## Rollback Plan

If issues occur, you can temporarily disable RLS on the users table:

```sql
-- EMERGENCY ONLY - Disables security!
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
```

Then investigate and re-enable with:
```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
```

## Prevention

To prevent this issue in the future:

1. **Never query the same table from its own RLS policy**
2. **Use JWT claims for roles/permissions** instead of database lookups
3. **Test RLS policies thoroughly** before deploying to production
4. **Document policy dependencies** clearly in comments

## Related Documentation

- [Supabase RLS Best Practices](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL Row Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [JWT Claims in Supabase](https://supabase.com/docs/guides/auth/managing-user-data)

## Questions or Issues?

If you encounter any problems:
1. Check Supabase logs for detailed error messages
2. Verify JWT claims are properly set for admin users
3. Ensure schema changes were applied successfully
4. Review the git diff to confirm all changes were applied
