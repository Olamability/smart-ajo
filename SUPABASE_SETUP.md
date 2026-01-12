# Supabase Database Setup Guide

This guide walks you through setting up the Secured-Ajo database on Supabase.

## Prerequisites

1. A Supabase account (sign up at https://supabase.com)
2. A Supabase project created

## Setup Instructions

### Step 1: Run SQL Files in Order

The SQL files must be executed in a specific order to avoid dependency issues. Run them in the Supabase SQL Editor:

1. **Navigate to SQL Editor**
   - Go to your Supabase project dashboard
   - Click on "SQL Editor" in the left sidebar

2. **Execute schema.sql (REQUIRED - Run First)**
   - Create a new query in the SQL Editor
   - Copy the entire contents of `supabase/schema.sql`
   - Paste into the SQL Editor
   - Click "Run" to execute
   - This creates all tables, indexes, triggers, and RLS policies

3. **Execute functions.sql (REQUIRED - Run Second)**
   - Create a new query in the SQL Editor
   - Copy the entire contents of `supabase/functions.sql`
   - Paste into the SQL Editor
   - Click "Run" to execute
   - This creates utility functions like `create_user_profile_atomic`
   - **IMPORTANT**: This must run AFTER schema.sql

4. **Execute views.sql (Optional)**
   - Copy contents of `supabase/views.sql`
   - Run in SQL Editor
   - Creates database views for reporting

5. **Execute triggers.sql (Optional)**
   - Copy contents of `supabase/triggers.sql`
   - Run in SQL Editor
   - Creates additional triggers

6. **Execute storage.sql (Optional)**
   - Copy contents of `supabase/storage.sql`
   - Run in SQL Editor
   - Sets up storage buckets and policies

7. **Execute realtime.sql (Optional)**
   - Copy contents of `supabase/realtime.sql`
   - Run in SQL Editor
   - Enables realtime subscriptions

8. **Execute scheduled-jobs.sql (Optional)**
   - Copy contents of `supabase/scheduled-jobs.sql`
   - Run in SQL Editor
   - Sets up scheduled jobs (requires pg_cron extension)

### Step 2: Verify Setup

After running the SQL files, verify the setup:

```sql
-- Check that all tables were created
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Should show: audit_logs, contributions, email_verification_tokens, 
--             group_members, groups, notifications, payouts, penalties, 
--             transactions, users

-- Check that functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_type = 'FUNCTION'
ORDER BY routine_name;

-- Should include: create_user_profile_atomic, create_user_profile, 
--                 calculate_next_payout_recipient, is_cycle_complete, etc.
```

### Step 3: Configure Environment Variables

Update your `.env.development` or `.env.local` file with your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Get these values from:
- Supabase Dashboard → Settings → API

### Step 4: Test the Application

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Try registering a new account
4. Try logging in
5. Navigate to the Groups page to verify no recursion errors

## Key Fixes Applied

### 1. Fixed Infinite Recursion in RLS Policies

The original `group_members_select_own_groups` policy had infinite recursion:

```sql
-- OLD (BROKEN - causes infinite recursion)
CREATE POLICY group_members_select_own_groups ON group_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm 
      WHERE gm.group_id = group_members.group_id 
        AND gm.user_id = auth.uid()
    )
  );
```

This was fixed to avoid recursion by ensuring we never check the same row:

```sql
-- NEW (FIXED - no recursion)
CREATE POLICY group_members_select_own_groups ON group_members
  FOR SELECT
  USING (
    -- User can always see their own membership
    auth.uid() = user_id
    OR
    -- User can see members of groups where they are also a member
    -- This works because we check for a DIFFERENT row
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_members.group_id
        AND gm.user_id = auth.uid()
        AND gm.id != group_members.id  -- Critical: prevents checking the same row
    )
  );
```

The key insight is that we can safely query `group_members` as long as we explicitly exclude the current row being evaluated (`gm.id != group_members.id`). This breaks the infinite recursion because:
1. When checking if a user can see row X, we look for a DIFFERENT row Y where the user is a member
2. Row Y will match the first condition (`auth.uid() = user_id`) without needing the subquery
3. No infinite loop occurs

### 2. Registration Flow

The registration process uses the `create_user_profile_atomic` function from `functions.sql` which ensures:
- Atomic profile creation (no race conditions)
- Proper error handling
- Duplicate key handling (ON CONFLICT)

## Troubleshooting

### Issue: "infinite recursion detected in policy for relation 'group_members'"

**Solution**: Re-run the `schema.sql` file to update the RLS policies with the fixed version.

### Issue: "Could not find the function create_user_profile_atomic"

**Solution**: Make sure you ran `functions.sql` AFTER `schema.sql`.

### Issue: Registration fails silently

**Possible causes**:
1. `functions.sql` not executed
2. RLS policies blocking inserts
3. Email confirmation required (check Supabase Auth settings)

**Solutions**:
1. Verify both `schema.sql` and `functions.sql` have been run
2. Check browser console for detailed error messages
3. Check Supabase Dashboard → Authentication → Settings → Email Auth

### Issue: Can't see groups after creating them

**Possible causes**:
1. RLS policies are too restrictive
2. Profile not created properly during registration

**Solutions**:
1. Re-run `schema.sql` to update RLS policies
2. Check that user profile exists: `SELECT * FROM users WHERE id = '<your-user-id>'`

## Security Notes

- **Never expose** `SUPABASE_SERVICE_ROLE_KEY` to the client
- Only use `VITE_SUPABASE_ANON_KEY` in the frontend
- RLS policies protect data based on authentication
- Service role bypasses RLS - use only on the server side

## Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
