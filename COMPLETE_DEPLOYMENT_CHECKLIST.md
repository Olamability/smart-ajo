# Complete Deployment Checklist - Smart Ajo Platform

This checklist ensures 100% functional deployment of the Smart Ajo application with no dummy or demo functions.

## Prerequisites

- [x] Node.js 18+ installed
- [x] Supabase CLI installed (`npm install -g supabase`)
- [x] Supabase account and project created
- [x] Paystack account with API keys
- [x] GitHub account (for repository)

## Phase 1: Database Setup

### 1.1 Supabase Project Setup

- [ ] Create Supabase project at https://supabase.com
- [ ] Note down project URL and keys:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Enable pg_cron extension (Database > Extensions)
- [ ] Enable pg_net extension (Database > Extensions) [for automated payouts]

### 1.2 Database Schema Deployment

Execute SQL files in order:

```bash
# Connect to Supabase dashboard > SQL Editor and run:
1. supabase/schema.sql          # Core database schema
2. supabase/functions.sql       # Business logic functions
3. supabase/triggers.sql        # Database triggers
4. supabase/views.sql           # Database views
5. supabase/realtime.sql        # Realtime configuration
6. supabase/storage.sql         # Storage buckets
7. supabase/scheduled-jobs.sql  # Automated jobs (requires pg_cron)
```

- [ ] Verify all tables created: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`
- [ ] Verify all functions created: `SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public';`
- [ ] Verify pg_cron jobs: `SELECT * FROM cron.job;`

## Phase 2: Edge Functions Deployment

### 2.1 Link Supabase Project

```bash
# Login to Supabase
supabase login

# Link your project
supabase link --project-ref YOUR_PROJECT_REF
```

- [ ] Supabase CLI logged in
- [ ] Project linked successfully

### 2.2 Deploy Edge Functions

```bash
# Deploy all Edge Functions
./deploy-edge-functions.sh

# Or deploy individually:
supabase functions deploy verify-payment --no-verify
supabase functions deploy paystack-webhook --no-verify
supabase functions deploy send-email --no-verify
supabase functions deploy verify-bvn --no-verify
supabase functions deploy health-check --no-verify
supabase functions deploy process-payouts --no-verify
```

- [ ] verify-payment deployed
- [ ] paystack-webhook deployed
- [ ] send-email deployed
- [ ] verify-bvn deployed (with Paystack/Flutterwave provider, NOT mock)
- [ ] health-check deployed
- [ ] process-payouts deployed

### 2.3 Set Edge Function Secrets

```bash
# Set Paystack secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_YOUR_PAYSTACK_SECRET_KEY

# For BVN verification (optional, defaults to PAYSTACK_SECRET_KEY)
supabase secrets set BVN_PROVIDER=paystack
supabase secrets set BVN_API_KEY=sk_live_YOUR_PAYSTACK_SECRET_KEY

# Verify secrets (won't show values)
supabase secrets list
```

- [ ] PAYSTACK_SECRET_KEY set
- [ ] BVN_PROVIDER set (paystack or flutterwave)
- [ ] BVN_API_KEY set

### 2.4 Test Edge Functions

```bash
# Test health check
curl https://YOUR_PROJECT.supabase.co/functions/v1/health-check

# Test CORS for verify-payment
curl -X OPTIONS 'https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment' \
  -H 'Origin: https://smart-ajo.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -v

# Expected: HTTP 204 with CORS headers
```

- [ ] health-check returns status 200
- [ ] verify-payment OPTIONS returns 204 with CORS headers
- [ ] All Edge Functions accessible

## Phase 3: Paystack Configuration

### 3.1 Webhook Setup

- [ ] Go to Paystack Dashboard > Settings > Webhooks
- [ ] Add webhook URL: `https://YOUR_PROJECT.supabase.co/functions/v1/paystack-webhook`
- [ ] Save and note the webhook secret (not used currently, but good for future)

### 3.2 API Keys

