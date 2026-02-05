# Visual Explanation: RLS Infinite Recursion Fix

## The Problem (Before)

```
┌─────────────────────────────────────────────────────────────────┐
│ User tries to log in and load profile                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Frontend: SELECT * FROM users WHERE id = 'user-id'             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PostgreSQL: Check RLS Policy "Users can view own profile"      │
│ USING (auth.uid() = id)                                         │
│ ✅ Match! User can see their own record                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PostgreSQL: Also check "Admins can view all users" policy      │
│ USING (                                                         │
│   (auth.jwt()->>'is_admin')::boolean = true                    │
│   OR                                                            │
│   (auth.uid() = id AND is_admin = true)  ← PROBLEM!            │
│ )                                                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PostgreSQL: Need to check "is_admin" column                    │
│ This requires reading from users table...                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PostgreSQL: SELECT is_admin FROM users WHERE id = auth.uid()   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PostgreSQL: Check RLS Policy AGAIN!                            │
│ ⚠️  Wait... we're already in a policy check!                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PostgreSQL: INFINITE RECURSION DETECTED!                        │
│ ❌ ERROR: "infinite recursion detected in policy               │
│           for relation 'users'"                                 │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ User sees error: "Unable to complete authentication"           │
│ ❌ Login fails                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## The Solution (After)

```
┌─────────────────────────────────────────────────────────────────┐
│ User tries to log in and load profile                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Frontend: SELECT * FROM users WHERE id = 'user-id'             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PostgreSQL: Check RLS Policy "Users can view own profile"      │
│ USING (auth.uid() = id)                                         │
│ ✅ Match! User can see their own record                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PostgreSQL: Also check "Admins can view all users" policy      │
│ USING (                                                         │
│   (auth.jwt()->>'is_admin')::boolean = true                    │
│ )                                                               │
│                                                                 │
│ ✅ JWT claims are pre-populated, no DB query needed!           │
│ ✅ No recursion!                                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PostgreSQL: Returns user profile data                          │
│ ✅ Success!                                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ User successfully logs in                                       │
│ ✅ Profile loads correctly                                      │
│ ✅ User redirected to dashboard                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Key Differences

### Before (Broken)
```sql
CREATE POLICY "Admins can view all users"
  ON users FOR SELECT
  USING (
    (auth.jwt()->>'is_admin')::boolean = true
    OR 
    (auth.uid() = id AND is_admin = true)  ← Queries users table!
  );
```
- ❌ Fallback clause reads `is_admin` column
- ❌ Reading column triggers RLS policy check
- ❌ Policy check triggers another read
- ❌ Infinite loop!

### After (Fixed)
```sql
CREATE POLICY "Admins can view all users"
  ON users FOR SELECT
  USING (
    (auth.jwt()->>'is_admin')::boolean = true  ← Uses JWT only!
  );
```
- ✅ Only checks JWT claims
- ✅ JWT is already in memory
- ✅ No database query needed
- ✅ No recursion possible!

## Why This Works

### JWT Claims Flow
```
User logs in
    ↓
Supabase Auth creates JWT
    ↓
JWT contains user metadata:
{
  "sub": "user-id",
  "email": "user@example.com",
  "is_admin": true,  ← Set during login
  ...
}
    ↓
JWT passed with every request
    ↓
PostgreSQL reads JWT from auth.jwt()
    ↓
No database query needed!
    ↓
Policy check completes instantly
```

### Database Query Flow (Problematic)
```
Check RLS policy
    ↓
Need to read is_admin column
    ↓
SELECT is_admin FROM users
    ↓
Triggers RLS policy check
    ↓
Need to read is_admin column
    ↓
Infinite loop!
```

## All Fixed Policies

1. **users.Admins can view all users** - Removed DB query fallback
2. **users.Admins can update any user** - Removed DB query fallback  
3. **groups.Admins can update any group** - Changed from EXISTS(SELECT...) to JWT
4. **group_members.Creators and admins can update** - Changed from EXISTS(SELECT...) to JWT
5. **transactions.Admins can view all** - Changed from EXISTS(SELECT...) to JWT
6. **audit_logs.Admins can view logs** - Changed from EXISTS(SELECT...) to JWT

## Security Impact

✅ **No security regression**
- Regular users still can only access their own data
- Admin access now requires JWT claim (more secure!)
- Policies are simpler and more maintainable

✅ **Performance improvement**
- No database queries for admin checks
- Faster policy evaluation
- Reduced database load

## Migration Notes

For admin users to work, ensure JWT contains `is_admin` claim:

```sql
-- Set admin claim in user metadata
UPDATE auth.users 
SET raw_app_meta_data = raw_app_meta_data || '{"is_admin": true}'::jsonb
WHERE email = 'admin@example.com';
```

Admin must log out and back in for JWT to refresh.

## Deployment

To apply this fix, use the migration file:

1. **Quick Start**: See [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) for step-by-step instructions
2. **Complete Guide**: See [supabase/migrations/README.md](supabase/migrations/README.md) for all deployment options
3. **Migration File**: `supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql`
