# Payment System Deployment Checklist

Use this checklist to ensure the payment system is properly deployed and configured.

## Pre-Deployment

- [ ] Supabase CLI installed (`npm install -g supabase`)
- [ ] Logged into Supabase (`supabase login`)
- [ ] Project linked to Supabase (`supabase link --project-ref YOUR_REF`)
- [ ] Paystack account created
- [ ] Paystack test keys available
- [ ] `.env.development` file exists and configured

## Environment Configuration

### Frontend Environment (.env.development)

- [ ] `VITE_SUPABASE_URL` set to your Supabase project URL
- [ ] `VITE_SUPABASE_ANON_KEY` set to your Supabase anon key
- [ ] `VITE_PAYSTACK_PUBLIC_KEY` set to Paystack public key (pk_test_...)
- [ ] `VITE_APP_URL` set to `http://localhost:3000` (or your dev URL)
- [ ] `VITE_APP_NAME` set to "Ajo Secure" (or your app name)

### Backend Environment (Supabase Secrets)

- [ ] `PAYSTACK_SECRET_KEY` set via `supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...`
- [ ] Secrets verified with `supabase secrets list`

## Edge Functions Deployment

Run: `./deploy-payment-system.sh`

- [ ] `verify-payment` function deployed
- [ ] `paystack-webhook` function deployed
- [ ] `send-email` function deployed
- [ ] `verify-bvn` function deployed
- [ ] `health-check` function deployed

Verify with: `supabase functions list`

## Deployment Verification

Run: `./check-edge-functions.sh`

- [ ] `verify-payment` returns 204 (CORS preflight OK)
- [ ] `paystack-webhook` returns 204 (CORS preflight OK)
- [ ] `send-email` returns 204 (CORS preflight OK)
- [ ] `verify-bvn` returns 204 (CORS preflight OK)
- [ ] `health-check` returns 204 (CORS preflight OK)

## Database Schema

- [ ] Database schema applied (`supabase/schema.sql`)
- [ ] `payments` table exists
- [ ] `group_members` table has `has_paid_security_deposit` column
- [ ] `contributions` table exists
- [ ] `transactions` table exists
- [ ] Payment-related migrations applied

## Payment Flow Testing

### Test Group Creation Payment

- [ ] Start dev server (`npm run dev`)
- [ ] Login to application
- [ ] Navigate to "Create Group"
- [ ] Fill in group details
- [ ] Submit form (group created)
- [ ] Select preferred payout slot
- [ ] Click "Pay Security Deposit"
- [ ] Paystack popup opens
- [ ] Enter test card: `4084084084084081`
  - CVV: `123`
  - Expiry: `12/25`
  - PIN: `1234`
  - OTP: `123456`
- [ ] Payment completes
- [ ] Redirects to payment success page
- [ ] Shows "Payment verified successfully"
- [ ] Shows assigned position number
- [ ] Navigate to group page
- [ ] User appears as active member
- [ ] `has_paid_security_deposit` is `true`
- [ ] Status is "active"

### Test Group Join Payment

- [ ] Logout and create new account (or use different user)
- [ ] Browse available groups
- [ ] Request to join a group
- [ ] Login as group creator
- [ ] Approve join request
- [ ] Login as joining user
- [ ] Navigate to group detail page
- [ ] Click "Pay Security Deposit"
- [ ] Complete payment with test card
- [ ] Verify same success criteria as group creation

### Test Failed Payment

- [ ] Initiate payment
- [ ] Use failed test card: `4084084084084099`
- [ ] Verify payment fails gracefully
- [ ] User not added as member
- [ ] Payment record marked as failed

### Test Payment Webhook

- [ ] Initiate payment
- [ ] Complete payment
- [ ] Close browser before verification completes
- [ ] Wait 30 seconds
- [ ] Check database - member should still be activated by webhook
- [ ] Verify webhook logs: `supabase functions logs paystack-webhook`

## Edge Function Logs

Verify logs show successful processing:

```bash
supabase functions logs verify-payment --limit 20
supabase functions logs paystack-webhook --limit 20
```

Look for:
- [ ] "=== PAYMENT VERIFICATION START ===" (verify-payment)
- [ ] "User authenticated successfully" (verify-payment)
- [ ] "Paystack verification successful" (verify-payment)
- [ ] "Business logic execution complete: SUCCESS" (verify-payment)
- [ ] "=== WEBHOOK RECEIVED ===" (paystack-webhook)
- [ ] No critical errors

## Paystack Webhook Configuration (Optional but Recommended)

- [ ] Go to Paystack Dashboard → Settings → Webhooks
- [ ] Add webhook URL: `https://YOUR_PROJECT.supabase.co/functions/v1/paystack-webhook`
- [ ] Save webhook
- [ ] Test webhook delivery (send test event from Paystack dashboard)
- [ ] Verify webhook logs show received event

## Security Verification

- [ ] Secret keys not committed to Git
- [ ] `.env.development` in `.gitignore`
- [ ] Frontend only uses public keys
- [ ] Backend uses secret keys from Supabase secrets
- [ ] HTTPS enabled for production
- [ ] Webhook signature validation enabled

## Production Preparation

Before deploying to production:

- [ ] Replace test keys with live keys:
  - [ ] `VITE_PAYSTACK_PUBLIC_KEY=pk_live_...`
  - [ ] `supabase secrets set PAYSTACK_SECRET_KEY=sk_live_...`
- [ ] Update `VITE_APP_URL` to production domain
- [ ] Update Paystack webhook URL to production
- [ ] Test with small real transaction
- [ ] Verify membership activation works
- [ ] Set up monitoring and alerting
- [ ] Review and enable security features

## Documentation Review

- [ ] Read `PAYMENT_INTEGRATION_README.md`
- [ ] Read `PAYSTACK_INTEGRATION_DEPLOYMENT.md`
- [ ] Understand payment flow diagram
- [ ] Know how to debug issues
- [ ] Know where to find logs

## Common Issues Resolved

- [ ] Edge Functions not deployed → Run `./deploy-payment-system.sh`
- [ ] Server configuration error → Set Paystack secret key
- [ ] Session expired error → Refresh page (webhook will handle)
- [ ] CORS errors → Verify Edge Functions deployed
- [ ] 404 errors → Deploy Edge Functions

## Final Verification

- [ ] All Edge Functions healthy
- [ ] Payment initialization works
- [ ] Paystack popup opens
- [ ] Payment verification succeeds
- [ ] Member activation automatic
- [ ] Database updates correct
- [ ] No errors in logs
- [ ] Webhook configured and working

## Sign-off

- [ ] Payment system tested and working
- [ ] Documentation reviewed and understood
- [ ] Production checklist reviewed
- [ ] Team trained on payment flow
- [ ] Monitoring configured
- [ ] Ready for production deployment

---

**Date Completed:** _________________

**Deployed By:** _________________

**Notes:**