- [ ] Get Test Public Key from Paystack Dashboard
- [ ] Get Test Secret Key from Paystack Dashboard
- [ ] Get Live Public Key (for production)
- [ ] Get Live Secret Key (for production)

## Phase 4: Frontend Deployment (Vercel)

### 4.1 Environment Variables

Set these in Vercel Dashboard > Settings > Environment Variables:

```env
# Supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here

# Paystack
VITE_PAYSTACK_PUBLIC_KEY=pk_test_YOUR_PAYSTACK_PUBLIC_KEY  # Test
# For production:
# VITE_PAYSTACK_PUBLIC_KEY=pk_live_YOUR_PAYSTACK_PUBLIC_KEY

# App
VITE_APP_NAME=Ajo Secure
VITE_APP_URL=https://your-domain.vercel.app
```

- [ ] All environment variables set in Vercel
- [ ] Verified correct values (especially keys)

### 4.2 Deploy to Vercel

```bash
# Option 1: Connect GitHub repo in Vercel dashboard
# - Go to vercel.com
# - Import GitHub repository
# - Framework: Vite (auto-detected)
# - Build Command: npm run build
# - Output Directory: dist

# Option 2: Deploy via CLI
npm install -g vercel
vercel
```

- [ ] Repository connected to Vercel
- [ ] Build successful
- [ ] Deployment live
- [ ] Environment variables configured

### 4.3 Test Deployment

- [ ] Visit deployed URL
- [ ] Test user registration
- [ ] Test group creation (dummy payment with test card)
- [ ] Test payment flow
- [ ] Check browser console for errors

## Phase 5: Automated Jobs Setup

### 5.1 Verify pg_cron Jobs

```sql
-- In Supabase SQL Editor
SELECT * FROM cron.job;

-- Should show jobs:
-- 1. apply-late-penalties (daily at 1 AM)
-- 2. process-complete-cycles (every 6 hours)
-- 3. send-payment-reminders (daily at 9 AM)
-- 4. clean-old-notifications (weekly)
-- 5. clean-expired-tokens (daily)
-- 6. update-group-status (hourly)
-- 7. archive-completed-groups (weekly)
-- 8. generate-daily-stats (daily)
```

- [ ] All scheduled jobs created
- [ ] Jobs have correct schedules

### 5.2 Setup Payout Processing (Choose ONE method)

**Method A: Using pg_net (recommended if available)**

```sql
-- Enable pg_net extension
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Enable the scheduled job in scheduled-jobs.sql (uncomment)
-- Then re-run scheduled-jobs.sql
```

**Method B: External Cron Service (if pg_net not available)**

Use GitHub Actions, cron-job.org, or similar:

```yaml
# .github/workflows/process-payouts.yml
name: Process Payouts
on:
  schedule:
    - cron: '0 */2 * * *'  # Every 2 hours
jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - name: Call process-payouts
        run: |
          curl -X POST 'https://YOUR_PROJECT.supabase.co/functions/v1/process-payouts' \
            -H 'Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}' \
            -H 'Content-Type: application/json'
```

- [ ] Payout processing automation configured
- [ ] Test manual trigger: `curl -X POST 'https://YOUR_PROJECT.supabase.co/functions/v1/process-payouts' -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY'`

## Phase 6: Testing & Validation

### 6.1 End-to-End Testing

Use Paystack test cards:
- **Success**: 4084084084084081, CVV: 123, PIN: 1234, OTP: 123456
- **Failed**: 4084084084084099

#### Test 1: Complete Group Creation Flow
- [ ] Register new user
- [ ] Create a group
- [ ] Select payout slot
- [ ] Pay security deposit + first contribution
- [ ] Payment verified successfully
- [ ] User added as active member
- [ ] Slot locked
- [ ] Contribution record created

#### Test 2: Join Request Flow
- [ ] Register second user
- [ ] Browse available groups
- [ ] Apply to join with preferred slot
- [ ] Admin receives notification
- [ ] Admin approves request
- [ ] User pays security deposit + contribution
- [ ] User added to group
- [ ] Slot locked

