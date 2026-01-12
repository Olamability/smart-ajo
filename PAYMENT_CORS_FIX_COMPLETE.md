# Payment Verification CORS Error - Complete Fix Guide

## Problem Summary

**Error Message:**
```
Access to fetch at 'https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/verify-payment' 
from origin 'https://smart-ajo.vercel.app' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: 
It does not have HTTP ok status.
```

**Impact:** Payment verification fails after successful Paystack payment, leaving groups in an orphaned state.

## Root Cause

The Edge Function `verify-payment` has one or both of these issues:

1. **Not deployed to production Supabase** - The function exists in code but not on the server
2. **Incorrect CORS configuration** (Now fixed in code) - OPTIONS request was returning wrong status code

## What Was Fixed

### 1. CORS Headers Updated (All Edge Functions)

**Changed in:**
- ✅ `supabase/functions/verify-payment/index.ts`
- ✅ `supabase/functions/send-email/index.ts`
- ✅ `supabase/functions/verify-bvn/index.ts`
- ✅ `supabase/functions/paystack-webhook/index.ts`

**Changes:**

```typescript
// BEFORE
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

if (req.method === 'OPTIONS') {
  return new Response('ok', { headers: corsHeaders });
}

// AFTER
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
};

if (req.method === 'OPTIONS') {
  return new Response(null, { 
    status: 204,  // Changed from 200 to 204
    headers: corsHeaders 
  });
}
```

**Why these changes matter:**
- **Status 204 (No Content)**: Standard HTTP status for OPTIONS requests
- **null body**: OPTIONS should not return content
- **Access-Control-Max-Age**: Reduces preflight requests by caching for 24 hours
- **Access-Control-Allow-Methods**: Explicitly declares supported methods

## Deployment Steps

### Prerequisites

1. **Install Supabase CLI:**
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase:**
   ```bash
   supabase login
   ```
   
   This will open a browser window. Login with your Supabase credentials.

3. **Link Your Project:**
   ```bash
   supabase link --project-ref kvxokszuonvdvsazoktc
   ```
   
   Replace `kvxokszuonvdvsazoktc` with your actual project reference ID from the Supabase dashboard URL.

### Option A: Deploy All Functions (Recommended)

Use the provided deployment script:

```bash
./deploy-edge-functions.sh
```

This will deploy all Edge Functions in the correct order.

### Option B: Deploy Individual Functions

Deploy the critical verify-payment function first:

```bash
supabase functions deploy verify-payment
```

Then deploy the others:

```bash
supabase functions deploy paystack-webhook
supabase functions deploy send-email
supabase functions deploy verify-bvn
```

### Verify Deployment

Check that all functions are deployed and active:

```bash
supabase functions list
```

Expected output:
```
┌──────────────────┬───────────┬────────────────────────┬─────────┐
│ NAME             │ STATUS    │ CREATED AT             │ VERSION │
├──────────────────┼───────────┼────────────────────────┼─────────┤
│ verify-payment   │ ACTIVE    │ 2026-01-12 19:40:00    │ 2       │
│ paystack-webhook │ ACTIVE    │ 2026-01-12 19:41:00    │ 2       │
│ send-email       │ ACTIVE    │ 2026-01-12 19:42:00    │ 2       │
│ verify-bvn       │ ACTIVE    │ 2026-01-12 19:43:00    │ 2       │
└──────────────────┴───────────┴────────────────────────┴─────────┘
```

All functions should show **STATUS: ACTIVE**.

### Configure Secrets

The Edge Functions require these environment secrets:

```bash
# Set Paystack secret key (REQUIRED)
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here

# For production, use your live key:
# supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_secret_key_here

# Verify secrets are set
supabase secrets list
```

Expected secrets:
- ✅ `PAYSTACK_SECRET_KEY` - Your Paystack secret key
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Auto-configured by Supabase
- ✅ `SUPABASE_URL` - Auto-configured by Supabase

## Testing the Fix

### Test 1: CORS Preflight

Test that OPTIONS requests work correctly:

```bash
curl -X OPTIONS \
  'https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/verify-payment' \
  -H "Origin: https://smart-ajo.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, content-type" \
  -v
```

**Expected response:**
```
< HTTP/2 204
< access-control-allow-origin: *
< access-control-allow-headers: authorization, x-client-info, apikey, content-type
< access-control-allow-methods: POST, OPTIONS
< access-control-max-age: 86400
```

**✅ Success:** Status 204 with CORS headers
**❌ Failure:** Status 404 (not deployed) or 500 (runtime error)

### Test 2: Function Invocation

