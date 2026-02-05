# RLS Infinite Recursion Fix

## Problem Description

Users were able to log in successfully, but encountered "infinite recursion detected in policy" errors when accessing group-related data. Two separate recursion issues were identified and fixed:

1. **Users Table Recursion** (Initial Issue)
2. **Group Members Table Recursion** (Newly Discovered)

---

## Issue 1: Users Table Infinite Recursion (Fixed Previously)

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

### Solution

Removed all recursive fallback clauses that queried the `users` table. Admin privileges are now determined **solely** from JWT claims using `auth.jwt()->>'is_admin'`, which doesn't require a database query.

---

## Issue 2: Group Members Table Infinite Recursion (New Issue - Fixed in this PR)

### Error Messages
```
groups.ts:173 Error fetching member groups: 
{code: '42P17', message: 'infinite recursion detected in policy for relation "group_members"'}

groups.ts:437 Error fetching user memberships: 
{code: '42P17', message: 'infinite recursion detected in policy for relation "group_members"'}

AvailableGroupsSection.tsx:37 Failed to load available groups: 
infinite recursion detected in policy for relation "group_members"
```

### Root Cause

The "Users can view group members" SELECT policy on the `group_members` table contained a self-referencing subquery that created infinite recursion:

1. User queries `group_members` table to see members of a group
2. RLS policy checks if user is a member by querying `group_members` table
3. That query triggers the same RLS policy again (infinite loop)
4. PostgreSQL detects the recursion and throws error 42P17

### Problematic Policy

```sql
CREATE POLICY "Users can view group members"
  ON group_members FOR SELECT
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM group_members gm  -- RECURSION HERE!
      WHERE gm.group_id = group_members.group_id 
        AND gm.user_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id 
        AND g.created_by = auth.uid()
    )
  );
```

### Solution

A two-part fix:

#### Part 1: Simplify RLS Policy
Remove the recursive self-reference from the policy:

```sql
CREATE POLICY "Users can view group members"
  ON group_members FOR SELECT
  USING (
    auth.uid() = user_id OR  -- User's own membership record
    EXISTS (
      SELECT 1 FROM groups g  -- Group creator (no recursion)
      WHERE g.id = group_members.group_id 
        AND g.created_by = auth.uid()
    )
  );
```

#### Part 2: Add RPC Function for Member Access
Create a SECURITY DEFINER function to allow members to view other members safely:

```sql
CREATE FUNCTION get_group_members_safe(p_group_id UUID)
RETURNS TABLE (...) AS $$
BEGIN
  -- Check authorization first
  IF NOT EXISTS (
    SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM groups WHERE id = p_group_id AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  -- Return all members (bypasses RLS with SECURITY DEFINER)
  RETURN QUERY SELECT ... FROM group_members ...;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### Part 3: Update Frontend Code
Modified `getGroupMembers()` in `src/api/groups.ts`:

```typescript
// Before (Direct query - fails with simplified policy)
const { data, error } = await supabase
  .from('group_members')
  .select('*')
  .eq('group_id', groupId);

// After (Uses RPC function - works safely)
const { data, error } = await supabase
  .rpc('get_group_members_safe', { p_group_id: groupId });