#### Test 3: Standalone Contribution Payment
- [ ] Navigate to group detail as member
- [ ] View contribution schedule
- [ ] Click "Pay" on pending contribution
- [ ] Complete payment via Paystack
- [ ] Contribution marked as paid
- [ ] Transaction recorded

#### Test 4: Automated Penalty Application
- [ ] Create contribution with past due date
- [ ] Wait or manually trigger: `SELECT apply_late_penalties();`
- [ ] Verify penalty created
- [ ] User notified

#### Test 5: Automated Payout Processing
- [ ] Ensure all members paid for a cycle
- [ ] Trigger: `SELECT check_and_process_complete_cycles();`
- [ ] Verify payout created with status 'pending'
- [ ] Trigger: Call process-payouts Edge Function
- [ ] Verify payout completed
- [ ] User receives bank transfer
- [ ] Notification sent

### 6.2 Security Validation

- [ ] Run CodeQL scan: `npm run codeql` (if configured)
- [ ] Check for exposed secrets in code
- [ ] Verify RLS policies active
- [ ] Test unauthorized access attempts

### 6.3 Performance Testing

- [ ] Test with 10+ simultaneous group creations
- [ ] Test payment flow under load
- [ ] Monitor Edge Function execution times
- [ ] Check database query performance

## Phase 7: Production Readiness

### 7.1 Switch to Production Keys

In Vercel:
- [ ] Update `VITE_PAYSTACK_PUBLIC_KEY` to live key (`pk_live_...`)

In Supabase Secrets:
- [ ] Update `PAYSTACK_SECRET_KEY` to live key (`sk_live_...`)

### 7.2 Monitoring Setup

- [ ] Setup Supabase monitoring alerts
- [ ] Setup uptime monitoring (e.g., UptimeRobot)
- [ ] Configure error tracking (e.g., Sentry)
- [ ] Setup database backups

### 7.3 Documentation

- [ ] Update README.md with deployment info
- [ ] Document environment variables
- [ ] Create user guide
- [ ] Document admin workflows

### 7.4 Final Checklist

- [ ] All Edge Functions deployed and tested
- [ ] All scheduled jobs running
- [ ] Paystack webhook configured
- [ ] BVN verification using real provider (not mock)
- [ ] Automated payout processing working
- [ ] No dummy/mock/placeholder code in production
- [ ] All tests passing
- [ ] Security scan completed
- [ ] Production keys configured
- [ ] Monitoring active

## Rollback Plan

If issues occur:

1. **Frontend**: Revert Vercel deployment to previous version
2. **Backend**: Database migrations have backups, use Supabase point-in-time recovery
3. **Edge Functions**: Redeploy previous version: `supabase functions deploy FUNCTION_NAME --no-verify`

## Support & Troubleshooting

### Common Issues

**Issue: Payment verification fails with CORS error**
- Check Edge Function is deployed
- Verify CORS headers in verify-payment/index.ts
- Check browser console for exact error

**Issue: Automated payouts not processing**
- Verify process-payouts Edge Function deployed
- Check PAYSTACK_SECRET_KEY is set correctly
- Verify recipient bank details in user profile
- Check Edge Function logs: `supabase functions logs process-payouts`

**Issue: BVN verification stuck on "pending"**
- Check BVN_PROVIDER environment variable
- Verify BVN_API_KEY is set
- Check Edge Function logs: `supabase functions logs verify-bvn`

### Getting Help

- Supabase Logs: `supabase functions logs FUNCTION_NAME`
- Database Logs: Supabase Dashboard > Database > Logs
- Check cron job history: `SELECT * FROM get_job_run_history();`

## Deployment Complete ✅

Once all items are checked:
- Application is 100% functional
- No dummy or demo functions
- All PRD requirements met
- Ready for production use

---

**Last Updated**: January 2026
**Version**: 1.0.0
