# System Admin Setup and Management Guide

This guide explains how to set up and use the System Administrator role in SmartAjo - a platform-wide admin role with elevated privileges to oversee the entire platform.

## Table of Contents

1. [System Admin vs Group Admin](#system-admin-vs-group-admin)
2. [System Admin Setup](#system-admin-setup)
3. [System Admin Features](#system-admin-features)
4. [Accessing the System Admin Dashboard](#accessing-the-system-admin-dashboard)
5. [System Admin Capabilities](#system-admin-capabilities)
6. [Security & Restrictions](#security--restrictions)
7. [Managing Admin Users](#managing-admin-users)
8. [Audit Logging](#audit-logging)
9. [Security Best Practices](#security-best-practices)

---

## System Admin vs Group Admin

### System Admin (Platform Admin)
- **Scope**: Platform-wide access
- **Access**: Can view ALL users and groups
- **Actions**: Can suspend users, freeze groups, view analytics
- **Restrictions**: CANNOT join groups, contribute, or receive payouts
- **Dashboard**: `/admin` route with full platform oversight

### Group Admin (Group Creator)
- **Scope**: Limited to groups they created or manage
- **Access**: Can only manage their own groups
- **Actions**: Can manage members, contributions, penalties within their groups
- **Restrictions**: Normal user participation in groups they created
- **Dashboard**: `/groups/:groupId/admin` route for specific group

---

## System Admin Setup

### Prerequisites

- Direct database access via Supabase Dashboard or CLI
- A registered user account in the system
- SQL Editor access in Supabase

### Step 1: Apply Admin Functions Migration

First, apply the admin functions to your Supabase database:

1. **Navigate to Supabase SQL Editor**
   - Go to your Supabase project dashboard
   - Click "SQL Editor" in the left sidebar

2. **Run the admin functions migration**
   ```sql
   -- Copy and paste the entire content of:
   -- supabase/admin_functions.sql
   -- Then execute the query
   ```

   This will create:
   - All system admin RPC functions
   - Audit logging helper functions
   - Triggers to prevent admins from joining groups or receiving payouts

3. **Verify installation**
   ```sql
   -- Check if functions were created
   SELECT routine_name 
   FROM information_schema.routines 
   WHERE routine_name LIKE '%admin%'
   AND routine_schema = 'public';
   ```

   You should see functions like:
   - `get_all_users_admin`
   - `get_all_groups_admin`
   - `suspend_user_admin`
   - `deactivate_group_admin`
   - `get_admin_analytics`
   - `get_audit_logs_admin`
   - `log_admin_action`

### Step 2: Promote User to System Admin

Use one of these methods to promote a user:

#### Method 1: Direct SQL Update (Recommended)

```sql
-- Promote user to system admin by email
UPDATE users
SET is_admin = TRUE, updated_at = NOW()
WHERE email = 'admin@example.com';

-- Verify the promotion
SELECT id, email, full_name, is_admin 
FROM users 
WHERE email = 'admin@example.com';
```

#### Method 2: Using Supabase Table Editor

1. Navigate to **Table Editor** in Supabase Dashboard
2. Select the **users** table
3. Find the user you want to promote
4. Click on the user row to edit
5. Change the `is_admin` field from `false` to `true`
6. Click **Save**

### Step 3: Verify Admin Access

1. Log out if currently logged in
2. Log in with the promoted admin account
3. Look for "Admin Dashboard" in the user menu (top right)
4. Click to navigate to `/admin` route
5. You should see the System Admin Dashboard with overview, users, groups, and audit logs

---

## System Admin Features

The System Admin Dashboard (`/admin`) provides four main tabs:

### 1. Overview Tab

**Analytics Dashboard** showing platform-wide statistics:

- **User Statistics**
  - Total users
  - Active users
  - Verified users
  - KYC completion rate

- **Group Statistics**
  - Total groups
  - Active groups
  - Forming groups
  - Completed groups

- **Financial Statistics**
  - Total amount collected
  - Number of contributions (paid/overdue)
  - Number of payouts
  - Total penalties

### 2. Users Tab

**User Management** interface:

- **View all platform users** with:
  - Name, email, phone
  - Status (active/suspended)
  - KYC status
  - Number of groups joined
  - Join date

- **Search & Filter**
  - Search by name, email, or phone
  - Filter by active/suspended status

- **Actions**
  - Suspend user accounts (except other admins)
  - Activate suspended accounts
  - All actions are logged

### 3. Groups Tab

**Group Management** interface:

- **View all platform groups** with:
  - Group name and description
  - Creator information
  - Member count (current/total)
  - Contribution amount and frequency
  - Status (forming/active/paused/completed/cancelled)
  - Current cycle / total cycles
  - Total amount collected

- **Search & Filter**
  - Search by group name
  - Filter by status

- **Actions**
  - Pause active groups
  - Activate paused groups
  - All actions are logged

### 4. Audit Logs Tab

**Audit Trail** of all administrative actions:

- View complete history of admin actions
- See who performed each action
- View action details and timestamps
- Track changes to users and groups
- Monitor system integrity

---

## Accessing the System Admin Dashboard

### For System Admins

1. **Log in** to your admin account
2. Click your **profile menu** in the top right corner
3. Look for **"Admin Dashboard"** menu item (only visible to admins)
4. Click to navigate to `/admin`

### Direct URL

You can also navigate directly to:
```
https://your-app-url.com/admin
```

**Note:** The page will redirect non-admin users to the regular dashboard.

---

## System Admin Capabilities

### What System Admins CAN Do

✅ **View all users**
- See complete user list with statistics
- Search and filter users
- View user details and activity

✅ **View all groups**
- See all groups regardless of membership
- View group metadata and statistics
- Monitor group progress and health

✅ **Suspend or activate users**
- Suspend user accounts for policy violations
- Activate previously suspended accounts
- Cannot suspend other admin accounts

✅ **Freeze or activate groups**
- Pause groups (change status to 'paused')
- Activate paused groups
- Change group status as needed

✅ **View platform analytics**
- Monitor platform-wide statistics
- Track user growth and engagement
- Monitor financial metrics

✅ **View audit logs**
- See complete history of admin actions
- Track who did what and when
- Ensure accountability

✅ **Read-only access to disputes**
- View disputes (if dispute table exists)
- Monitor resolution status

### What System Admins CANNOT Do

❌ **Join groups as members**
- System admins cannot become group members
- Enforced by database trigger

❌ **Contribute to groups**
- Admins cannot make contributions
- Prevented by group membership restriction

❌ **Receive payouts**
- Admins cannot receive group payouts
- Enforced by database trigger

❌ **Modify contribution schedules directly**
- Cannot change group contribution cycles
- Cannot manually adjust payout schedules

❌ **Delete groups or users**
- Groups can only be cancelled, not deleted
- User accounts are permanent (can only be suspended)

❌ **Modify transactions**
- Transaction records are immutable
- Cannot edit or delete transaction history

---

## Security & Restrictions

### Separation of Duties

System admins are **observers and managers**, not participants:

1. **Cannot Join Groups**
   ```sql
   -- Trigger prevents admin group membership
   CREATE TRIGGER prevent_admin_membership
     BEFORE INSERT OR UPDATE ON group_members
     FOR EACH ROW
     EXECUTE FUNCTION prevent_admin_group_membership();
   ```

2. **Cannot Receive Payouts**
   ```sql
   -- Trigger prevents admin payouts
   CREATE TRIGGER prevent_admin_payout
     BEFORE INSERT OR UPDATE ON payouts
     FOR EACH ROW
     EXECUTE FUNCTION prevent_admin_payouts();
   ```

3. **All Actions Logged**
   - Every admin action is automatically logged to `audit_logs` table
   - Includes: user_id, action, resource, details, timestamp
   - Cannot be disabled or bypassed

### Access Control

- **RLS Policies**: All RPC functions check `is_current_user_admin()` before executing
- **Security Definer**: Functions use `SECURITY DEFINER` for elevated permissions
- **Frontend Protection**: Routes check admin status before rendering
- **API Protection**: All database calls go through RPC functions with built-in checks

---

## Managing Admin Users

### Viewing All Admins

To see all system administrators:

```sql
SELECT id, email, full_name, is_admin, created_at
FROM users
WHERE is_admin = TRUE
ORDER BY created_at;
```

### Promoting a User to Admin

```sql
-- Promote user to system admin
UPDATE users
SET is_admin = TRUE, updated_at = NOW()
WHERE email = 'newadmin@example.com';
```

### Revoking Admin Privileges

```sql
-- Revoke admin privileges
UPDATE users
SET is_admin = FALSE, updated_at = NOW()
WHERE email = 'formeradmin@example.com';
```

**Note:** User must log out and log back in for changes to take effect.

### Checking Admin Status

```sql
-- Check if specific user is admin
SELECT email, full_name, is_admin
FROM users
WHERE email = 'user@example.com';
```

---

## Audit Logging

All system admin actions are automatically logged. View logs using:

### Via Admin Dashboard

1. Navigate to `/admin`
2. Click the **"Audit Logs"** tab
3. View complete history with filters

### Via SQL

```sql
-- View recent admin actions
SELECT 
  al.created_at,
  u.email as admin_email,
  u.full_name as admin_name,
  al.action,
  al.resource_type,
  al.details
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
WHERE u.is_admin = TRUE
ORDER BY al.created_at DESC
LIMIT 50;
```

### Via RPC Function

```sql
-- Get audit logs with pagination
SELECT * FROM get_audit_logs_admin(
  p_limit := 100,
  p_offset := 0,
  p_user_id := NULL,  -- Filter by specific user
  p_action := NULL,   -- Filter by action type
  p_resource_type := NULL  -- Filter by resource
);
```

### Logged Actions

The following admin actions are logged:
- `view_all_users` - When admin views user list
- `view_all_groups` - When admin views group list
- `view_analytics` - When admin views analytics
- `view_user_details` - When admin views specific user
- `suspend_user` - When admin suspends a user
- `activate_user` - When admin activates a user
- `change_group_status` - When admin changes group status

---

### Prerequisites

- You need direct database access via Supabase Dashboard
- You need a user account that has already registered in the system
- You should have the SQL Editor open in Supabase

### Method 1: Using the SQL Function (Recommended)

The easiest way to create an admin is using the built-in `promote_user_to_admin` function:

1. **Navigate to Supabase SQL Editor**
   - Go to your Supabase project dashboard
   - Click "SQL Editor" in the left sidebar

2. **Run the promotion function**
   ```sql
   -- Replace with the actual user's email
   SELECT promote_user_to_admin('user@example.com');
   ```

3. **Verify the promotion**
   ```sql
   SELECT id, email, full_name, is_admin 
   FROM users 
   WHERE email = 'user@example.com';
   ```

   The `is_admin` column should now be `true`.

### Method 2: Direct SQL Update

If you prefer to update the database directly:

```sql
-- Update user to admin by email
UPDATE users
SET is_admin = TRUE, updated_at = NOW()
WHERE email = 'user@example.com';
```

---

## Security Best Practices

### 1. Limit Admin Accounts

- **Only create admin accounts when absolutely necessary**
- Keep the number of admins to a minimum (ideally 1-3 people)
- Each admin should have a legitimate business need for platform-wide access
- Regular users should never need admin access

### 2. Use Strong Credentials

- Admin accounts must use **strong, unique passwords**
- Minimum 12 characters with mixed case, numbers, and symbols
- Enable **two-factor authentication (2FA)** if available
- Never share admin credentials
- Use a password manager

### 3. Regular Access Reviews

- **Review admin accounts quarterly**
- Revoke admin access from users who no longer need it
- Deactivate admin accounts for employees who leave
- Document the reason for each admin account

### 4. Monitor Admin Activity

Regularly review admin actions via audit logs:

```sql
-- View recent admin activities
SELECT 
  al.created_at,
  u.email as admin_email,
  al.action,
  al.resource_type,
  al.details
FROM audit_logs al
JOIN users u ON al.user_id = u.id
WHERE u.is_admin = TRUE
ORDER BY al.created_at DESC
LIMIT 50;
```

### 5. Separate Admin and Regular Accounts

- Consider using separate email addresses for admin accounts
- Example: `admin-john@company.com` vs `john@company.com`
- Makes it clear when someone is acting in an admin capacity
- Easier to track and audit

### 6. Document Admin Changes

Keep a record of:
- When admin privileges were granted
- Who authorized the promotion
- Why the account needs admin access
- When privileges were revoked
- Any policy violations or security incidents

### 7. Principle of Least Privilege

- Not every staff member needs admin access
- Group creators have sufficient privileges to manage their own groups
- Only grant admin access for platform-wide management needs
- Consider creating more granular roles if needed in the future

### 8. Emergency Procedures

**If an admin account is compromised:**

1. Immediately revoke admin privileges:
   ```sql
   UPDATE users SET is_admin = FALSE WHERE email = 'compromised@example.com';
   ```

2. Review recent audit logs for suspicious activity:
   ```sql
   SELECT * FROM audit_logs 
   WHERE user_id = (SELECT id FROM users WHERE email = 'compromised@example.com')
   AND created_at > NOW() - INTERVAL '7 days'
   ORDER BY created_at DESC;
   ```

3. Reset the user's password via Supabase Auth
4. Notify all other admins
5. Review and document the incident

### 9. Regular Security Audits

Perform monthly security checks:

```sql
-- Check for unusual admin activity
SELECT 
  u.email,
  COUNT(*) as action_count,
  MIN(al.created_at) as first_action,
  MAX(al.created_at) as last_action
FROM audit_logs al
JOIN users u ON al.user_id = u.id
WHERE u.is_admin = TRUE
AND al.created_at > NOW() - INTERVAL '30 days'
GROUP BY u.email
ORDER BY action_count DESC;

-- Verify all admins are still legitimate
SELECT id, email, full_name, created_at, last_login_at
FROM users
WHERE is_admin = TRUE
ORDER BY last_login_at DESC NULLS LAST;
```

---

## Troubleshooting

### Issue: Can't see the Admin Dashboard menu item

**Possible causes:**
1. User is not marked as admin in the database
2. Browser cache needs clearing
3. Need to log out and log back in

**Solution:**
```sql
-- Verify admin status
SELECT is_admin FROM users WHERE email = 'your-email@example.com';

-- If false, promote to admin
UPDATE users SET is_admin = TRUE WHERE email = 'your-email@example.com';
```

Then **log out and log back in**.

### Issue: "Access denied. System admin privileges required."

**Possible causes:**
1. The `is_admin` flag is not set correctly
2. Database connection issue
3. Session not refreshed after promotion

**Solution:**
1. Verify admin status:
   ```sql
   SELECT * FROM users WHERE email = 'your-email@example.com';
   ```

2. Ensure the promotion took effect:
   ```sql
   SELECT is_admin FROM users WHERE email = 'your-email@example.com';
   ```

3. Clear browser cache and cookies
4. Log out completely
5. Log back in

### Issue: Admin functions not found

**Possible causes:**
1. Migration not applied
2. Functions created in wrong schema

**Solution:**
1. Check if functions exist:
   ```sql
   SELECT routine_name 
   FROM information_schema.routines 
   WHERE routine_name LIKE '%admin%'
   AND routine_schema = 'public';
   ```

2. If not found, run the admin functions migration:
   - Copy content of `supabase/admin_functions.sql`
   - Paste into Supabase SQL Editor
   - Execute

### Issue: Trigger errors when testing restrictions

**Error:** "System administrators cannot join groups as members"

**This is expected behavior!** System admins are prevented from joining groups to maintain separation of duties.

**Solution:** Use a regular user account for group participation.

### Issue: Cannot suspend another admin

**Error:** "Cannot suspend another admin account"

**This is expected behavior!** System admins cannot suspend each other.

**Solution:** 
1. Coordinate with other admins
2. Manually revoke admin privileges first via SQL:
   ```sql
   UPDATE users SET is_admin = FALSE WHERE email = 'other-admin@example.com';
   ```
3. Then suspend the now-regular user account

---

## Quick Reference

### Common SQL Queries for Admins

```sql
-- Promote user to admin
UPDATE users SET is_admin = TRUE WHERE email = 'user@example.com';

-- Revoke admin privileges
UPDATE users SET is_admin = FALSE WHERE email = 'user@example.com';

-- List all admins
SELECT email, full_name, last_login_at FROM users WHERE is_admin = TRUE;

-- View admin activity in last 7 days
SELECT 
  u.email,
  al.action,
  al.created_at
FROM audit_logs al
JOIN users u ON al.user_id = u.id
WHERE u.is_admin = TRUE
AND al.created_at > NOW() - INTERVAL '7 days'
ORDER BY al.created_at DESC;

-- Check platform health
SELECT * FROM get_admin_analytics();

-- View recent user signups
SELECT email, full_name, created_at
FROM users
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- Find inactive groups
SELECT id, name, status, current_members, total_members
FROM groups
WHERE status = 'forming'
AND created_at < NOW() - INTERVAL '30 days'
ORDER BY created_at;
```

---

## API Reference (RPC Functions)

### get_all_users_admin

Get paginated list of all users.

```sql
SELECT * FROM get_all_users_admin(
  p_limit := 50,           -- Number of results
  p_offset := 0,           -- Offset for pagination
  p_search := NULL,        -- Search term (name, email, phone)
  p_is_active := NULL      -- Filter: true/false/null
);
```

### get_all_groups_admin

Get paginated list of all groups.

```sql
SELECT * FROM get_all_groups_admin(
  p_limit := 50,           -- Number of results
  p_offset := 0,           -- Offset for pagination
  p_status := NULL,        -- Filter: 'forming'/'active'/'paused'/'completed'/'cancelled'/null
  p_search := NULL         -- Search term (group name)
);
```

### suspend_user_admin

Suspend or activate a user account.

```sql
SELECT * FROM suspend_user_admin(
  p_user_id := '<user-uuid>',
  p_is_active := false,    -- false to suspend, true to activate
  p_reason := 'Policy violation'
);
```

### deactivate_group_admin

Change group status (pause/activate/cancel).

```sql
SELECT * FROM deactivate_group_admin(
  p_group_id := '<group-uuid>',
  p_new_status := 'paused',  -- 'active'/'paused'/'cancelled'
  p_reason := 'Admin intervention'
);
```

### get_admin_analytics

Get platform-wide statistics.

```sql
SELECT * FROM get_admin_analytics();
```

### get_audit_logs_admin

Get audit logs with filters.

```sql
SELECT * FROM get_audit_logs_admin(
  p_limit := 100,
  p_offset := 0,
  p_user_id := NULL,       -- Filter by user
  p_action := NULL,        -- Filter by action
  p_resource_type := NULL  -- Filter by resource
);
```

### get_user_details_admin

Get detailed information about a specific user.

```sql
SELECT * FROM get_user_details_admin(
  p_user_id := '<user-uuid>'
);
```

---

## Support and Contact

For additional help:
- Check [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for database configuration
- Review [FEATURES_DOCUMENTATION.md](./FEATURES_DOCUMENTATION.md) for feature details
- Check [supabase/admin_functions.sql](./supabase/admin_functions.sql) for function implementations
- Contact your technical team for assistance

---

**Last Updated:** January 2026  
**Version:** 2.0 (System Admin Implementation)

