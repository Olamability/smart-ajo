# Edge Functions CORS Fix

## Problem

When calling Supabase Edge Functions from the Vercel-deployed frontend, users encounter this CORS error:

```
Access to fetch at 'https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/verify-payment' 
from origin 'https://smart-ajo.vercel.app' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: 
It does not have HTTP ok status.
```

Followed by:

```
POST https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/verify-payment net::ERR_FAILED
Payment verification error: FunctionsFetchError: Failed to send a request to the Edge Function
```

## Root Cause

The CORS error occurs due to two main reasons:

1. **Edge Function Not Deployed**: The Edge Function might not be deployed to Supabase production
2. **CORS Preflight Response**: The OPTIONS preflight request needs to return a 204 status code (not 200) with no body for optimal compatibility

## Solution

### Part 1: Fix CORS Headers in Edge Function

The `verify-payment` Edge Function has been updated with:

1. **Added `Access-Control-Max-Age` header**: Caches preflight responses for 24 hours
2. **Changed OPTIONS response**: Returns 204 (No Content) instead of 200 (OK)
3. **Removed response body**: OPTIONS should return null body

**Changes made to `/supabase/functions/verify-payment/index.ts`:**

```typescript
// Before
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// After
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
};
```

```typescript
// Before
if (req.method === 'OPTIONS') {
  return new Response('ok', { 
    status: 200,
    headers: corsHeaders 
  });
}

// After
if (req.method === 'OPTIONS') {
  return new Response(null, { 
    status: 204, // No Content is standard for OPTIONS
    headers: corsHeaders 
  });
}
```

### Part 2: Deploy Edge Function to Supabase

**CRITICAL**: Edge Functions must be deployed to Supabase for them to work in production.

#### Prerequisites

1. **Install Supabase CLI:**
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase:**
   ```bash
   supabase login
   ```

3. **Link your project:**
   ```bash
   supabase link --project-ref kvxokszuonvdvsazoktc
   ```
   
   Replace `kvxokszuonvdvsazoktc` with your actual Supabase project reference ID.

#### Deploy the verify-payment Function

```bash
# Deploy the verify-payment function
supabase functions deploy verify-payment

# Verify deployment
supabase functions list
```

Expected output:
```
┌──────────────────┬───────────┬────────────────────────┬─────────┐
│ NAME             │ STATUS    │ CREATED AT             │ VERSION │
├──────────────────┼───────────┼────────────────────────┼─────────┤
│ verify-payment   │ ACTIVE    │ 2026-01-12 11:30:00    │ 1       │
│ paystack-webhook │ ACTIVE    │ 2026-01-10 10:00:00    │ 1       │
│ send-email       │ ACTIVE    │ 2026-01-08 09:00:00    │ 1       │
└──────────────────┴───────────┴────────────────────────┴─────────┘
```

#### Configure Environment Secrets

The Edge Function requires these secrets:

```bash
# Set Paystack secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here

# Verify SUPABASE_URL is set (auto-configured usually)
supabase secrets list
```

Expected secrets:
- `PAYSTACK_SECRET_KEY` ✅
- `SUPABASE_SERVICE_ROLE_KEY` ✅ (auto-configured)
- `SUPABASE_URL` ✅ (auto-configured)

### Part 3: Update Other Edge Functions (Optional but Recommended)

Apply the same CORS fix to other Edge Functions for consistency:

#### Update send-email Function

```bash
# Edit supabase/functions/send-email/index.ts
# Add 'Access-Control-Max-Age': '86400' to corsHeaders
# Change OPTIONS response to status 204 with null body
```

#### Update verify-bvn Function

```bash
# Edit supabase/functions/verify-bvn/index.ts
# Add 'Access-Control-Max-Age': '86400' to corsHeaders
# Change OPTIONS response to status 204 with null body
```

#### Update paystack-webhook Function

The webhook function doesn't need CORS since it's called by Paystack servers, not the browser. No changes needed.

## Verification Steps

After deploying the Edge Function:

### 1. Check Edge Function Status

```bash
supabase functions list
```

Ensure `verify-payment` shows as `ACTIVE`.

### 2. Test Edge Function Directly

```bash
curl -X POST \
  'https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/verify-payment' \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reference": "test_reference"}'
```

