# Smart Ajo - Deployment Guide

## Overview
This guide provides step-by-step instructions to deploy the Smart Ajo application with all PRD features implemented.

---

## Prerequisites

- Supabase project created
- Supabase CLI installed (`npm install -g supabase`)
- Node.js and npm installed
- Paystack account (test/live keys)

---

## 1. Database Setup

### Step 1: Apply Schema
```bash
# Navigate to project directory
cd /home/runner/work/smart-ajo/smart-ajo

# Login to Supabase CLI
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Apply database schema
supabase db push
```

### Step 2: Run SQL Files Manually (if needed)
If `supabase db push` doesn't work, run the SQL files in order:

```bash
# In Supabase SQL Editor, run these files in order:
1. supabase/schema.sql          # Tables and RLS policies
2. supabase/functions.sql       # Database functions
3. supabase/triggers.sql        # Automated triggers
4. supabase/storage.sql         # Storage buckets (optional)
5. supabase/views.sql           # Database views (optional)
```

### Step 3: Verify Tables
Check that all tables are created:
- users
- wallets (NEW)
- groups
- group_members
- contribution_cycles (NEW)
- contributions
- payments
- payouts
- penalties
- transactions
- notifications
- audit_logs

---

## 2. Edge Functions Deployment

### Step 1: Deploy Scheduled Jobs Function
```bash
# Deploy the scheduled jobs function
supabase functions deploy scheduled-jobs --no-verify-jwt

# Verify deployment
supabase functions list
```

### Step 2: Deploy Payment Functions
```bash
# Deploy payment verification
supabase functions deploy verify-payment --no-verify-jwt

# Deploy Paystack webhook handler
supabase functions deploy paystack-webhook --no-verify-jwt

# Deploy other functions
supabase functions deploy health-check --no-verify-jwt
supabase functions deploy send-email --no-verify-jwt
```

### Step 3: Configure Secrets
```bash
# Set Paystack secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_YOUR_KEY

# Verify secrets are set
supabase secrets list
```

---

## 3. Frontend Configuration

### Step 1: Environment Variables
Create `.env` file in project root:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY

# Paystack Configuration
VITE_PAYSTACK_PUBLIC_KEY=pk_test_YOUR_PUBLIC_KEY

# App Configuration
VITE_APP_URL=http://localhost:3000
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Build Application
```bash
# Development build
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

---

## 4. Scheduled Jobs Setup

The `scheduled-jobs` Edge Function handles automation:
- Marking overdue contributions
- Applying penalties
- Completing cycles
- Distributing payouts

### Option 1: GitHub Actions (Recommended)
Create `.github/workflows/scheduled-jobs.yml`:

```yaml
name: Scheduled Jobs

on:
  schedule:
    # Run every hour
    - cron: '0 * * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  run-scheduled-jobs:
    runs-on: ubuntu-latest
    steps:
      - name: Call Scheduled Jobs Function
        run: |
          curl -X POST \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -d '{"task": "all"}' \
            https://YOUR_PROJECT.supabase.co/functions/v1/scheduled-jobs
```

### Option 2: External Cron Service
Use services like:
- cron-job.org
- EasyCron
- AWS EventBridge

Configure to POST to:
```
https://YOUR_PROJECT.supabase.co/functions/v1/scheduled-jobs
```

With body:
```json
{
  "task": "all"
}
```

Headers:
```
Content-Type: application/json
Authorization: Bearer YOUR_SERVICE_ROLE_KEY
```

### Option 3: Supabase pg_cron (Advanced)
Enable pg_cron extension and create jobs:

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule job to run hourly
SELECT cron.schedule(
  'run-scheduled-jobs',
  '0 * * * *',
  $$ SELECT net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/scheduled-jobs',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{"task": "all"}'::jsonb
  ) $$
);
```

---

## 5. Testing the Implementation

### Test 1: Database Functions
```sql
-- Test wallet creation trigger
INSERT INTO users (id, email, phone, full_name) 
VALUES (
  gen_random_uuid(),
  'test@example.com',
  '+2348012345678',
  'Test User'
);

-- Verify wallet was created
SELECT * FROM wallets ORDER BY created_at DESC LIMIT 1;

-- Test audit logging
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10;
```

### Test 2: Group Activation Flow
1. Create a group with 3 members
2. Have each member:
   - Select a payout slot
   - Pay security deposit via Paystack
3. Verify:
   - Group status changes to 'active'
   - Contribution cycles are generated
   - First cycle is marked 'active'

### Test 3: Scheduled Jobs
```bash
# Trigger manually
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -d '{"task": "all"}' \
  https://YOUR_PROJECT.supabase.co/functions/v1/scheduled-jobs

# Check logs
supabase functions logs scheduled-jobs --limit 50
```

### Test 4: Payment Flow
1. Create test payment
2. Complete with Paystack test card:
   - Card: `4084084084084081`
   - CVV: `123`
   - Expiry: `12/25`
   - PIN: `1234`
   - OTP: `123456`
