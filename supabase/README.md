# Supabase Database Setup Guide

This directory contains the complete database schema and setup instructions for the Smart Ajo application.

## 📋 Contents

- `schema.sql` - Complete database schema with tables, RLS policies, functions, and triggers

## 🚀 Quick Start

### Step 1: Create a Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com/)
2. Click "New Project"
3. Fill in the project details:
   - **Project Name**: smart-ajo (or your preferred name)
   - **Database Password**: Choose a strong password (save it securely!)
   - **Region**: Choose the closest region to your users
4. Click "Create new project"
5. Wait for the project to be provisioned (usually 2-3 minutes)

### Step 2: Run the Schema

1. In your Supabase project dashboard, go to the **SQL Editor** (left sidebar)
2. Click **"New query"**
3. Open the `schema.sql` file from this directory
4. Copy the **entire contents** of the file
5. Paste it into the SQL Editor
6. Click **"Run"** or press `Ctrl+Enter` (Windows/Linux) or `Cmd+Enter` (Mac)
7. Wait for the execution to complete (should take 10-30 seconds)

### Step 3: Verify the Installation

After running the schema, verify that everything was created successfully:

1. Go to **Table Editor** in the left sidebar
2. You should see the following tables:
   - `users`
   - `wallets`
   - `groups`
   - `group_members`
   - `group_join_requests`
   - `payout_slots`
   - `contributions`
   - `transactions`
   - `payouts`
   - `penalties`
   - `notifications`
   - `audit_logs`

3. Go to **Database** → **Functions** to verify RPC functions were created
4. Go to **Storage** to verify the `avatars` bucket was created

### Step 4: Get Your API Credentials

1. In your Supabase dashboard, go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key (this is safe to use in your frontend)
3. Update your `.env.development` file:
   ```env
   VITE_SUPABASE_URL=your_project_url_here
   VITE_SUPABASE_ANON_KEY=your_anon_key_here
   ```

### Step 5: Test Your Connection

1. Start your development server: `npm run dev`
2. Open the application in your browser
3. Try to sign up for a new account
4. If successful, your database is properly configured!

## 📊 Database Schema Overview

### Core Tables

#### Users & Authentication
- **users** - User accounts with KYC and bank details
- **wallets** - Internal wallet for each user

#### Groups & Membership
- **groups** - Ajo/ROSCA groups
- **group_members** - Members in each group with rotation positions
- **group_join_requests** - Pending requests to join groups
- **payout_slots** - Payout position management

#### Financial Operations
- **contributions** - Expected and actual member contributions
- **transactions** - Complete transaction ledger
- **payouts** - Payout tracking to members
- **penalties** - Penalty tracking for violations

#### System
- **notifications** - User notifications and alerts
- **audit_logs** - System-wide audit trail (admin only)

### Key Features

#### 1. Row Level Security (RLS)
Every table has RLS policies that ensure:
- Users can only access their own data
- Group members can view group-related data
- Admins have elevated privileges
- System operations are protected

#### 2. Automated Triggers
- **Wallet Creation**: Automatically creates a wallet when a user signs up
- **Member Count**: Updates group member count when members join/leave
- **Timestamps**: Automatically updates `updated_at` fields

#### 3. RPC Functions
Business logic functions for:
- User profile management
- Group operations (create, join, approve requests)
- Payout slot management
- Admin operations (analytics, user management)

#### 4. Data Validation
- Check constraints ensure data integrity
- Enums enforce valid status values
- Foreign keys maintain referential integrity
- Indexes optimize query performance

## 🔧 Common Operations

### Create Your First Admin User

After setting up the schema and creating your first user account:

```sql
-- In Supabase SQL Editor, run:
UPDATE users 
SET is_admin = true 
WHERE email = 'your-email@example.com';
```

### Mark Overdue Contributions (Run Daily)

Set up a cron job or manually run:

```sql
SELECT mark_overdue_contributions();
```

### Get System Analytics

```sql
SELECT * FROM get_admin_analytics();
```

### View User Dashboard Summary

```sql
SELECT get_user_dashboard_summary('user-uuid-here');
```

## 🔐 Security Best Practices

### 1. API Keys
- ✅ **DO** use the `anon` key in your frontend
- ❌ **DON'T** use the `service_role` key in frontend code
- 💡 The `service_role` key bypasses RLS - only use it in backend/edge functions

### 2. Row Level Security
- All tables have RLS enabled
- Users can only access data they own or are authorized to see
- RLS policies are automatically enforced by Supabase

### 3. Authentication
- Uses Supabase Auth for secure user authentication
- Passwords are hashed and never stored in plain text
- JWT tokens are used for session management

## 📝 Environment Variables

Required environment variables for your application:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Payment Integration
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_key

# Application Settings
VITE_APP_NAME=Smart Ajo
VITE_APP_URL=http://localhost:3000
```

## 🔄 Schema Updates

If you need to update the schema after initial deployment:

### Option 1: SQL Editor
1. Write your migration SQL
2. Test it in a development project first
3. Run it in your production project

### Option 2: Migrations (Advanced)
1. Install Supabase CLI: `npm install -g supabase`
2. Link to your project: `supabase link --project-ref your-project-ref`
3. Create a migration: `supabase migration new your_migration_name`
4. Write your SQL in the generated migration file
5. Apply it: `supabase db push`

## 🐛 Troubleshooting

### Problem: "relation already exists" error
**Solution**: The table was already created. If you want to recreate everything:
```sql
-- WARNING: This deletes all data!
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
-- Then run schema.sql again
```

### Problem: RLS policies blocking legitimate access
**Solution**: Check the RLS policies in the schema. You can temporarily disable RLS for debugging:
```sql
ALTER TABLE table_name DISABLE ROW LEVEL SECURITY;
-- Don't forget to re-enable it!
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
```

### Problem: Foreign key constraint violations
**Solution**: Ensure you're creating records in the correct order:
1. Users first
2. Groups (references users)
3. Group members (references users and groups)
4. Contributions, transactions, etc.

### Problem: Can't upload avatars
**Solution**: Verify the storage bucket and policies:
```sql
-- Check if bucket exists
SELECT * FROM storage.buckets WHERE id = 'avatars';

-- Check storage policies
SELECT * FROM pg_policies WHERE tablename = 'objects';
```

## 📚 Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase Storage Guide](https://supabase.com/docs/guides/storage)

## 🆘 Getting Help

If you encounter issues:

1. Check the Supabase logs in Dashboard → Logs
2. Review the error messages carefully
3. Check that all environment variables are set correctly
4. Verify RLS policies are not blocking expected access
5. Consult the project's main README.md for application-specific issues

## 📄 License

This schema is part of the Smart Ajo application. See the main project LICENSE for details.