You should get a response (even if it says payment not found, that's OK - it means the function is working).

### 3. Test CORS Preflight

```bash
curl -X OPTIONS \
  'https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/verify-payment' \
  -H "Origin: https://smart-ajo.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, content-type" \
  -v
```

Expected response:
```
< HTTP/2 204
< access-control-allow-origin: *
< access-control-allow-headers: authorization, x-client-info, apikey, content-type
< access-control-allow-methods: POST, OPTIONS
< access-control-max-age: 86400
```

### 4. Test from Browser

1. Open your Vercel-deployed app: `https://smart-ajo.vercel.app`
2. Navigate to Create Group page
3. Fill in details and try to create a group with payment
4. Check browser console for errors
5. **Should work**: Payment modal opens and verification succeeds
6. **Should NOT see**: CORS errors

## Troubleshooting

### Issue 1: "Edge Function not found"

**Cause**: Function not deployed

**Solution**:
```bash
supabase functions deploy verify-payment
```

### Issue 2: "PAYSTACK_SECRET_KEY not configured"

**Cause**: Secret not set in Supabase

**Solution**:
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_key
```

### Issue 3: CORS error persists after deployment

**Cause**: Browser cache or preflight cache

**Solution**:
1. Clear browser cache
2. Try in incognito/private window
3. Wait for Access-Control-Max-Age to expire (24 hours)
4. Force refresh with Ctrl+F5

### Issue 4: "Project not linked"

**Cause**: Supabase CLI not linked to project

**Solution**:
```bash
# Get your project ref from Supabase dashboard URL
# URL format: https://supabase.com/dashboard/project/{PROJECT_REF}

supabase link --project-ref YOUR_PROJECT_REF
```

### Issue 5: "Permission denied"

**Cause**: Not logged in to Supabase CLI

**Solution**:
```bash
supabase login
```

## Complete Deployment Checklist

Use this checklist when deploying Edge Functions:

- [ ] Supabase CLI installed (`npm install -g supabase`)
- [ ] Logged in to Supabase (`supabase login`)
- [ ] Project linked (`supabase link --project-ref YOUR_REF`)
- [ ] PAYSTACK_SECRET_KEY secret set (`supabase secrets set`)
- [ ] verify-payment function deployed (`supabase functions deploy`)
- [ ] Deployment verified (`supabase functions list` shows ACTIVE)
- [ ] CORS preflight tested (curl -X OPTIONS)
- [ ] Function tested from browser
- [ ] No CORS errors in console
- [ ] Payment verification works end-to-end

## Understanding CORS

### What is CORS?

CORS (Cross-Origin Resource Sharing) is a security feature that browsers enforce. It prevents websites from making requests to different domains without permission.

### Why the Preflight Request?

For POST requests with JSON, browsers send an OPTIONS "preflight" request first to check if the server allows the actual request. The server must respond with appropriate CORS headers.

### Preflight Request Flow

```
1. Browser sees: POST to different domain
2. Browser sends: OPTIONS request (preflight)
3. Server responds: 204 with CORS headers
4. Browser sends: Actual POST request
5. Server responds: 200 with data + CORS headers
```

If step 3 fails (wrong status, missing headers), the browser blocks step 4.

### Why Status 204?

- **204 No Content**: Standard for OPTIONS responses
- **No response body**: Reduces bandwidth and processing
- **Better caching**: Browsers cache 204 responses better
- **Best practice**: Recommended by W3C and MDN

## Alternative: Use Supabase RPC Instead

If Edge Function deployment is not possible, consider using Supabase RPC (Remote Procedure Call) with PostgreSQL functions:

**Pros**:
- No deployment needed
- Automatically handles CORS
- Better performance for simple operations

**Cons**:
- Cannot make external API calls (like Paystack)
- Limited to database operations
- Not suitable for verify-payment use case

For this application, Edge Functions are required because we need to call Paystack's API with the secret key.

## Related Documentation

- [Supabase Edge Functions Guide](https://supabase.com/docs/guides/functions)
- [CORS on MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - Complete deployment guide
- [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) - Vercel-specific guide

## Summary

1. ✅ **Updated CORS headers** in verify-payment Edge Function
2. ✅ **Changed OPTIONS response** from 200 to 204
3. ✅ **Added caching header** for preflight responses
4. 📝 **Must deploy** Edge Function to Supabase production
5. 📝 **Must configure** PAYSTACK_SECRET_KEY secret

After completing these steps, the CORS error will be resolved and payment verification will work from the Vercel-deployed application.

---

**Issue**: CORS error when calling verify-payment from Vercel
**Status**: ✅ Fixed (code updated, deployment required)
**Date**: January 12, 2026
**Action Required**: Deploy Edge Function to Supabase