Test the actual payment verification (will fail with test reference, but that's OK):

```bash
curl -X POST \
  'https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/verify-payment' \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reference": "test_reference"}'
```

Replace `YOUR_ANON_KEY` with your Supabase anon key from the dashboard.

**Expected response:**
```json
{
  "success": false,
  "payment_status": "verification_failed",
  "verified": false,
  "amount": 0,
  "message": "Payment verification failed with Paystack",
  "error": "Payment verification failed",
  "details": "Transaction not found"
}
```

**✅ Success:** Gets a JSON response (even if payment not found)
**❌ Failure:** CORS error or network error

### Test 3: End-to-End (Browser)

1. Open the deployed app: `https://smart-ajo.vercel.app`
2. Sign in to your account
3. Navigate to **Create Group**
4. Fill in all group details
5. Select a payout slot
6. Click **Create Group and Pay**
7. Complete payment on Paystack (use test card: 4084084084084081)
8. Wait for verification

**✅ Success:** 
- No CORS errors in browser console
- Group created successfully
- You become the admin/first member
- Redirected to group details page

**❌ Failure:**
- CORS error in console
- Payment verified but membership not created
- Stuck on payment dialog

## Troubleshooting

### Issue 1: "Function not found" or 404

**Cause:** Function not deployed

**Solution:**
```bash
supabase functions deploy verify-payment
```

### Issue 2: "PAYSTACK_SECRET_KEY not configured"

**Cause:** Secret not set in Supabase

**Solution:**
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_key
```

### Issue 3: CORS error persists after deployment

**Possible causes:**
1. Browser cache
2. Old preflight response cached
3. Wrong deployment

**Solutions:**
```bash
# 1. Clear browser cache and try in incognito window

# 2. Verify deployment
supabase functions list

# 3. Check function logs
supabase functions logs verify-payment --tail

# 4. Redeploy
supabase functions deploy verify-payment --no-verify-jwt
```

### Issue 4: "Project not linked"

**Cause:** Supabase CLI not linked to your project

**Solution:**
```bash
# Get project ref from dashboard URL
# Format: https://supabase.com/dashboard/project/kvxokszuonvdvsazoktc
supabase link --project-ref kvxokszuonvdvsazoktc
```

### Issue 5: Payment verifies but membership not created

**Cause:** Database function error or RLS policy issue

**Solution:**
```bash
# Check Edge Function logs
supabase functions logs verify-payment

# Check if process_group_creation_payment function exists
# Run in Supabase SQL Editor:
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name = 'process_group_creation_payment';
```

## Monitoring

### Watch Logs in Real-Time

```bash
# Watch verify-payment logs
supabase functions logs verify-payment --tail

# Watch all function logs
supabase functions logs --tail
```

### Check Recent Errors

```bash
# Get last 100 log entries
supabase functions logs verify-payment --limit 100
```

## Understanding the Payment Flow

1. **User completes payment on Paystack**
   - Paystack popup closes
   - JavaScript callback fires with reference

2. **Frontend calls verify-payment Edge Function**
   - Browser sends OPTIONS preflight (must get 204)
   - Then sends POST with payment reference

3. **Edge Function verifies with Paystack API**
   - Uses secret key to call Paystack
   - Gets payment status and details

4. **Edge Function updates database**
   - Stores payment record
   - Marks as verified if successful

5. **Frontend processes group membership**
   - Calls process_group_creation_payment RPC
   - Adds creator as first member with selected slot

## Prevention

To prevent this issue in the future:

1. **Always deploy after code changes:**
   ```bash
   # After any Edge Function changes
   supabase functions deploy function-name
   ```

2. **Use CI/CD for automatic deployment:**
   - Add GitHub Actions workflow
   - Deploy on merge to main branch

3. **Monitor function health:**
   - Set up alerts for function errors
   - Regular log reviews

4. **Test in staging first:**
   - Deploy to staging project first
   - Test thoroughly before production

## Related Files

- `supabase/functions/verify-payment/index.ts` - Payment verification Edge Function
- `src/api/payments.ts` - Frontend payment API
- `src/pages/CreateGroupPage.tsx` - Group creation with payment
- `deploy-edge-functions.sh` - Deployment helper script
- `EDGE_FUNCTIONS_CORS_FIX.md` - Detailed CORS explanation

## Summary

✅ **Code Fixed:**
- Updated CORS headers in all Edge Functions
- Changed OPTIONS response to status 204
- Added preflight caching

📋 **Action Required:**
1. Deploy Edge Functions to Supabase production
2. Configure PAYSTACK_SECRET_KEY secret
3. Test CORS preflight requests
4. Test end-to-end payment flow

⏱️ **Estimated Time:** 10-15 minutes

🎯 **Expected Result:** Payment verification works seamlessly from Vercel app

---

**Last Updated:** January 12, 2026
**Status:** Code fixed, deployment required
**Priority:** HIGH - Blocking production payments
