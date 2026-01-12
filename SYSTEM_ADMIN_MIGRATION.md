# System Admin Migration Guide

This guide explains how to apply the System Admin feature to an existing SmartAjo installation.

## Overview

The System Admin feature adds platform-wide administrative capabilities to SmartAjo, allowing designated administrators to:
- View all users and groups
- Suspend/activate users
- Freeze/activate groups
- View platform analytics
- Monitor all administrative actions via audit logs

## Prerequisites

- Existing SmartAjo installation with database access
- Supabase project access
- SQL Editor access in Supabase Dashboard
- At least one registered user account to promote to admin

## Migration Steps

### Step 1: Backup Your Database

**IMPORTANT**: Always backup before running migrations.

```sql
-- Create a backup in Supabase Dashboard:
-- 1. Go to Database > Backups
-- 2. Click "Create backup"
-- 3. Wait for backup to complete
```

### Step 2: Apply Admin Functions Migration

1. **Open Supabase SQL Editor**
   - Navigate to your Supabase project
   - Click "SQL Editor" in the left sidebar
   - Click "New Query"

2. **Copy the migration content**
   - Open `supabase/admin_functions.sql`
   - Copy the entire file content

3. **Paste and execute**
   - Paste into the SQL Editor
   - Click "Run" or press `Ctrl+Enter` (Windows/Linux) or `Cmd+Enter` (Mac)
   - Wait for execution to complete

4. **Verify installation**
   ```sql
   -- Check if functions were created
   SELECT routine_name, routine_type
   FROM information_schema.routines 
   WHERE routine_schema = 'public'
   AND routine_name LIKE '%admin%'
   ORDER BY routine_name;
   ```

   You should see these functions:
   - `deactivate_group_admin` (FUNCTION)
   - `get_admin_analytics` (FUNCTION)
   - `get_all_groups_admin` (FUNCTION)
   - `get_all_users_admin` (FUNCTION)
   - `get_audit_logs_admin` (FUNCTION)
   - `get_user_details_admin` (FUNCTION)
   - `log_admin_action` (FUNCTION)
   - `prevent_admin_group_membership` (FUNCTION)
   - `prevent_admin_payouts` (FUNCTION)
   - `suspend_user_admin` (FUNCTION)

5. **Verify triggers**
   ```sql
   -- Check if triggers were created
   SELECT trigger_name, event_object_table
   FROM information_schema.triggers
   WHERE trigger_name IN ('prevent_admin_membership', 'prevent_admin_payout')
   ORDER BY trigger_name;
   ```

   You should see:
   - `prevent_admin_membership` on `group_members`
   - `prevent_admin_payout` on `payouts`

### Step 3: Verify Existing Schema

The migration assumes the following columns already exist in the `users` table:
- `is_admin` (BOOLEAN)

Check if they exist:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users'
AND column_name IN ('is_admin');
```

**If the column is missing:**

```sql
-- Add is_admin column if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- Create index
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);

-- Add comment
COMMENT ON COLUMN users.is_admin IS 'System administrator flag - allows platform-wide access';
```

### Step 4: Deploy Frontend Changes

1. **Pull the latest code**
   ```bash
   git pull origin main
   ```

2. **Install dependencies** (if needed)
   ```bash
   npm install
   ```

3. **Build the application**
   ```bash
   npm run build
   ```

4. **Deploy** (method depends on your hosting)
   - Vercel: `vercel --prod`
   - Netlify: `netlify deploy --prod`
   - Other: Follow your deployment process

### Step 5: Create First Admin User

1. **Find a user to promote**
   ```sql
   -- List recent users
   SELECT id, email, full_name, created_at
   FROM users
   ORDER BY created_at DESC
   LIMIT 10;
   ```

2. **Promote to admin**
   ```sql
   -- Replace with the actual email
   UPDATE users
   SET is_admin = TRUE, updated_at = NOW()
   WHERE email = 'your-admin@example.com';
   ```

3. **Verify promotion**
   ```sql
   SELECT id, email, full_name, is_admin
   FROM users
   WHERE email = 'your-admin@example.com';
   ```

### Step 6: Test Admin Access

1. **Log out** if currently logged in
2. **Log in** with the promoted admin account
3. **Check the user menu** (top right corner)
   - You should see "Admin Dashboard" option
4. **Navigate to `/admin`**
   - Should see the System Admin Dashboard
5. **Test each tab**:
   - Overview: Should show platform statistics
   - Users: Should list all users
   - Groups: Should list all groups
   - Audit Logs: Should show admin actions

### Step 7: Test Restrictions

Verify that admins cannot join groups or receive payouts:

```sql
-- Try to add admin as group member (should fail)
-- Replace <admin-id> and <group-id> with actual IDs
INSERT INTO group_members (group_id, user_id, position, is_creator)
VALUES ('<group-id>', '<admin-id>', 1, false);
-- Expected error: "System administrators cannot join groups as members"

