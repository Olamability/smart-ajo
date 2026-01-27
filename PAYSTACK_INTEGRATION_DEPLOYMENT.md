# Paystack Payment Integration - Complete Deployment Guide

## Overview

This guide provides step-by-step instructions to deploy and configure the Paystack payment integration for Smart Ajo. The payment system is **already implemented** but requires proper deployment and configuration.

## Architecture Summary

The payment system consists of:

1. **Frontend Components** (Already implemented ✅)
   - `src/lib/paystack.ts` - Paystack popup integration
   - `src/api/payments.ts` - Payment API service
   - `src/pages/PaymentSuccessPage.tsx` - Payment verification page
   - `src/pages/CreateGroupPage.tsx` - Group creation with payment
   - `src/pages/GroupDetailPage.tsx` - Group joining with payment

2. **Backend Components** (Already implemented ✅)
   - `supabase/functions/verify-payment/` - Primary payment verification
   - `supabase/functions/paystack-webhook/` - Webhook handler (backup)
   - `supabase/functions/_shared/payment-processor.ts` - Business logic

3. **Database** (Already implemented ✅)
   - `payments` table for transaction records
   - `group_members` table for membership tracking
   - `contributions` table for contribution records
   - Business logic functions and triggers

## Critical Issue: Edge Functions Not Deployed

**Current Status:** ❌ Edge Functions are NOT deployed to Supabase
**Impact:** Payment verification fails, members cannot be activated
**Solution:** Deploy Edge Functions (see below)

## Prerequisites

Before deployment, ensure you have:

1. **Supabase CLI installed**
   ```bash
   npm install -g supabase
   ```

2. **Supabase account** with an active project

3. **Paystack account** with:
   - Public Key (for frontend)
   - Secret Key (for backend)

4. **Git** installed and configured

## Deployment Steps

### Step 1: Verify Current Setup

Run the verification script to check the current state:

```bash
cd /path/to/smart-ajo
chmod +x verify-payment-setup.sh
./verify-payment-setup.sh
```

This will show you:
- ✅ What's properly configured
- ❌ What needs to be fixed
- ⚠️ What needs attention

### Step 2: Configure Environment Variables

#### Frontend Environment (`.env.development`)

Ensure these variables are set:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Paystack Configuration
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_public_key_here

# Application Configuration
VITE_APP_URL=http://localhost:3000
VITE_APP_NAME=Ajo Secure
```

**Important:** Replace placeholder values with your actual keys from:
- Supabase Dashboard → Project Settings → API
- Paystack Dashboard → Settings → API Keys & Webhooks

#### Backend Environment (Supabase Secrets)

These are configured via Supabase CLI (see Step 4).

### Step 3: Login to Supabase CLI

```bash
# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF
```

To get your project reference:
1. Go to Supabase Dashboard
2. Click on your project
3. Go to Settings → General
4. Copy the "Reference ID"

### Step 4: Deploy Edge Functions

This is the **CRITICAL STEP** that's currently missing.

```bash
# Make the deployment script executable
chmod +x deploy-edge-functions.sh

# Deploy all Edge Functions
./deploy-edge-functions.sh
```

The script will deploy:
- ✅ `verify-payment` - Primary payment verification
- ✅ `paystack-webhook` - Webhook handler
- ✅ `send-email` - Email notifications
- ✅ `verify-bvn` - BVN verification
- ✅ `health-check` - System health monitoring

**Expected Output:**
```
========================================
Supabase Edge Functions Deployment
========================================

Deploying verify-payment...
✓ verify-payment deployed successfully

Deploying paystack-webhook...
✓ paystack-webhook deployed successfully

...

========================================
Deployment Complete!
========================================
```

### Step 5: Configure Supabase Secrets

After deployment, set the required secrets:

```bash
# Set Paystack Secret Key
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here

