# Production Deployment Guide

## Overview
This guide covers deploying Smart Ajo to production with Vercel (frontend) and Supabase (backend/database).

## Prerequisites

1. **Supabase Project**
   - Production Supabase project
   - Project URL: `https://kvxokszuonvdvsazoktc.supabase.co`
   - Anon key (public)
   - Service role key (secret - for Edge Functions only)

2. **Paystack Account**
   - Live public key: `pk_live_...`
   - Live secret key: `sk_live_...` (for backend only)

3. **Vercel Account**
   - Connected to GitHub repository
   - Project URL: `https://smart-ajo.vercel.app`

## Step 1: Configure Paystack Webhook

### 1.1 Deploy Edge Functions

```bash
# Login to Supabase CLI
supabase login

# Link to production project
supabase link --project-ref kvxokszuonvdvsazoktc

# Deploy all edge functions
./deploy-edge-functions.sh
```

When prompted:
- Enter Paystack **live** secret key: `sk_live_...`
- Skip BVN configuration (or configure if using real BVN service)

### 1.2 Configure Webhook in Paystack Dashboard

1. Go to [Paystack Dashboard](https://dashboard.paystack.com) → Settings → Webhooks
2. Add webhook URL:
   ```
   https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook
   ```
3. Select events to listen for:
   - ✅ `charge.success` (required)
   - ✅ `charge.failed` (recommended)
   - ✅ `transfer.success` (for payouts - future)
   - ✅ `transfer.failed` (for payouts - future)

4. Save webhook configuration

### 1.3 Verify Webhook Status

The webhook URL you provided is: `https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook`

✅ **Status**: The webhook function has now been created and will be valid after deployment via `./deploy-edge-functions.sh`

## Step 2: Configure Vercel Environment Variables

Go to [Vercel Dashboard](https://vercel.com) → Your Project → Settings → Environment Variables

Add the following variables for **Production** environment:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://kvxokszuonvdvsazoktc.supabase.co
VITE_SUPABASE_ANON_KEY=<your-production-anon-key>

# Application URL (Production)
VITE_APP_URL=https://smart-ajo.vercel.app

# Paystack Configuration (LIVE keys)
VITE_PAYSTACK_PUBLIC_KEY=pk_live_<your-live-public-key>

# Feature Flags
VITE_ENABLE_KYC=true
VITE_ENABLE_BVN_VERIFICATION=true
VITE_ENABLE_EMAIL_VERIFICATION=true
VITE_ENABLE_PHONE_VERIFICATION=true

# Security
VITE_BYPASS_AUTH=false
```

⚠️ **IMPORTANT**: 
- Use **LIVE** Paystack keys in production
- Use **TEST** keys (`pk_test_...`, `sk_test_...`) for staging/development
- Never commit `.env.production` with real keys to Git

## Step 3: Deploy to Vercel

### Option A: Automatic Deployment (Recommended)
Push to your main/production branch:
```bash
git push origin main
```
Vercel will automatically build and deploy.

### Option B: Manual Deployment
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to production
vercel --prod
```

## Step 4: Verify Deployment

### 4.1 Test Payment Flow

1. Visit: https://smart-ajo.vercel.app
2. Sign up or log in
3. Create a new Ajo group
4. Complete payment with test card:
   - Card: `4084 0840 8408 4081`
   - CVV: `123`
   - PIN: `1234`
   - OTP: `123456`

5. Verify:
   - ✅ Payment popup opens
   - ✅ Payment completes successfully
   - ✅ User is redirected to success page
   - ✅ Membership is activated instantly
   - ✅ Group status updates correctly

### 4.2 Verify Webhook Delivery

1. Go to Paystack Dashboard → Logs → Webhook Logs
2. Check for successful webhook deliveries to your endpoint
3. Verify response status is `200 OK`

### 4.3 Check Edge Function Logs

```bash
# View verify-payment logs
supabase functions logs verify-payment --project-ref kvxokszuonvdvsazoktc

# View webhook logs
supabase functions logs paystack-webhook --project-ref kvxokszuonvdvsazoktc
```

## Step 5: Callback URL Configuration

### Current Setup
The application uses `VITE_APP_URL` environment variable for callbacks:

**Development**: `http://localhost:3000/payment/success?reference={ref}&group={id}`
**Production**: `https://smart-ajo.vercel.app/payment/success?reference={ref}&group={id}`

### How It Works

1. **Paystack Popup Flow** (Current Implementation):
   - User completes payment in Paystack popup
   - `onSuccess` callback fires immediately
   - Frontend navigates to `/payment/success` page
   - Page calls `verify-payment` Edge Function
   - Membership is activated

2. **Webhook Flow** (Recommended - Now Implemented):
   - User completes payment in Paystack popup
   - Paystack sends webhook event to backend
   - Webhook handler activates membership automatically
   - Frontend shows success regardless (fallback verification)

### Benefits of Webhook
- ✅ Instant activation (no user wait time)
- ✅ Works even if user closes browser
- ✅ More reliable than polling
- ✅ Handles edge cases (network issues, etc.)

## Troubleshooting

### Webhook Not Receiving Events

1. **Check Webhook URL**: Verify it's correctly configured in Paystack Dashboard
2. **Check Signature**: Ensure `PAYSTACK_SECRET_KEY` is set correctly in Supabase
3. **Check Logs**: Run `supabase functions logs paystack-webhook`
4. **Test Webhook**: Use Paystack Dashboard to resend test webhooks

### Payment Verification Fails

1. **Check Metadata**: Ensure metadata includes `userId`, `groupId`, `paymentType`, `slotNumber`
2. **Check Edge Function**: Run `supabase functions logs verify-payment`
3. **Check Database**: Verify RLS policies allow service role to update records

### Callback URL Not Working

1. **Verify Environment Variable**: Check `VITE_APP_URL` in Vercel settings
2. **Redeploy**: After changing env vars, trigger new deployment
3. **Check Browser Console**: Look for navigation errors

## Security Checklist

- [ ] Production uses LIVE Paystack keys
- [ ] Webhook signature verification is enabled
- [ ] Service role key is NOT exposed to frontend
- [ ] `VITE_BYPASS_AUTH` is set to `false`
- [ ] Database RLS policies are properly configured
- [ ] CORS headers are configured in Edge Functions
- [ ] CSP headers allow Paystack domains (already in vercel.json)

## Monitoring

### Key Metrics to Track

1. **Payment Success Rate**: Track in Paystack Dashboard
2. **Webhook Delivery Rate**: Check Paystack webhook logs
3. **Edge Function Errors**: Monitor Supabase function logs
4. **User Activation Time**: Time from payment to membership activation

### Recommended Tools

- Paystack Dashboard: Payment analytics
- Supabase Dashboard: Database and function monitoring
- Vercel Analytics: Frontend performance
- Sentry/LogRocket: Error tracking (optional)

## Rollback Plan

If issues occur in production:

1. **Revert Vercel Deployment**:
   ```bash
   vercel rollback
   ```

2. **Revert Edge Functions**:
   ```bash
   # Deploy previous version
   git checkout <previous-commit>
   ./deploy-edge-functions.sh
   ```

3. **Disable Webhook**: Temporarily disable in Paystack Dashboard

## Support

For issues or questions:
1. Check Supabase function logs
2. Check Paystack dashboard for payment status
3. Review this deployment guide
4. Check application documentation in `/PRD` folder

---

**Deployment Date**: 2026-02-05
**Production URL**: https://smart-ajo.vercel.app
**Webhook URL**: https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook
**Status**: ✅ Ready for production deployment