-- Try to create payout to admin (should fail)
INSERT INTO payouts (related_group_id, recipient_id, cycle_number, amount)
VALUES ('<group-id>', '<admin-id>', 1, 1000);
-- Expected error: "System administrators cannot receive payouts"
```

## Rollback Procedure

If you need to rollback the migration:

### Remove Admin Functions

```sql
-- Drop triggers
DROP TRIGGER IF EXISTS prevent_admin_membership ON group_members;
DROP TRIGGER IF EXISTS prevent_admin_payout ON payouts;

-- Drop functions
DROP FUNCTION IF EXISTS prevent_admin_group_membership();
DROP FUNCTION IF EXISTS prevent_admin_payouts();
DROP FUNCTION IF EXISTS log_admin_action(VARCHAR, VARCHAR, UUID, JSONB);
DROP FUNCTION IF EXISTS get_all_users_admin(INTEGER, INTEGER, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS get_all_groups_admin(INTEGER, INTEGER, VARCHAR, TEXT);
DROP FUNCTION IF EXISTS suspend_user_admin(UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS deactivate_group_admin(UUID, VARCHAR, TEXT);
DROP FUNCTION IF EXISTS get_admin_analytics();
DROP FUNCTION IF EXISTS get_audit_logs_admin(INTEGER, INTEGER, UUID, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS get_user_details_admin(UUID);

-- Revoke all admin privileges
UPDATE users SET is_admin = FALSE WHERE is_admin = TRUE;
```

### Redeploy Previous Frontend

```bash
# Checkout previous version
git checkout <previous-commit-hash>

# Rebuild and redeploy
npm run build
# Deploy using your deployment method
```

## Post-Migration Checklist

- [ ] Admin functions installed successfully
- [ ] Triggers created successfully
- [ ] At least one admin user created
- [ ] Admin can access `/admin` route
- [ ] Overview tab shows analytics
- [ ] Users tab lists all users
- [ ] Groups tab lists all groups
- [ ] Audit logs tab shows admin actions
- [ ] Admin cannot join groups (tested)
- [ ] Admin cannot receive payouts (tested)
- [ ] Suspension feature works
- [ ] Group status change works
- [ ] All admin actions are logged

## Troubleshooting

### Error: "function get_all_users_admin does not exist"

**Solution:**
- Re-run the admin_functions.sql migration
- Check that it was executed in the `public` schema
- Verify with: `SELECT routine_name FROM information_schema.routines WHERE routine_name = 'get_all_users_admin';`

### Error: "permission denied for function get_all_users_admin"

**Solution:**
```sql
-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_all_users_admin TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_groups_admin TO authenticated;
GRANT EXECUTE ON FUNCTION suspend_user_admin TO authenticated;
GRANT EXECUTE ON FUNCTION deactivate_group_admin TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_analytics TO authenticated;
GRANT EXECUTE ON FUNCTION get_audit_logs_admin TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_details_admin TO authenticated;
```

### Admin menu item not showing

**Solution:**
1. Clear browser cache
2. Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
3. Log out and log back in
4. Verify is_admin is TRUE in database

### "Access denied" when accessing /admin

**Solution:**
1. Verify user is actually an admin:
   ```sql
   SELECT is_admin FROM users WHERE id = auth.uid();
   ```
2. If FALSE, update:
   ```sql
   UPDATE users SET is_admin = TRUE WHERE id = '<user-id>';
   ```
3. Log out and log back in

## Support

If you encounter issues:

1. Check the [ADMIN_SETUP.md](./ADMIN_SETUP.md) for detailed usage instructions
2. Review the [Troubleshooting](#troubleshooting) section above
3. Check Supabase logs in Dashboard > Logs
4. Review browser console for frontend errors
5. Contact your technical team

---

**Migration Version:** 1.0  
**Last Updated:** January 2026  
**Compatible with:** SmartAjo v1.0+
