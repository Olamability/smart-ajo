# Supabase Migrations

This directory contains database migrations for the Smart Ajo application. Migrations allow you to version control and incrementally apply database schema changes.

## Migration Files

Migrations are named with a timestamp prefix followed by a descriptive name:
```
YYYYMMDDHHMMSS_description.sql
```

### Available Migrations

#### `20260205020229_fix_rls_infinite_recursion.sql`
**Purpose**: Fixes infinite recursion error in Row Level Security (RLS) policies

**Problem Solved**: 
Users were unable to log in due to "infinite recursion detected in policy for relation 'users'" errors. This was caused by RLS policies that queried the `users` table while already executing within a users table policy context.

**Changes**:
- Updates 6 RLS policies across 5 tables (users, groups, group_members, transactions, audit_logs)
- Removes recursive fallback clauses that caused infinite loops
- Admin privileges now determined solely from JWT claims (`auth.jwt()->>'is_admin'`)
- No database queries needed for permission checks (eliminates recursion)

**Tables Affected**:
- `users` - 2 policies
- `groups` - 1 policy
- `group_members` - 1 policy
- `transactions` - 1 policy
- `audit_logs` - 1 policy

## How to Apply Migrations

### Option 1: Supabase Dashboard (Recommended for Production)

1. Log into your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Navigate to **SQL Editor**
4. Copy the contents of the migration file you want to apply
5. Paste into the SQL Editor
6. Click **Run** to execute

### Option 2: Supabase CLI (For Development/Staging)

If you have the Supabase CLI installed:

```bash
# Link to your project (first time only)
supabase link --project-ref your-project-ref

# Apply all pending migrations
supabase db push

# Or apply a specific migration
psql $DATABASE_URL < supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql
```

### Option 3: Direct Database Connection

If you have direct database access:

```bash
# Using psql
psql postgresql://[user]:[password]@[host]:5432/postgres \
  < supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql

# Or using Supabase connection string
psql "$(supabase status | grep 'DB URL' | awk '{print $3}')" \
  < supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql
```

## Post-Migration Steps

### After applying `20260205020229_fix_rls_infinite_recursion.sql`

1. **Configure Admin Users** (if you have admins):
   ```sql
   UPDATE auth.users 
   SET raw_app_meta_data = raw_app_meta_data || '{"is_admin": true}'::jsonb
   WHERE email = 'admin@example.com';
   ```
   
   Replace `'admin@example.com'` with your actual admin email(s).

2. **Have Users Log Out and Back In**:
   - All users should log out completely
   - Log back in to get fresh JWT tokens
   - This is especially important for admin users to get the updated `is_admin` claim

3. **Verify the Fix**:
   - Regular users can log in successfully
   - User profiles load without errors
   - No "infinite recursion" errors in browser console or logs
   - Admin features work correctly (if applicable)

## Testing Migrations

Before applying to production, test migrations in a staging environment:

1. Create a test Supabase project or use a local instance
2. Apply the migration
3. Run your application test suite
4. Manually test affected features
5. Verify no errors in logs

## Migration Best Practices

1. **Always backup before migrating production**:
   ```bash
   # Backup via Supabase dashboard or CLI
   supabase db dump -f backup_$(date +%Y%m%d).sql
   ```

2. **Test in staging first**: Never apply untested migrations directly to production

3. **Review changes carefully**: Read through the entire migration file before applying

4. **One-way migrations**: These migrations are designed to be applied once. Rerunning is safe (uses `DROP IF EXISTS`), but rollback procedures should be documented separately if needed.

5. **Monitor after deployment**: Watch application logs and error tracking for issues after applying migrations

## Rollback Procedures

### For RLS Policy Migrations

If you need to rollback the RLS infinite recursion fix, you would need to restore the previous policy definitions. However, since the previous versions had the infinite recursion bug, rollback is **not recommended**. Instead:

1. Review the error/issue
2. Fix the policy in a new migration
3. Apply the new migration

### Emergency Rollback

If critical issues occur:

```sql
-- EMERGENCY ONLY: Temporarily disable RLS on affected table
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- Investigate and fix
-- Then re-enable:
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
```

**⚠️ Warning**: Disabling RLS removes all access controls! Only use in emergencies and re-enable immediately after fixing.

## Migration History

Track which migrations have been applied using Supabase's built-in migration tracking or maintain your own log:

```sql
-- Check applied migrations (if using Supabase CLI)
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;
```

## Creating New Migrations

When you need to create a new migration:

1. **Generate timestamp**:
   ```bash
   date -u +"%Y%m%d%H%M%S"
   ```

2. **Create file** with timestamp and descriptive name:
   ```bash
   touch supabase/migrations/YYYYMMDDHHMMSS_your_description.sql
   ```

3. **Write migration**:
   - Include clear comments explaining the purpose
   - Use `DROP IF EXISTS` for idempotency
   - Document any post-migration steps needed
   - Test thoroughly before committing

4. **Update this README** with details about the new migration

## Troubleshooting

### Migration fails with "relation does not exist"
- Ensure tables are created before policies are applied
- Check that you're connected to the correct database
- Review the order of operations in the migration

### RLS policies not taking effect
- Verify RLS is enabled on the table: `ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;`
- Check that policies were created successfully: `\dp table_name` in psql
- Ensure JWT claims are properly configured for admin users

### "infinite recursion" error persists
- Verify the migration was applied successfully
- Check that no other policies query the same table recursively
- Review custom functions that might be called from policies
- Ensure users have logged out and back in to refresh their JWT

## Additional Resources

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL Row Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Supabase Migrations Guide](https://supabase.com/docs/guides/cli/local-development#database-migrations)
- [Smart Ajo Schema Reference](../schema.sql)

## Support

For issues or questions:
1. Check this README and migration comments
2. Review the main [Supabase README](../README.md)
3. Check documentation files in the root directory
4. Review git history for context on changes

## Notes

- All migrations in this directory have been tested and are safe to apply
- Migrations are designed to be idempotent (safe to run multiple times)
- Always review the migration content before applying to production
- Keep this README updated when adding new migrations
