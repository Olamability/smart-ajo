# 🚀 Migration Quick Start

## Apply the RLS Infinite Recursion Fix in 5 Minutes

### Step 1: Open Supabase Dashboard (1 min)
1. Go to https://app.supabase.com
2. Select your project
3. Navigate to **SQL Editor** in the left sidebar

### Step 2: Apply Migration (2 min)
1. Open the file `supabase/migrations/20260205020229_fix_rls_infinite_recursion.sql`
2. Copy the entire contents
3. Paste into the SQL Editor
4. Click **Run** button (or press Ctrl+Enter)
5. Wait for "Success" message

### Step 3: Configure Admins (1 min, if applicable)
**Only do this if you have admin users:**

In the same SQL Editor, run:
```sql
UPDATE auth.users 
SET raw_app_meta_data = raw_app_meta_data || '{"is_admin": true}'::jsonb
WHERE email = 'your-admin@example.com';
```

Replace `'your-admin@example.com'` with your actual admin email(s).

### Step 4: Verify (1 min)
1. Have users **log out completely** from your app
2. Log back in
3. ✅ Check: No "infinite recursion" errors
4. ✅ Check: User profiles load successfully
5. ✅ Check: Admin features work (if applicable)

## Done! 🎉

That's it! The infinite recursion issue is now fixed.

## What Happened?

The migration updated 6 RLS policies:
- ✅ 2 policies on `users` table
- ✅ 1 policy on `groups` table
- ✅ 1 policy on `group_members` table
- ✅ 1 policy on `transactions` table
- ✅ 1 policy on `audit_logs` table

All admin checks now use JWT claims instead of database queries, eliminating the circular dependency that caused infinite recursion.

## Need More Details?

- **Quick guide**: See [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)
- **Complete guide**: See [supabase/migrations/README.md](supabase/migrations/README.md)
- **Technical details**: See [RLS_INFINITE_RECURSION_FIX.md](RLS_INFINITE_RECURSION_FIX.md)

## Troubleshooting

### "Policy does not exist" error
- That's OK! The migration uses `DROP IF EXISTS`, so it's safe even if policies don't exist yet.

### Still seeing infinite recursion?
1. Verify the migration ran successfully (check for "Success" message)
2. Make sure users logged out and back in
3. Check browser console for detailed error messages
4. Verify admin JWT claims are configured (if applicable)

### Admin features not working?
1. Make sure you ran Step 3 to configure admin JWT claims
2. Admin must log out and back in for JWT to refresh
3. Check that the email in the UPDATE statement is correct

## Safety Notes

✅ **Safe to run multiple times** - The migration is idempotent
✅ **No data loss** - Only updates policy definitions
✅ **No downtime** - Can be applied to live database
✅ **Backward compatible** - Regular users unaffected

---

**Questions?** Check the documentation files or open an issue.
