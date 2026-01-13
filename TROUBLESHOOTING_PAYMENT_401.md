# Troubleshooting Payment Verification 401 Error

## Problem Statement

You're seeing these errors:
1. **CSP Warnings** (Console): `The source list for Content Security Policy directive 'script-src-elem' contains a source with an invalid path: '/v2.22/fingerprint?MerchantId=...'`
2. **401 Error**: `Failed to load resource: the server responded with a status of 401 ()` when calling the verify-payment Edge Function

## Quick Answer

**Q: Is it a callback URL issue?**  
**A:** No, callback URLs are not involved in Edge Function authentication.

**Q: Do I need to add service role key?**  
**A:** No, you should NOT use the service role key in the frontend. The Edge Function already has access to it via environment variables.

## What's Actually Wrong

### Issue 1: CSP Warnings (✅ FIXED)

**What it is:** Paystack's fraud detection system loads a fingerprint script with query parameters, which CSP treats as invalid.

**Status:** Fixed by adding `https://*.paystack.co` to the Content Security Policy in `vercel.json`.

**Impact:** These were just warnings and didn't break functionality. The fix eliminates the console noise.

### Issue 2: 401 Unauthorized Error

**What it is:** The Edge Function requires authentication but isn't receiving valid credentials.

**Possible Causes:**

1. **User not logged in** (Most common)
2. **Session expired** 
3. **Edge Function not deployed with authentication code**
4. **Missing PAYSTACK_SECRET_KEY in Edge Function environment**

## How to Fix the 401 Error

### Step 1: Verify User is Logged In

Before making a payment, ensure the user is authenticated:

```typescript
const { data: { session } } = await supabase.auth.getSession();

if (!session) {
  toast.error('Please log in to continue');
  navigate('/login');
  return;
}
```

The code already does this in `src/api/payments.ts:verifyPayment()`.

### Step 2: Verify Edge Function is Deployed

Check that the `verify-payment` Edge Function is deployed with the latest authentication code:

```bash
# Login to Supabase CLI
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# List deployed functions
supabase functions list

# Should show:
# ┌──────────────────┬────────┬─────────────────────┐
# │ NAME             │ STATUS │ CREATED AT          │
# ├──────────────────┼────────┼─────────────────────┤
# │ verify-payment   │ ACTIVE │ 2026-01-XX XX:XX:XX │
# └──────────────────┴────────┴─────────────────────┘
```

If not listed or status is not ACTIVE, deploy it:

```bash
supabase functions deploy verify-payment
```

### Step 3: Verify PAYSTACK_SECRET_KEY is Set

The Edge Function needs your Paystack secret key to verify payments with Paystack's API:

```bash
# List secrets (doesn't show values, only names)
supabase secrets list

# Should include:
# - PAYSTACK_SECRET_KEY
# - SUPABASE_SERVICE_ROLE_KEY (auto-configured)
# - SUPABASE_URL (auto-configured)
```

If `PAYSTACK_SECRET_KEY` is missing, set it:

```bash
# For test mode (development)
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here

# For production
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_secret_key_here
```

**Important:** After setting secrets, you must redeploy the function:

```bash
supabase functions deploy verify-payment
```

### Step 4: Test the Edge Function

Test with curl to verify authentication is working:

```bash
# Get your user JWT token from browser console:
# 1. Open browser DevTools (F12)
# 2. Go to Application/Storage → Local Storage
# 3. Find key like `sb-xxx-auth-token`
# 4. Copy the `access_token` value

# Test the Edge Function
curl -X POST \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/verify-payment' \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reference": "test_reference"}'

# Expected response (not 401):
# {"success":false,"payment_status":"verification_failed",...}
# (It fails because test_reference doesn't exist, but it's authenticated!)
```

### Step 5: Check Edge Function Logs

View logs to see exactly why authentication is failing:

```bash
# Watch logs in real-time
supabase functions logs verify-payment --tail

# Or get last 50 entries
supabase functions logs verify-payment --limit 50
```

Look for these messages:

- ✅ **Success:** `Request from authenticated user: user-id-here`
- ❌ **Missing header:** `Missing authorization header`
- ❌ **Invalid token:** `Authentication failed: Invalid JWT` or `Invalid or expired authentication token`

## Understanding the Authentication Flow

### What SHOULD Happen (Correct Flow)

1. **User logs in** → Supabase creates session with JWT token
2. **User initiates payment** → Paystack payment modal opens
3. **Payment succeeds** → Paystack calls your callback
4. **Frontend calls Edge Function** → Includes `Authorization: Bearer <jwt_token>` header
5. **Edge Function validates token** → Calls `supabase.auth.getUser(jwt)`
6. **If valid** → Proceeds to verify payment with Paystack
7. **If invalid** → Returns 401 with error message

### What's Happening in Your Code

The frontend code in `src/api/payments.ts` already implements this correctly:

```typescript
// Get session
const { data: { session } } = await supabase.auth.getSession();

if (!session?.access_token) {
  return {
    success: false,
    message: 'Authentication required. Please log in again.',
    error: 'No active session',
  };
}

// Call Edge Function with explicit auth header
const { data, error } = await supabase.functions.invoke('verify-payment', {
  body: { reference },
  headers: {
    Authorization: `Bearer ${session.access_token}`,
  },
});
```

## Common Misconceptions

### ❌ WRONG: "I need to use service role key in frontend"