# Verify secrets are set
supabase secrets list
```

**Expected Output:**
```
NAME                    VALUE (PREVIEW)
PAYSTACK_SECRET_KEY     sk_test_...
```

**Important:** 
- Use `sk_test_*` keys for testing
- Use `sk_live_*` keys for production
- NEVER commit secret keys to Git

### Step 6: Verify Edge Functions Deployment

```bash
# Check deployment status
chmod +x check-edge-functions.sh
./check-edge-functions.sh
```

**Expected Output (Success):**
```
========================================
Edge Functions Health Check
========================================

Testing verify-payment...
✓ verify-payment: CORS preflight OK (204)

Testing paystack-webhook...
✓ paystack-webhook: CORS preflight OK (204)

...

========================================
All functions are healthy!
✓ CORS configured correctly
✓ All functions deployed
========================================
```

### Step 7: Configure Paystack Webhook (Optional but Recommended)

The webhook acts as a backup payment processor.

1. Go to Paystack Dashboard → Settings → Webhooks
2. Add webhook URL:
   ```
   https://YOUR_PROJECT.supabase.co/functions/v1/paystack-webhook
   ```
3. Save the webhook URL

**What the webhook does:**
- Processes payments if user closes browser before verification
- Provides redundancy if primary verification fails
- Ensures no payments are lost

### Step 8: Test the Payment Flow

#### Test with Paystack Test Cards

Use these test cards for testing:

| Card Number | Result |
|-------------|--------|
| 4084084084084081 | Success |
| 4084084084084099 | Failed (Insufficient Funds) |

**Card Details:**
- CVV: Any 3 digits (e.g., `123`)
- Expiry: Any future date (e.g., `12/25`)
- PIN: `1234`
- OTP: `123456`

#### Test Flow 1: Group Creation Payment

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Navigate to `http://localhost:3000`

3. Login or create an account

4. Create a new group:
   - Click "Create Group"
   - Fill in group details
   - Submit form

5. Select your preferred payout slot

6. Click "Pay Security Deposit"

7. Complete payment with test card

8. Verify:
   - ✅ Payment popup opens
   - ✅ Payment completes successfully
   - ✅ Redirects to success page
   - ✅ Shows "Payment verified successfully"
   - ✅ Shows your assigned position
   - ✅ You are listed as a group member
   - ✅ Membership status is "active"

#### Test Flow 2: Group Join Payment

1. As another user (or logout and create new account)

2. Browse available groups

3. Request to join a group

4. Wait for approval (login as group creator and approve)

5. After approval, pay security deposit

6. Verify same checkpoints as group creation

### Step 9: Monitor Edge Function Logs

To see what's happening during payment processing:

```bash
# View logs for verify-payment function
supabase functions logs verify-payment

# View logs for webhook
supabase functions logs paystack-webhook
```

**Look for:**
- ✅ "=== PAYMENT VERIFICATION START ===" - Verification started
- ✅ "User authenticated successfully" - Auth working
- ✅ "Paystack verification successful" - Payment verified
- ✅ "Business logic execution complete: SUCCESS" - Member activated
- ❌ Any error messages - Needs fixing

## Common Issues and Solutions

### Issue 1: "Edge Function not deployed (404)"

**Cause:** Edge Functions not deployed to Supabase
**Solution:** Run `./deploy-edge-functions.sh` (Step 4)

### Issue 2: "Server configuration error"

**Cause:** Missing Supabase secrets
**Solution:** Run `supabase secrets set PAYSTACK_SECRET_KEY=...` (Step 5)

### Issue 3: "Session expired" during verification

**Cause:** JWT token expired while payment was processing
**Solution:** User should refresh page and payment will still be verified via webhook

### Issue 4: Payment succeeds but member not activated

**Possible Causes:**
1. Business logic error in payment processor
2. Database permissions issue
3. Missing database migration

**Debug Steps:**
```bash
# Check Edge Function logs
supabase functions logs verify-payment --limit 50

# Check for errors in payment-processor
grep "ERROR" supabase/functions/_shared/payment-processor.ts

# Verify database schema is up to date
supabase db pull
```

