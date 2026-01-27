# Paystack Integration Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the clean Paystack integration to production.

## Prerequisites

Before deploying, ensure you have:

- [x] Supabase project created
- [x] Supabase CLI installed (`npm install -g supabase`)
- [x] Paystack account (test or live)
- [x] Vercel account (or other hosting)
- [x] Repository cloned locally

## Step 1: Configure Supabase

### 1.1 Link Your Project

```bash
# Link to your Supabase project
supabase link --project-ref your-project-ref

# You'll be prompted to enter your database password
```

### 1.2 Set Supabase Secrets

```bash
# Set Paystack secret key
# Use test key for staging, live key for production
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key

# Verify secrets are set
supabase secrets list
```

Expected output:
```
PAYSTACK_SECRET_KEY
SUPABASE_URL (automatically set)
SUPABASE_ANON_KEY (automatically set)
SUPABASE_SERVICE_ROLE_KEY (automatically set)
```

## Step 2: Deploy Edge Functions

### 2.1 Deploy verify-payment

```bash
cd /path/to/smart-ajo

# Deploy verify-payment Edge Function
supabase functions deploy verify-payment

# Expected output:
# Deploying function: verify-payment
# Deployed function: verify-payment
# URL: https://xxx.supabase.co/functions/v1/verify-payment
```

### 2.2 Deploy paystack-webhook

```bash
# Deploy paystack-webhook Edge Function
supabase functions deploy paystack-webhook

# Expected output:
# Deploying function: paystack-webhook
# Deployed function: paystack-webhook
# URL: https://xxx.supabase.co/functions/v1/paystack-webhook
```

### 2.3 Verify Deployments

```bash
# List all deployed functions
supabase functions list

# Test verify-payment (should return 401 without auth)
curl -X POST https://xxx.supabase.co/functions/v1/verify-payment \
  -H "Content-Type: application/json" \
  -d '{"reference":"test"}'

# Expected: {"error":"Unauthorized","message":"Authentication required"}
```

## Step 3: Configure Paystack

### 3.1 Get Your Keys