**NO!** Never put the service role key in your frontend code or environment variables. It has full admin access and would expose your database to attacks.

The service role key is only used in the Edge Function (backend) where it's safe:
- ✅ Edge Function: `SUPABASE_SERVICE_ROLE_KEY` (auto-configured by Supabase)
- ❌ Frontend: Should NEVER have service role key

### ❌ WRONG: "I need to configure callback URLs"

Callback URLs are for OAuth flows (like Google/GitHub login), not for Edge Function authentication.

Your Edge Function uses **JWT tokens** from the current user session, not OAuth callbacks.

### ❌ WRONG: "The payment callback URL is wrong"

The Paystack payment callback is a **JavaScript function**, not a URL:

```typescript
paystackService.paySecurityDeposit(
  email,
  amount,
  groupId,
  userId,
  async (response) => {
    // This callback executes in the browser
    // It then calls the Edge Function to verify
    await verifyPayment(response.reference);
  }
);
```

No URL configuration needed for this.

## Debug Checklist

Work through this checklist to diagnose your issue:

- [ ] **User is logged in**
  ```typescript
  const { data: { user } } = await supabase.auth.getUser();
  console.log('Current user:', user); // Should not be null
  ```

- [ ] **Session token exists**
  ```typescript
  const { data: { session } } = await supabase.auth.getSession();
  console.log('Access token:', session?.access_token); // Should be a long JWT string
  ```

- [ ] **Edge Function is deployed**
  ```bash
  supabase functions list
  # verify-payment should show STATUS: ACTIVE
  ```

- [ ] **PAYSTACK_SECRET_KEY is set**
  ```bash
  supabase secrets list
  # Should include PAYSTACK_SECRET_KEY
  ```

- [ ] **Edge Function receives auth header**
  ```bash
  supabase functions logs verify-payment --tail
  # Look for "Request from authenticated user" (success)
  # OR "Missing authorization header" (failure)
  ```

- [ ] **JWT token is valid**
  ```bash
  # Check logs for "Authentication failed" or "Invalid JWT"
  # If you see this, user session may have expired
  ```

## Testing Payment Flow

### Test Payment with Debug Logging

1. Open browser console (F12)
2. Go to Create Group page
3. Fill in details and click Create & Pay
4. Watch console logs:

```
Verifying payment with reference: GRP_CREATE_xxx (attempt 1/3)
Edge Function response: { data: {...}, error: null }
Payment verification successful
```

If you see a 401 error, check the logs:
```
Edge Function response: { data: null, error: {message: "Edge Function returned..."} }
Payment verification error: FunctionsHttpError
```

### Test with Paystack Test Card

Use Paystack's test card to avoid real charges:

- **Card Number:** `4084084084084081`
- **Expiry:** Any future date (e.g., `12/25`)
- **CVV:** Any 3 digits (e.g., `123`)
- **PIN:** `0000`

## What If It Still Doesn't Work?

### Scenario 1: "Missing authorization header"

**Problem:** Frontend isn't sending the auth header

**Check:**
1. Is `src/api/payments.ts` deployed with the latest code?
2. Build and redeploy frontend: `npm run build` and deploy to Vercel

### Scenario 2: "Authentication failed: Invalid JWT"

**Problem:** Token is expired or invalid

**Solutions:**
1. Refresh the page to get a new session
2. Log out and log back in
3. Check token expiry settings in Supabase Dashboard → Authentication → Settings

### Scenario 3: "Paystack verification failed"

**Problem:** Payment verification succeeded, but Paystack API call failed

**Check:**
1. Is PAYSTACK_SECRET_KEY correct? (Test vs Live)
2. Is the key for the right environment?
   - Test key: `sk_test_...`
   - Live key: `sk_live_...`
3. Check Edge Function logs for Paystack API errors

### Scenario 4: Everything looks fine, but still 401

**Last resort:**
1. Clear browser cache and localStorage
2. Log out completely
3. Log back in
4. Try payment again

## Getting Help

If you've gone through this guide and still have issues, provide these details:

1. **Edge Function logs:**
   ```bash
   supabase functions logs verify-payment --limit 20
   ```

2. **Browser console output** (with error stack trace)

3. **What you've already tried** from this guide

4. **Environment:** Development (local) or Production (deployed)

## Summary

### The Actual Issue

Most likely:
1. ✅ **CSP Warnings:** Fixed by adding `https://*.paystack.co` to CSP
2. ❓ **401 Error:** Either Edge Function not deployed, PAYSTACK_SECRET_KEY not set, or user session expired

### What You DON'T Need

- ❌ Service role key in frontend
- ❌ Callback URL configuration
- ❌ Additional authentication setup

### What You DO Need

- ✅ Deploy the Edge Function: `supabase functions deploy verify-payment`
- ✅ Set Paystack secret: `supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...`
- ✅ Ensure user is logged in before payment

---

**Last Updated:** 2026-01-13  
**Related Docs:**
- [PAYMENT_VERIFICATION_401_FIX.md](./PAYMENT_VERIFICATION_401_FIX.md) - Detailed fix documentation
- [EDGE_FUNCTIONS_SETUP.md](./EDGE_FUNCTIONS_SETUP.md) - Edge Functions configuration
- [PAYMENT_VERIFICATION_TESTING_GUIDE.md](./PAYMENT_VERIFICATION_TESTING_GUIDE.md) - Testing guide