3. Verify:
   - Payment verified
   - Member activated
   - Transaction recorded
   - Audit log created

---

## 6. Production Deployment

### Step 1: Update Environment Variables
```env
# Production Supabase
VITE_SUPABASE_URL=https://YOUR_PROD_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PROD_ANON_KEY

# Production Paystack
VITE_PAYSTACK_PUBLIC_KEY=pk_live_YOUR_LIVE_KEY

# Production App URL
VITE_APP_URL=https://your-domain.com
```

### Step 2: Update Paystack Webhook
Configure webhook in Paystack Dashboard:
```
https://YOUR_PROD_PROJECT.supabase.co/functions/v1/paystack-webhook
```

### Step 3: Deploy to Hosting
Choose your hosting platform:

**Vercel:**
```bash
npm install -g vercel
vercel --prod
```

**Netlify:**
```bash
npm install -g netlify-cli
netlify deploy --prod
```

**Traditional Hosting:**
```bash
npm run build
# Upload dist/ folder to server
```

---

## 7. Monitoring & Maintenance

### Check Edge Function Logs
```bash
# View scheduled jobs logs
supabase functions logs scheduled-jobs --limit 100

# View payment logs
supabase functions logs verify-payment --limit 100

# Follow logs in real-time
supabase functions logs scheduled-jobs --follow
```

### Monitor Database
```sql
-- Check recent audit logs
SELECT * FROM audit_logs 
ORDER BY created_at DESC 
LIMIT 50;

-- Check active groups
SELECT id, name, status, current_members, total_members 
FROM groups 
WHERE status = 'active';

-- Check pending payouts
SELECT * FROM payouts 
WHERE status = 'pending';

-- Check overdue contributions
SELECT * FROM contributions 
WHERE status = 'overdue';
```

### Database Backups
Enable automatic backups in Supabase Dashboard:
- Daily backups recommended
- Retention period: 7-30 days

---

## 8. Security Checklist

- [ ] RLS enabled on all tables
- [ ] Service role key kept secret
- [ ] Paystack secret key in Supabase secrets (not .env)
- [ ] CORS configured properly
- [ ] Webhook signature validation enabled
- [ ] HTTPS enforced in production
- [ ] Rate limiting configured
- [ ] Audit logging active

---

## 9. Troubleshooting

### Problem: Scheduled Jobs Not Running
**Solution:**
1. Check cron service is configured
2. Verify service role key is correct
3. Check Edge Function logs
4. Test manual trigger

### Problem: Group Not Activating
**Solution:**
1. Verify all members paid deposits
2. Check `has_paid_security_deposit` flags
3. Run `check_and_activate_group()` manually:
```sql
SELECT check_and_activate_group('GROUP_UUID');
```

### Problem: Payouts Not Processing
**Solution:**
1. Check if cycles are completed
2. Verify scheduled jobs running
3. Check wallet balances
4. Review payout logs

### Problem: Penalties Not Applied
**Solution:**
1. Verify contributions are overdue
2. Check scheduled jobs logs
3. Run penalty job manually:
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"task": "penalties"}' \
  https://YOUR_PROJECT.supabase.co/functions/v1/scheduled-jobs
```

---

## 10. Support & Documentation

### Key Documentation Files:
- `README.md` - General project info
- `PRD_IMPLEMENTATION_COMPLETE.md` - Complete feature list
- `ARCHITECTURE.md` - System architecture
- `supabase/README.md` - Database documentation

### Health Check Endpoint:
```
https://YOUR_PROJECT.supabase.co/functions/v1/health-check
```

### Database Functions Reference:
```sql
-- Activate group
SELECT check_and_activate_group('group_uuid');

-- Generate cycles
SELECT generate_contribution_cycles('group_uuid');

-- Process payout
SELECT process_payout_to_wallet('payout_uuid');

-- Transfer funds
SELECT transfer_wallet_funds(
  'from_user_uuid',
  'to_user_uuid',
  10000.00,
  'wallet_transfer',
  'TRANSFER-REF-123'
);

-- Update KYC
SELECT update_kyc_status(
  'user_uuid',
  'approved',
  '{"verified_at": "2026-01-27"}'::jsonb
);

-- Blacklist user
SELECT add_to_default_blacklist(
  'user_uuid',
  'Multiple missed payments',
  'group_uuid'
);
```

---

## Conclusion

Your Smart Ajo application is now fully deployed with all PRD features:
✅ Complete database schema
✅ Automated contribution cycles
✅ Wallet system
✅ Payment processing
✅ Scheduled jobs
✅ Audit logging
✅ KYC framework
✅ Security measures

**Next Steps:**
1. Complete user acceptance testing
2. Configure production environment
3. Set up monitoring and alerts
4. Launch! 🚀

For issues or questions, refer to the documentation or check the Edge Function logs.