**Test Environment:**
1. Go to [Paystack Dashboard](https://dashboard.paystack.com/)
2. Navigate to Settings > API Keys & Webhooks
3. Copy your **Test Public Key** (starts with `pk_test_`)
4. Copy your **Test Secret Key** (starts with `sk_test_`)

**Live Environment:**
1. Same steps as above
2. Copy your **Live Public Key** (starts with `pk_live_`)
3. Copy your **Live Secret Key** (starts with `sk_live_`)

### 3.2 Configure Webhook

1. In Paystack Dashboard, go to Settings > API Keys & Webhooks
2. Scroll to "Webhook URL" section
3. Click "Add Webhook"
4. Enter webhook URL:
   ```
   https://your-project-ref.supabase.co/functions/v1/paystack-webhook
   ```
5. Select events to receive:
   - [x] charge.success
   - [x] charge.failed
6. Click "Save"
7. Note the webhook secret (for verification)

### 3.3 Test Webhook

Paystack provides a test webhook feature:

1. In Settings > API Keys & Webhooks
2. Scroll to "Send Test Webhook"
3. Select `charge.success` event
4. Click "Send"
5. Check your Supabase Edge Function logs:
   ```bash
   supabase functions logs paystack-webhook
   ```
6. You should see webhook received and processed

## Step 4: Configure Frontend (Vercel)

### 4.1 Set Environment Variables

In your Vercel project dashboard:

1. Go to Settings > Environment Variables
2. Add the following variables:

| Variable | Value | Environments |
|----------|-------|--------------|
| `VITE_SUPABASE_URL` | `https://your-project-ref.supabase.co` | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbG...` (from Supabase dashboard) | Production, Preview, Development |
| `VITE_PAYSTACK_PUBLIC_KEY` | `pk_test_...` or `pk_live_...` | Production (live), Preview (test), Development (test) |
| `VITE_APP_URL` | `https://your-app.vercel.app` | Production (app URL), Preview (preview URL), Development (`http://localhost:3000`) |

**Important**: Use test keys for Preview and Development, live keys only for Production.

### 4.2 Deploy to Vercel

```bash
# If not already connected
vercel link

# Deploy to production
vercel --prod

# Or push to main branch (auto-deploy)
git push origin main
```

### 4.3 Verify Frontend

1. Visit your deployed app: `https://your-app.vercel.app`
2. Check browser console for any errors
3. Verify Paystack public key is loaded:
   - Open browser DevTools > Console
   - Type: `import.meta.env.VITE_PAYSTACK_PUBLIC_KEY`
   - Should show `pk_test_...` or `pk_live_...`

## Step 5: End-to-End Testing

### 5.1 Test Group Creation Payment

1. **Create a group**:
   - Log in to your app
   - Go to Create Group
   - Fill in group details
   - Select a payout slot
   - Click "Create Group"

2. **Make payment**:
   - Payment modal should open
   - Use Paystack test card: `4084 0840 8408 4081`
   - CVV: `408`
   - Expiry: Any future date
   - OTP: `123456`
   - Click "Pay"

3. **Verify success**:
   - Should redirect to `/payment/success?reference=XXX&group=YYY`
   - Should show "Payment Verified" message
   - Should display your assigned position
   - Click "Go to Group"
   - You should be a member with "Active" status

4. **Check logs**:
   ```bash
   # Check verify-payment logs
   supabase functions logs verify-payment --tail

   # Should see:
   # [Verification] Reference: GRP_CREATE_xxx
   # [Verification] Payment status: success
   # [Business Logic] Group creation payment processed
   ```

### 5.2 Test Group Join Payment

1. **Create join request**:
   - Log in with a different user
   - Find the group
   - Click "Request to Join"
   - Select preferred slot
   - Submit request

2. **Approve join request** (as group creator):
   - Log in as group creator
   - Go to group page
   - Approve the join request

3. **Make payment** (as joiner):
   - Log in as joiner
   - Go to group page
   - Click "Pay to Join"
   - Complete payment with test card
   - Verify success (same steps as above)

### 5.3 Test Webhook

1. **Simulate browser close**:
   - Start payment flow
   - Complete payment on Paystack
   - Close browser tab immediately before redirect
   - Wait 30 seconds
   - Check Edge Function logs:
     ```bash
     supabase functions logs paystack-webhook --tail
     ```
   - Should see webhook received and payment processed

2. **Verify idempotency**:
   - Complete a payment normally
   - Manually trigger webhook from Paystack dashboard
   - Check logs - should see "Already processed (duplicate webhook)"

### 5.4 Test Error Scenarios

1. **Session expiry**:
   - Start payment
   - Wait for session to expire (1 hour)
   - Complete payment
   - Should see "Session expired" message
   - Refresh page
   - Should successfully verify

2. **Invalid reference**:
   - Navigate to `/payment/success?reference=invalid`
   - Should show "Payment verification failed"

3. **Network failure**:
   - Simulate slow network in DevTools
   - Complete payment
   - Should see retry logic working in logs

## Step 6: Monitoring & Maintenance

### 6.1 Monitor Edge Function Logs

```bash
# Real-time logs
supabase functions logs verify-payment --tail
supabase functions logs paystack-webhook --tail

# Recent logs
supabase functions logs verify-payment --limit 100
supabase functions logs paystack-webhook --limit 100
```

### 6.2 Monitor Database

```sql
-- Check recent payments
SELECT 
  reference,
  status,
  verified,
  amount / 100 as amount_ngn,
  created_at,
  metadata->>'type' as payment_type
FROM payments
ORDER BY created_at DESC
LIMIT 20;

-- Check failed payments
SELECT 
  reference,
  status,
  gateway_response,
  created_at
FROM payments
WHERE status != 'success' AND status != 'pending'
ORDER BY created_at DESC;

-- Check pending payments older than 1 hour
SELECT 
  reference,
  status,
  created_at,
  NOW() - created_at as age
FROM payments
WHERE status = 'pending' 
  AND created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

### 6.3 Set Up Alerts

Configure alerts in Supabase dashboard for:

1. **Edge Function Errors**:
   - Go to Edge Functions > verify-payment > Logs
   - Click "Create Alert"
   - Configure: "Error rate > 5% for 5 minutes"

2. **High Response Time**:
   - Create alert for response time > 5 seconds

3. **Webhook Failures**:
   - Monitor paystack-webhook logs
   - Alert on signature validation failures

## Step 7: Going Live

### 7.1 Pre-Launch Checklist

- [ ] All Edge Functions deployed and tested
- [ ] Paystack webhook configured and tested
- [ ] Frontend environment variables set correctly
- [ ] End-to-end payment flow tested
- [ ] Error scenarios tested
- [ ] Idempotency verified
- [ ] Logs monitored for any issues
- [ ] Backup/rollback plan prepared

### 7.2 Switch to Live Keys

**Supabase**:
```bash
# Update to live secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_live_key
```

**Vercel**:
1. Go to Settings > Environment Variables
2. Update `VITE_PAYSTACK_PUBLIC_KEY`:
   - Environment: Production
   - Value: `pk_live_your_live_key`
3. Redeploy: `vercel --prod`

**Paystack**:
1. Update webhook URL to use production Edge Function
2. Configure for live mode
3. Test with small real transaction

### 7.3 Post-Launch Monitoring

**First 24 hours**:
- Monitor Edge Function logs continuously
- Check payment success rate every hour
- Verify webhook processing
- Monitor for any errors or failures

**First week**:
- Daily checks of logs and metrics
- Review any failed payments
- Analyze payment flow latency
- Gather user feedback

**Ongoing**:
- Weekly review of payment metrics
- Monthly audit of failed payments
- Regular security reviews
- Performance optimization as needed

## Troubleshooting

### Edge Function Not Found (404)

**Problem**: Frontend gets 404 when calling Edge Function

**Solution**:
```bash
# Verify function is deployed
supabase functions list

# If not listed, deploy again
supabase functions deploy verify-payment
supabase functions deploy paystack-webhook
```

### Webhook Signature Validation Failed

**Problem**: Webhook logs show "Invalid signature"

**Solution**:
1. Verify PAYSTACK_SECRET_KEY is correct:
   ```bash
   supabase secrets list
   ```
2. Re-set secret if needed:
   ```bash
   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx
   ```
3. Redeploy Edge Function:
   ```bash
   supabase functions deploy paystack-webhook
   ```

### Payment Verified But Member Not Added

**Problem**: Payment is marked as verified but user not added to group

**Solution**:
1. Check Edge Function logs for business logic errors:
   ```bash
   supabase functions logs verify-payment --limit 50
   ```
2. Look for error messages in `[Business Logic]` section
3. Check database function `add_member_to_group` exists:
   ```sql
   SELECT routine_name 
   FROM information_schema.routines 
   WHERE routine_name = 'add_member_to_group';
   ```
4. If function missing, apply migrations:
   ```bash
   supabase db push
   ```

### Session Expired Errors

**Problem**: Users frequently see "Session expired" messages

**Solution**:
1. Frontend already handles session refresh automatically
2. If still occurring, check session timeout settings in Supabase
3. Ensure frontend calls `refreshSession()` before verification
4. Consider increasing session duration (default: 1 hour)

## Rollback Plan

If you need to rollback to previous version:

### Frontend Rollback
```bash
# Revert to previous deployment in Vercel
vercel rollback
```

### Edge Functions Rollback
```bash
# Redeploy from previous version
git checkout previous-commit
supabase functions deploy verify-payment
supabase functions deploy paystack-webhook
git checkout main
```

### Database Rollback
```bash
# If migrations were applied
supabase db reset --linked
```

## Support

For issues or questions:

1. **Check logs first**: `supabase functions logs <function-name>`
2. **Review documentation**: See `PAYSTACK_INTEGRATION_ARCHITECTURE.md`
3. **Check Paystack status**: [status.paystack.com](https://status.paystack.com)
4. **Supabase support**: [supabase.com/support](https://supabase.com/support)
5. **Paystack support**: support@paystack.com

## Appendix

### Useful Commands

```bash
# View Edge Function logs
supabase functions logs verify-payment --tail
supabase functions logs paystack-webhook --tail

# Deploy Edge Functions
supabase functions deploy verify-payment
supabase functions deploy paystack-webhook

# List secrets
supabase secrets list

# Set secret
supabase secrets set KEY=value

# Deploy frontend
vercel --prod

# Check build status
vercel ls
```

### Test Card Numbers

Paystack test cards:

| Card Number | Purpose |
|------------|---------|
| 4084 0840 8408 4081 | Success |
| 4084 0840 8408 4084 | Insufficient funds |
| 5060 6666 6666 6666 6666 | PIN required |

CVV: `408`  
PIN: `0000`  
OTP: `123456`  
Expiry: Any future date

### Environment Variable Quick Reference

**Frontend (.env.production)**:
```bash
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx...
VITE_PAYSTACK_PUBLIC_KEY=pk_live_xxx
VITE_APP_URL=https://your-app.vercel.app
```

**Backend (Supabase secrets)**:
```bash
PAYSTACK_SECRET_KEY=sk_live_xxx
```

## Changelog

### Version 2.0 (Current) - Clean Implementation
- Complete rebuild of Paystack integration
- Backend as single source of truth
- Proper idempotency throughout
- Enhanced error handling and logging
- Webhook backup for reliability

### Version 1.0 (Deprecated)
- Legacy implementation
- Frontend-driven state management
- Race conditions and timing issues
- Removed in this deployment
