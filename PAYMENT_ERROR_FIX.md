# Payment Verification Error Fix - Deployment Guide

## Issues Fixed

This fix addresses two critical errors encountered during payment:

### 1. Paystack CSS CORS Error (Non-Critical)
```
GET https://paystack.com/public/css/button.min.css 
net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin 403 (Forbidden)
```

**What it was:** Paystack's inline.js was trying to load CSS from paystack.com, but the Content Security Policy was blocking it.

**Fix Applied:** Added CSP headers in `vercel.json` to explicitly allow Paystack resources.

### 2. Edge Function 401 Unauthorized (CRITICAL)
```
POST https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/verify-payment 
401 (Unauthorized)
```

**What it was:** The verify-payment Edge Function was not validating authentication, causing Supabase to reject requests with a 401 error.

**Fix Applied:** Added proper JWT token validation in the Edge Function to authenticate users before processing payment verification.

## Changes Made

### 1. Frontend (Automatic via Vercel)
- **File:** `vercel.json`
- **Change:** Added Content-Security-Policy header
- **Deployment:** Automatic on next Vercel deployment

### 2. Backend (Manual Deployment Required)
- **File:** `supabase/functions/verify-payment/index.ts`
- **Changes:**
  - Added authentication header validation
  - Verify JWT token using Supabase auth
  - Return clear 401 error if not authenticated
  - Improved error messages
- **Deployment:** ⚠️ **MUST BE MANUALLY DEPLOYED TO SUPABASE**

## Deployment Instructions

### Prerequisites

Ensure you have the Supabase CLI installed and configured:

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref kvxokszuonvdvsazoktc
```

### Deploy the Edge Function

```bash
# Navigate to project root
cd /path/to/smart-ajo

# Deploy the updated verify-payment function
supabase functions deploy verify-payment

# Verify deployment was successful
supabase functions list
```

Expected output:
```
┌──────────────────┬───────────┬────────────────────────┬─────────┐
│ NAME             │ STATUS    │ CREATED AT             │ VERSION │
├──────────────────┼───────────┼────────────────────────┼─────────┤
│ verify-payment   │ ACTIVE    │ 2026-01-12 21:XX:XX    │ X       │
└──────────────────┴───────────┴────────────────────────┴─────────┘
```

✅ Status should show **ACTIVE**

### Verify Secrets Are Configured

The Edge Function requires these environment secrets:

```bash
# Check that secrets are set
supabase secrets list
```

Required secrets:
- ✅ `PAYSTACK_SECRET_KEY` - Your Paystack secret key
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Auto-configured by Supabase
- ✅ `SUPABASE_URL` - Auto-configured by Supabase

If `PAYSTACK_SECRET_KEY` is missing, set it:

```bash
# For test mode
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here

# For production
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_secret_key_here
```

## Testing the Fix

### Test 1: Check Edge Function Status

```bash
curl -X OPTIONS \
  'https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/verify-payment' \
  -H "Origin: https://smart-ajo.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, content-type" \
  -v
```

**Expected:** Status 204 with CORS headers

### Test 2: Test Authentication

```bash
# Replace YOUR_USER_JWT_TOKEN with actual token from browser
curl -X POST \
  'https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/verify-payment' \
  -H "Authorization: Bearer YOUR_USER_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reference": "test_reference"}'
```

**Expected:** JSON response (not 401 error)

### Test 3: End-to-End Payment Flow

1. Open https://smart-ajo.vercel.app
2. Sign in to your account
3. Navigate to **Create Group**
4. Fill in all group details
5. Click **Create Group**
6. Select a payout slot
7. Click **Pay** and complete payment with test card: `4084084084084081`
8. Wait for verification

**Expected Results:**
- ✅ No 401 errors in console
- ✅ No Paystack CSS errors in console
- ✅ Payment verified successfully
- ✅ Group created with you as admin
- ✅ Redirected to group details page

## What Changed in the Code

### Authentication Flow (Before vs After)

**Before:**
```typescript
serve(async (req) => {
  // No authentication check
  const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
  // Process payment...
});
```

**After:**
```typescript
serve(async (req) => {
  // Verify authentication first
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  
  // Validate JWT token
  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  
  // Process payment for authenticated user
  console.log(`Request from authenticated user: ${user.id}`);
  // ...
});
```

### Security Improvements

1. **Authentication Required**: All payment verification requests must be authenticated
2. **JWT Validation**: Tokens are validated against Supabase auth
3. **User Logging**: Authenticated user IDs are logged for audit trail
4. **Clear Error Messages**: 401 errors include helpful messages for debugging

## Troubleshooting

### Issue: Still getting 401 errors after deployment

**Causes:**
1. Function not deployed
2. User not logged in
3. JWT token expired

**Solutions:**
```bash
# 1. Verify deployment
supabase functions list

# 2. Check function logs
supabase functions logs verify-payment --tail

# 3. Redeploy if needed
supabase functions deploy verify-payment
```

### Issue: Paystack CSS error still appears

**Causes:**
1. Vercel deployment not complete
2. Browser cache

**Solutions:**
1. Wait for Vercel deployment to complete
2. Hard refresh browser (Ctrl+Shift+R)
3. Test in incognito window

### Issue: "Authentication required" message

**This is expected** if the user is not logged in. The error message helps users understand what went wrong.

**Solution:** Ensure user is logged in before attempting payment.

## Monitoring

### Watch Function Logs

```bash
# Monitor verify-payment function in real-time
supabase functions logs verify-payment --tail

# Get last 100 log entries
supabase functions logs verify-payment --limit 100
```

### What to Look For

**Successful Request:**
```
Request from authenticated user: 12345678-1234-1234-1234-123456789abc
===== PAYMENT VERIFICATION START =====
Reference: GRP_CREATE_abc123_def456
Verifying payment with Paystack: GRP_CREATE_abc123_def456
Paystack verification successful
Payment status: success
Payment amount: 500000
```

**Authentication Failure:**
```
Authentication failed: Invalid JWT
```

**Missing Auth Header:**
```
Missing authorization header
```

## Summary

### What Was Fixed
- ✅ Added authentication validation to Edge Function
- ✅ Added CSP headers for Paystack resources
- ✅ Improved error messages for debugging

### What Needs to Be Done
- ⚠️ Deploy Edge Function to Supabase (REQUIRED)
- ⚠️ Test end-to-end payment flow
- ⚠️ Monitor function logs for any issues

### Expected Outcome
After deployment:
- No more 401 Unauthorized errors
- No more Paystack CSS CORS warnings
- Smooth payment verification flow
- Better error messages for debugging

---

**Last Updated:** January 12, 2026  
**Status:** Code fixed, deployment required  
**Priority:** HIGH - Blocking production payments