```

---

## Complete Solution Summary

### Before (Problematic - Users Table)
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

#### Migration Files (Apply in order)
1. `supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql` - Fixes users table recursion
2. `supabase/migrations/20260205021700_fix_group_members_rls_recursion.sql` - Fixes group_members table recursion
3. `supabase/migrations/20260205021800_add_get_group_members_safe_function.sql` - Adds RPC function

#### Schema Files
- `supabase/schema.sql` - Updated with all fixes

#### Frontend Files
- `src/api/groups.ts` - Updated `getGroupMembers()` to use RPC function

### Tables Affected
- `users` - 2 policies fixed (admin recursion)
- `groups` - 1 policy fixed (admin recursion)
- `group_members` - 2 policies fixed (1 admin recursion, 1 self-reference recursion) + 1 RPC function added
- `transactions` - 1 policy fixed (admin recursion)
- `audit_logs` - 1 policy fixed (admin recursion)

## Deployment Instructions

### Prerequisites
- Access to Supabase project dashboard
- Database connection credentials (for CLI methods)
- Optional: Supabase CLI installed (`npm install -g supabase`)

### Step 1: Apply Schema Changes

#### Option A: Use Migration Files (Recommended)

Apply the three migration files in order:

1. Go to [Supabase Dashboard](https://app.supabase.com) → Your Project
2. Navigate to **SQL Editor**
3. Execute migrations in this order:
   - `supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql` (users table)
   - `supabase/migrations/20260205021700_fix_group_members_rls_recursion.sql` (group_members policy)
   - `supabase/migrations/20260205021800_add_get_group_members_safe_function.sql` (RPC function)
4. Click **Run** to execute each one

See [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) for detailed instructions.

#### Option B: Via Supabase Dashboard (Full Schema)

For new installations:
1. Log into your Supabase dashboard
2. Navigate to SQL Editor
3. Copy the contents of `supabase/schema.sql`
4. Execute the SQL to recreate all tables, policies, and functions

#### Option C: Via Supabase CLI
```bash
# Apply migrations in order
psql $DATABASE_URL < supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql
psql $DATABASE_URL < supabase/migrations/20260205021700_fix_group_members_rls_recursion.sql
psql $DATABASE_URL < supabase/migrations/20260205021800_add_get_group_members_safe_function.sql

# Or link and push all at once
supabase link --project-ref your-project-ref
supabase db push
```

#### Option D: Manual Policy Updates
If you only want to update the policies without recreating tables:

```sql
-- Fix 1: Drop and recreate admin policies (users table recursion)
DROP POLICY IF EXISTS "Admins can view all users" ON users;
DROP POLICY IF EXISTS "Admins can update any user" ON users;
DROP POLICY IF EXISTS "Admins can update any group" ON groups;
DROP POLICY IF EXISTS "Creators and admins can update members" ON group_members;
DROP POLICY IF EXISTS "Admins can view all transactions" ON transactions;
DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;

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

-- Fix 2: Drop and recreate group_members SELECT policy (self-reference recursion)
DROP POLICY IF EXISTS "Users can view group members" ON group_members;

CREATE POLICY "Users can view group members"
  ON group_members FOR SELECT
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id 
        AND g.created_by = auth.uid()
    )
  );

