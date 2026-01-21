# Supabase Database Setup

This directory contains SQL files for setting up the Secured-Ajo database on Supabase.

## Directory Structure

- **SQL Files**: Database schema, functions, and migrations
- **functions/**: Edge Functions for serverless backend logic
  - `health-check/`: Application health monitoring endpoint
  - `verify-payment/`: Payment verification with Paystack
  - `paystack-webhook/`: Webhook handler for Paystack events
  - `send-email/`: Email notification service
  - `verify-bvn/`: BVN verification service

## Quick Start

### 1. Run SQL Files in Order

**IMPORTANT:** Files must be run in this specific order!

```
1. schema.sql                    (REQUIRED - creates tables, triggers, RLS policies)
2. functions.sql                 (REQUIRED - creates utility functions)
3. admin_functions.sql           (REQUIRED - creates system admin functions) ⭐ NEW
4. verify-setup.sql              (RECOMMENDED - verifies setup is correct)
5. verify_admin_installation.sql (RECOMMENDED - verifies admin setup) ⭐ NEW
6. views.sql                     (Optional - creates database views)
7. triggers.sql                  (Optional - additional triggers)
8. storage.sql                   (Optional - storage buckets)
9. realtime.sql                  (Optional - realtime subscriptions)
10. scheduled-jobs.sql           (Optional - scheduled jobs)
```

### 2. How to Run

1. Go to **Supabase Dashboard → SQL Editor**
2. Create a new query
3. Copy the **entire contents** of `schema.sql`
4. Paste and click **Run**
5. Wait for completion (should take a few seconds)
6. Repeat for `functions.sql`
7. **NEW:** Repeat for `admin_functions.sql` (System Admin features)
8. Run `verify-setup.sql` to confirm everything is set up correctly
9. **NEW:** Run `verify_admin_installation.sql` to verify admin features

### 3. Verify Setup

After running `schema.sql` and `functions.sql`, run `verify-setup.sql`:

```sql
-- Copy and run the entire verify-setup.sql file
-- Look for PASS ✓ on all checks
-- If you see FAIL ✗, review the error and check setup
```

**NEW: Verify Admin Setup**

After running `admin_functions.sql`, run `verify_admin_installation.sql`:

```sql
-- Copy and run the entire verify_admin_installation.sql file
-- Check that all admin functions are installed
-- Verify triggers are created
-- Confirm permissions are granted
```

## File Descriptions

### Required Files

- **schema.sql** - Core database schema
  - Creates all tables (users, groups, contributions, etc.)
  - Sets up Row Level Security (RLS) policies
  - Creates indexes for performance
  - Defines triggers for automation
  - Includes `is_admin` field in users table

- **functions.sql** - Utility and business logic functions
  - User profile creation
  - Contribution calculations
  - Payout calculations
  - Group progress tracking
  - Admin check functions

- **admin_functions.sql** ⭐ NEW - System Admin functions
  - Platform-wide user management
  - Platform-wide group management
  - User suspension/activation
  - Group status management
  - Analytics and reporting
  - Audit logging
  - Admin restrictions (cannot join groups/receive payouts)

### Verification Files

- **verify-setup.sql** - Verifies core database setup
  - Checks all tables exist
  - Verifies RLS policies
  - Tests functions work
  - Validates indexes

- **verify_admin_installation.sql** ⭐ NEW - Verifies admin setup
  - Checks admin functions exist
  - Verifies triggers are created
  - Tests admin permissions
  - Validates admin restrictions
  - Provides summary report
  - **MUST BE RUN FIRST**

- **functions.sql** - Business logic functions
  - `create_user_profile_atomic` - For user registration
  - `calculate_next_payout_recipient` - Payout calculations
  - `process_cycle_completion` - Cycle management
  - And many more utility functions
  - **MUST BE RUN AFTER schema.sql**

### Verification File

- **verify-setup.sql** - Automated setup verification
  - Checks all tables exist
  - Verifies RLS is enabled
  - Confirms policies are correct
  - Tests for the group_members recursion fix
  - Validates functions exist
  - Provides pass/fail status

### Optional Files

- **views.sql** - Database views for reporting
- **triggers.sql** - Additional triggers
- **storage.sql** - Storage bucket configuration
- **realtime.sql** - Realtime subscription setup
- **scheduled-jobs.sql** - Background job scheduling

## Common Issues

### "infinite recursion detected in policy for relation 'group_members'"

**Solution:** Re-run `schema.sql` to get the fixed RLS policy.

### "Could not find the function create_user_profile_atomic"

**Solution:** Make sure you ran `functions.sql` AFTER `schema.sql`.

### "No rows returned" when querying tables

**Solution:** Check that RLS policies are set up correctly. Run `verify-setup.sql` to diagnose.

## What Changed?

### Fixed in This PR

The `group_members_select_own_groups` RLS policy was causing infinite recursion. It has been fixed by adding a condition that prevents checking the same row recursively:

```sql
-- The fix
AND gm.id != group_members.id  -- Critical: prevents same-row check
```

This allows users to see:
1. Their own membership (direct check, no recursion)
2. Other members in groups they belong to (checks different rows)

## Need Help?

See these files for more information:
- **FIX_SUMMARY.md** (in repository root) - User-friendly overview
- **SUPABASE_SETUP.md** (in repository root) - Detailed technical guide
- **verify-setup.sql** (this directory) - Automated verification

## Edge Functions

The repository includes several Edge Functions for backend operations:

### health-check
- **Purpose**: System health monitoring endpoint
- **Method**: GET
- **Authentication**: None (public endpoint)
- **Response**: JSON with system status and component health
- **Usage**: Monitoring, load balancer health checks

Example:
```bash
curl https://YOUR_PROJECT.supabase.co/functions/v1/health-check
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-21T14:00:00.000Z",
  "version": "1.0.0",
  "components": {
    "database": { "status": "operational", "responseTime": 45 },
    "auth": { "status": "operational", "responseTime": 120 },
    "edgeFunctions": { "status": "operational" }
  }
}
```

### Other Edge Functions
- **verify-payment**: Verifies Paystack payment transactions
- **paystack-webhook**: Handles Paystack webhook events
- **send-email**: Sends transactional emails
- **verify-bvn**: Verifies Bank Verification Numbers

For deployment instructions, see `../check-edge-functions.sh` and `../deploy-edge-functions.sh`.

## Testing

After setup, test:
1. ✅ Register a new account
2. ✅ Login with existing account
3. ✅ Navigate to Groups page (should load without errors)
4. ✅ Create a new group
5. ✅ View group members
