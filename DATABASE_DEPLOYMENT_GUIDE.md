# Database Schema Deployment Guide

This guide walks you through deploying the complete database schema to your Supabase project.

## 📋 Pre-Deployment Checklist

Before running the schema, ensure you have:

- ✅ A Supabase account ([Sign up here](https://app.supabase.com/))
- ✅ Created a new Supabase project
- ✅ Saved your database password securely
- ✅ Have access to your project's SQL Editor

## 🎯 Deployment Steps

### Step 1: Access SQL Editor

1. Open your Supabase project dashboard
2. Click **"SQL Editor"** in the left sidebar
3. Click **"New query"** to create a new SQL query tab

### Step 2: Load the Schema

**Option A: Copy & Paste (Recommended)**
1. Open `supabase/schema.sql` from this repository
2. Select all content (Ctrl+A / Cmd+A)
3. Copy the content (Ctrl+C / Cmd+C)
4. Paste into the Supabase SQL Editor (Ctrl+V / Cmd+V)

**Option B: Upload File (If supported by your Supabase plan)**
1. Look for an "Upload SQL" or "Import" option in the SQL Editor
2. Select the `schema.sql` file

### Step 3: Execute the Schema

1. Review the SQL in the editor (optional but recommended)
2. Click the **"Run"** button (or press Ctrl+Enter / Cmd+Enter)
3. Wait for execution to complete (typically 10-30 seconds)
4. Check for success messages at the bottom of the editor

### Step 4: Verify Installation

#### Check Tables
Go to **Table Editor** and verify these tables exist:
- [ ] users
- [ ] wallets
- [ ] groups
- [ ] group_members
- [ ] group_join_requests
- [ ] payout_slots
- [ ] contributions
- [ ] transactions
- [ ] payouts
- [ ] penalties
- [ ] notifications
- [ ] audit_logs

#### Check Functions
Go to **Database** → **Functions** and verify these RPC functions exist:
- [ ] create_user_profile_atomic
- [ ] check_user_exists
- [ ] request_to_join_group
- [ ] get_pending_join_requests
- [ ] approve_join_request
- [ ] reject_join_request
- [ ] initialize_group_slots
- [ ] get_available_slots
- [ ] get_admin_analytics
- [ ] get_all_users_admin
- [ ] get_all_groups_admin
- [ ] get_audit_logs_admin
- [ ] suspend_user_admin
- [ ] deactivate_group_admin
- [ ] mark_overdue_contributions
- [ ] get_user_dashboard_summary
- [ ] update_updated_at_column
- [ ] create_wallet_for_new_user
- [ ] update_group_member_count

#### Check Storage
Go to **Storage** and verify:
- [ ] `avatars` bucket exists
- [ ] Bucket is marked as "Public"

#### Check RLS
Go to **Database** → **Tables** → Select any table → **Policies** tab
- [ ] Verify RLS is enabled on all tables
- [ ] Check that policies are present (should see multiple policies per table)

## 🔧 Post-Deployment Configuration

### 1. Get Your API Credentials

1. Go to **Settings** → **API** in your Supabase dashboard
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGc...` (long string)
   
3. **DO NOT** copy the `service_role` key - this should never be used in frontend code!

### 2. Update Environment Variables

Update your `.env.development` file (create from `.env.example` if needed):

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_public_key_here

# Payment Integration
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_paystack_key

# Application Settings
VITE_APP_NAME=Smart Ajo
VITE_APP_URL=http://localhost:3000
```

### 3. Test the Connection

```bash
# Install dependencies (if not already done)
npm install

# Start development server
npm run dev
```

Open `http://localhost:3000` and try to:
1. Sign up for a new account
2. Check if the user profile is created in Supabase
3. Try logging in with the new account

## 🧪 Testing Key Operations

### Test User Registration

1. Sign up with a new email
2. Go to Supabase → **Table Editor** → **users**
3. Verify your user record exists
4. Go to **wallets** table
5. Verify a wallet was automatically created for your user

### Test Group Creation

1. Log in to your application
2. Create a new group
3. Go to Supabase → **groups** table
4. Verify the group was created

### Test Admin Functions

Create your first admin user:

```sql
-- In Supabase SQL Editor
UPDATE users 
SET is_admin = true 
WHERE email = 'your-email@example.com';
```

Then test admin analytics:

```sql
SELECT * FROM get_admin_analytics();
```

## 🚨 Common Issues & Solutions

### Issue: "extension uuid-ossp does not exist"

**Solution**: Extensions are enabled at the beginning of the schema. If you see this error, try running just the extensions section first:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### Issue: "relation already exists"

**Solution**: This means the schema was already partially or fully created. Options:

**Option A: Continue if it's a fresh database**
- The error is harmless if you're re-running on a fresh database
- Tables that exist will be skipped, new ones will be created

**Option B: Start fresh (⚠️ DELETES ALL DATA)**

```sql
-- WARNING: This will delete ALL your data!
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- Now run schema.sql again
```

### Issue: "permission denied for schema public"

**Solution**: This shouldn't happen in a standard Supabase setup, but if it does:

```sql
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
```

### Issue: RLS prevents me from accessing data

**Solution**: Verify you're authenticated and have the right permissions. For debugging, you can temporarily disable RLS:

```sql
-- Temporarily disable RLS on a specific table
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- Don't forget to re-enable it!
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
```

### Issue: Storage bucket not created

**Solution**: Manually create the bucket:

1. Go to **Storage** in Supabase dashboard
2. Click **"New bucket"**
3. Name: `avatars`
4. Public: ✅ Enabled
5. Click **"Create bucket"**

Then run the storage policies from the schema.

## 🔒 Security Checklist

After deployment, verify:

- [ ] RLS is enabled on all tables
- [ ] You're using the `anon` key in frontend, not `service_role`
- [ ] Environment variables are not committed to version control
- [ ] Production uses different credentials than development
- [ ] Admin users are explicitly marked in the database

## 📈 Monitoring & Maintenance

### Daily Tasks (Automated)

Set up a cron job to run:
```sql
SELECT mark_overdue_contributions();
```

You can use:
- Supabase Edge Functions with cron triggers
- External cron services (e.g., GitHub Actions, Vercel Cron)
- Your own server cron jobs

### Weekly Tasks (Manual)

1. Review audit logs for suspicious activity
2. Check database size and performance
3. Review any failed transactions
4. Verify backup schedule is working

### Monthly Tasks (Manual)

1. Review and optimize slow queries
2. Check for unused indexes
3. Update Supabase if new version available
4. Review RLS policies for any needed changes

## 🔄 Schema Updates

### For Future Schema Changes

1. **Never** run `DROP SCHEMA` on production
2. Always test migrations in development first
3. Use migration files for version control:

```sql
-- migrations/001_add_new_column.sql
ALTER TABLE users ADD COLUMN new_field TEXT;
```

4. Apply migrations carefully:
```sql
-- Run in SQL Editor
\i migrations/001_add_new_column.sql
```

### Backup Before Major Changes

```bash
# Using Supabase CLI
supabase db dump -f backup.sql

# Or use Supabase Dashboard → Database → Backups
```

## 🎓 Next Steps

After successful deployment:

1. ✅ Deploy Edge Functions (see `/supabase/functions/`)
2. ✅ Configure webhooks for Paystack
3. ✅ Set up monitoring and alerts
4. ✅ Create your admin user
5. ✅ Test all major user flows
6. ✅ Configure production environment variables
7. ✅ Set up automated backups
8. ✅ Deploy to production!

## 📞 Support

For issues specific to:
- **Supabase platform**: [Supabase Support](https://supabase.com/support)
- **This application**: Check the main README.md or open an issue
- **Database questions**: [PostgreSQL Documentation](https://www.postgresql.org/docs/)

---

**Congratulations!** 🎉 Your database is now ready to power the Smart Ajo application.