-- Fix 3: Add RPC function for safe member queries
CREATE OR REPLACE FUNCTION get_group_members_safe(p_group_id UUID)
RETURNS TABLE (
  user_id UUID,
  group_id UUID,
  position INTEGER,
  status member_status_enum,
  security_deposit_amount DECIMAL(10,2),
  has_paid_security_deposit BOOLEAN,
  security_deposit_paid_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  full_name TEXT,
  email TEXT,
  phone TEXT
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM groups g
    WHERE g.id = p_group_id AND g.created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to view members of this group';
  END IF;

  RETURN QUERY
  SELECT 
    gm.user_id, gm.group_id, gm.position, gm.status,
    gm.security_deposit_amount, gm.has_paid_security_deposit,
    gm.security_deposit_paid_at, gm.joined_at,
    u.full_name, u.email, u.phone
  FROM group_members gm
  JOIN users u ON gm.user_id = u.id
  WHERE gm.group_id = p_group_id
  ORDER BY gm.position ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_group_members_safe(UUID) TO authenticated;
```

### Step 2: Deploy Frontend Changes

After applying database migrations, deploy the updated frontend code:

```bash
# The frontend changes are in src/api/groups.ts
# Deploy your frontend application with the updated code
npm run build
# Then deploy to your hosting platform (Vercel, Netlify, etc.)
```

### Step 3: Configure Admin JWT Claims (Important!)

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

### Step 4: Verify the Fix

1. Log out all active users
2. Have a test user log in
3. Verify no "infinite recursion" errors appear in browser console
4. Test the following:
   - ✅ Dashboard loads without errors
   - ✅ Available groups section displays correctly
   - ✅ User's groups are shown
   - ✅ Group detail page shows all members
   - ✅ Profile loads successfully
5. Test admin users can still access admin-only resources

## Testing

### Manual Test Cases

1. **Regular User Login**
   - ✅ User can log in successfully
   - ✅ User profile loads without errors
   - ✅ User can view their own profile
   - ✅ User can update their own profile
   - ✅ Dashboard displays user's groups
   - ✅ Available groups section loads without errors
   - ✅ User can view group details and members

2. **Group Member Access**
   - ✅ Member can view their own group memberships
   - ✅ Member can view all members of groups they belong to (via RPC)
   - ✅ Member cannot view members of groups they don't belong to
   - ✅ Group creator can view all members of their groups

3. **Admin User Login**
   - ✅ Admin can log in successfully
   - ✅ Admin profile loads without errors
   - ✅ Admin can view all users (if JWT claim is set)
   - ✅ Admin can update any user (if JWT claim is set)

3. **Error Cases**
   - ✅ No infinite recursion errors in browser console
   - ✅ Clear error messages for invalid credentials
   - ✅ Proper handling of network errors
   - ✅ Unauthorized access properly denied

### SQL Test Queries

```sql
-- Test 1: User can read their own profile (users table)
SET request.jwt.claims = '{"sub": "user-uuid-here"}';
SELECT * FROM users WHERE id = 'user-uuid-here';
-- Should succeed

-- Test 2: Admin with JWT claim can read all users
SET request.jwt.claims = '{"sub": "admin-uuid-here", "is_admin": true}';
SELECT * FROM users;
-- Should succeed

-- Test 3: User can read their own group memberships
SET request.jwt.claims = '{"sub": "user-uuid-here"}';
SELECT * FROM group_members WHERE user_id = 'user-uuid-here';
-- Should succeed

-- Test 4: Group creator can read all members
SET request.jwt.claims = '{"sub": "creator-uuid-here"}';
SELECT * FROM group_members WHERE group_id = 'group-uuid-created-by-this-user';
-- Should succeed

-- Test 5: Regular member can use RPC to get all members
SET request.jwt.claims = '{"sub": "member-uuid-here"}';
SELECT * FROM get_group_members_safe('group-uuid-where-user-is-member');
-- Should succeed

-- Test 6: Non-member cannot use RPC
SET request.jwt.claims = '{"sub": "other-user-uuid"}';
SELECT * FROM get_group_members_safe('group-uuid-where-user-is-not-member');
-- Should fail with authorization error
```

## Rollback Plan

If issues occur with the group_members table:

```sql
-- EMERGENCY ONLY - Disables security!
ALTER TABLE group_members DISABLE ROW LEVEL SECURITY;
```

Then investigate and re-enable with:
```sql
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
```

For users table issues:
```sql
-- EMERGENCY ONLY - Disables security!
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
```

Then investigate and re-enable with:
```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
```

**Important**: Disabling RLS should only be done in emergency situations and for short periods, as it removes all access controls.

## Prevention

To prevent this issue in the future:

1. **Never query the same table from its own RLS policy**
   - Self-referencing queries cause infinite recursion
   - Use alternative approaches like JWT claims or separate tracking tables
   
2. **Use SECURITY DEFINER functions for complex authorization**
   - Functions can bypass RLS and perform their own checks
   - Safer than complex recursive policies
   
3. **Use JWT claims for roles/permissions** instead of database lookups
   - JWT claims don't require database queries
   - No risk of recursion
   
4. **Test RLS policies thoroughly** before deploying to production
   - Use SQL test queries to verify policy behavior
   - Test with different user roles and scenarios
   
5. **Document policy dependencies** clearly in comments
   - Explain what each policy checks
   - Note any dependencies on other tables
   
6. **Prefer simple policies over complex ones**
   - Simple policies are easier to understand and debug
   - Use RPC functions for complex authorization logic

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
