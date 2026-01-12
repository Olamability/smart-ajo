# Quick Admin Account Creation Guide

This guide provides a simple, step-by-step process to create an admin account for SmartAjo platform.

## Prerequisites

1. A user must first register a regular account on the platform
2. You need access to Supabase Dashboard (SQL Editor)
3. You need the email address of the user to promote

## Step-by-Step Process

### Step 1: Register a Regular User Account

1. Go to your SmartAjo application URL
2. Click **Sign Up** 
3. Fill in the registration form:
   - Full Name
   - Email Address (this will be your admin email)
   - Phone Number
   - Password
4. Complete the email verification if required
5. Log out after registration

### Step 2: Promote User to Admin

1. **Open Supabase Dashboard**
   - Go to https://app.supabase.com
   - Select your SmartAjo project
   - Click **SQL Editor** in the left sidebar

2. **Run Admin Promotion Query**
   
   Copy and paste this SQL query, replacing the email with your user's email:
   
   ```sql
   -- Replace 'your-email@example.com' with the actual email
   UPDATE users
   SET is_admin = TRUE, updated_at = NOW()
   WHERE email = 'your-email@example.com';
   ```

3. **Verify the Promotion**
   
   Run this query to confirm:
   
   ```sql
   -- Replace with your email
   SELECT id, email, full_name, is_admin 
   FROM users 
   WHERE email = 'your-email@example.com';
   ```
   
   You should see `is_admin` as `true`

### Step 3: Access Admin Dashboard

1. **Log in to SmartAjo** with the promoted account
2. **Look for Admin Menu**:
   - Click your profile icon in the top right corner
   - You should see **"Admin Dashboard"** option
3. **Navigate to Admin Dashboard**:
   - Click "Admin Dashboard" OR
   - Navigate directly to `/admin` route

## Example: Creating First Admin

```sql
-- Example: Promote john@company.com to admin
UPDATE users
SET is_admin = TRUE, updated_at = NOW()
WHERE email = 'john@company.com';

-- Verify
SELECT email, full_name, is_admin, created_at
FROM users 
WHERE email = 'john@company.com';
```

## Admin Dashboard Features

Once logged in as admin, you can:

✅ **View All Users** - See complete user list with statistics
✅ **View All Groups** - Monitor all groups on the platform
✅ **Suspend/Activate Users** - Manage user accounts
✅ **Pause/Activate Groups** - Manage group status
✅ **View Analytics** - Platform-wide statistics
✅ **View Audit Logs** - Track all admin actions

## Admin Restrictions

For security and integrity, admins **CANNOT**:

❌ Join groups as members
❌ Make contributions to groups
❌ Receive payouts from groups

This ensures admins are platform managers, not participants.

## Managing Multiple Admins

### To promote another user to admin:
```sql
UPDATE users
SET is_admin = TRUE, updated_at = NOW()
WHERE email = 'second-admin@example.com';
```

### To revoke admin privileges:
```sql
UPDATE users
SET is_admin = FALSE, updated_at = NOW()
WHERE email = 'former-admin@example.com';
```

### To see all current admins:
```sql
SELECT email, full_name, created_at, last_login_at
FROM users
WHERE is_admin = TRUE
ORDER BY created_at;
```

## Troubleshooting

### Problem: Can't see Admin Dashboard option after promotion

**Solution:**
1. Log out completely from the application
2. Clear browser cache and cookies
3. Log back in with the admin account
4. Check that SQL query was executed successfully

### Problem: "Access Denied" when accessing /admin

**Solution:**
1. Verify admin status in database:
   ```sql
   SELECT is_admin FROM users WHERE email = 'your-email@example.com';
   ```
2. If `is_admin` is `false`, run the UPDATE query again
3. Log out and log back in

### Problem: Admin functions not working

**Solution:**
Check if admin functions are installed:
```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name LIKE '%admin%'
AND routine_schema = 'public';
```

If no functions are returned, run the admin migration:
- Open `supabase/admin_functions.sql`
- Copy entire content
- Paste in SQL Editor
- Execute

## Security Best Practices

1. **Limit Admin Accounts** - Only create admins when necessary
2. **Use Strong Passwords** - Minimum 12 characters with mixed case
3. **Regular Reviews** - Review admin accounts quarterly
4. **Monitor Activity** - Check audit logs regularly
5. **Separate Accounts** - Consider using separate emails for admin roles

## Quick Reference Commands

```sql
-- Create admin
UPDATE users SET is_admin = TRUE WHERE email = 'admin@example.com';

-- Remove admin
UPDATE users SET is_admin = FALSE WHERE email = 'user@example.com';

-- List all admins
SELECT email, full_name FROM users WHERE is_admin = TRUE;

-- Check specific user
SELECT email, is_admin FROM users WHERE email = 'check@example.com';
```

## Need More Help?

For detailed information, see:
- [ADMIN_SETUP.md](./ADMIN_SETUP.md) - Comprehensive admin guide
- [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) - Database setup
- [FEATURES_DOCUMENTATION.md](./FEATURES_DOCUMENTATION.md) - Feature details

---

**Quick Start Summary:**
1. Register user → 2. Run SQL to promote → 3. Log in → 4. Access /admin

That's it! 🎉