### Issue 5: CORS errors when verifying payment

**Cause:** Edge Function not returning proper CORS headers
**Solution:** Edge Functions already include CORS headers. If issue persists:
1. Verify Edge Functions are deployed
2. Check if `Access-Control-Allow-Origin: *` is in response headers
3. Ensure frontend is calling correct Edge Function URL

## Production Deployment Checklist

Before going to production:

- [ ] Replace test keys with live keys:
  - [ ] `VITE_PAYSTACK_PUBLIC_KEY=pk_live_...`
  - [ ] `supabase secrets set PAYSTACK_SECRET_KEY=sk_live_...`
- [ ] Update `VITE_APP_URL` to production domain
- [ ] Configure Paystack webhook with production URL
- [ ] Test payment flow with real (small amount) transaction
- [ ] Verify webhook is receiving events
- [ ] Set up monitoring and alerting
- [ ] Review and enable production security settings
- [ ] Document any production-specific configurations

## Payment Flow Diagram

```
User initiates payment
        ↓
Frontend: initializeGroupCreationPayment()
        ↓
Create pending payment record in DB
        ↓
Frontend: paystackService.initializePayment()
        ↓
Paystack popup opens
        ↓
User completes payment
        ↓
Paystack redirects to callback URL
        ↓
Frontend: PaymentSuccessPage.tsx
        ↓
Frontend: verifyPayment(reference)
        ↓
Backend: verify-payment Edge Function
        ↓
Verify with Paystack API (using secret key)
        ↓
Update payment record (status, verified=true)
        ↓
Execute business logic:
  - Add user as group member
  - Set has_paid_security_deposit = true
  - Create first contribution record
  - Create transaction records
        ↓
Return success to frontend
        ↓
Frontend displays success message
        ↓
User is now an active member! ✅

BACKUP FLOW (if user closes browser):
        ↓
Paystack sends webhook to paystack-webhook
        ↓
Webhook processes payment (same business logic)
        ↓
Member activated via webhook ✅
```

## Security Best Practices

1. **Never expose secret keys:**
   - ✅ Frontend only uses `VITE_PAYSTACK_PUBLIC_KEY`
   - ✅ Backend uses `PAYSTACK_SECRET_KEY` from Supabase secrets
   - ❌ **NEVER** commit secrets to Git

2. **Verify on backend only:**
   - ✅ All payment verification happens on backend
   - ✅ Frontend cannot fake successful payments
   - ✅ Database updates require verification

3. **Use HTTPS everywhere:**
   - ✅ Supabase Edge Functions use HTTPS
   - ✅ Paystack requires HTTPS for webhooks
   - ⚠️ Ensure production domain uses HTTPS

4. **Validate webhook signatures:**
   - ✅ Webhook validates Paystack signature
   - ✅ Rejects invalid signatures
   - ✅ Uses HMAC SHA512 verification

## Support and Resources

- **Supabase Docs:** https://supabase.com/docs/guides/functions
- **Paystack Docs:** https://paystack.com/docs/api/
- **Project README:** See `README.md`
- **Architecture Guide:** See `ARCHITECTURE.md`

## Next Steps After Deployment

1. **Monitor the system:**
   - Check Edge Function logs regularly
   - Monitor payment success rate
   - Track member activation rate

2. **Optimize as needed:**
   - Review payment processing time
   - Optimize database queries
   - Add caching where appropriate

3. **Scale up:**
   - Configure Supabase for production load
   - Set up proper database backups
   - Implement monitoring and alerting

## Conclusion

Once Edge Functions are deployed and configured:
- ✅ Payment initialization will work
- ✅ Paystack popup will open correctly
- ✅ Payment verification will succeed
- ✅ Members will be activated automatically
- ✅ The complete flow will be automated

The code is **production-ready** - it just needs to be **deployed**.

**Main action required:** Run `./deploy-edge-functions.sh` to deploy Edge Functions.
