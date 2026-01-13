# Payment Verification 401 Error Fix - Testing & Deployment Guide

## Overview

This fix addresses two critical issues:
1. **401 Unauthorized Error** when verifying payments via Edge Function
2. **CSP Warnings** for Paystack fingerprint script in browser console

## What Was Fixed

### 1. Session Token Validation (`src/api/payments.ts`)

**Problem**: Using `auth.getSession()` alone retrieves the token from browser storage without validating it or refreshing if expired.

**Solution**: Call `auth.getUser()` first to:
- Validate the JWT token with Supabase server
- Trigger automatic token refresh if expired
- Ensure we have a valid session before calling Edge Function

**Code Changes**:
```typescript
// Before (WRONG - could use expired token)
const { data: { session } } = await supabase.auth.getSession();

// After (CORRECT - validates and refreshes token)
const { data: { user }, error: userError } = await supabase.auth.getUser();
// ... check user is valid ...
const { data: { session } } = await supabase.auth.getSession();
```

### 2. Enhanced Error Handling

**Added**: Specific detection and user-friendly messages for 401 errors:
```typescript
if (error.message.includes('401') || error.message.includes('Unauthorized')) {
  return {
    message: 'Your session has expired. Please log out and log in again, then try the payment.',
    // ...
  };
}
```

### 3. Content Security Policy Update (`vercel.json`)

**Added**: Comprehensive Paystack domain support:
- `https://*.paystack.co` for all Paystack CDN resources
- `https://checkout.paystack.com` explicitly for checkout flows
- `https://*.paystack.com` for additional Paystack services

This eliminates CSP warnings like:
```
The source list for Content Security Policy directive 'script-src-elem' contains a source with an invalid path: '/v2.22/fingerprint?MerchantId=...'
```

## Testing Checklist

### Prerequisites
- [ ] Supabase project is set up
- [ ] Edge Function `verify-payment` is deployed
- [ ] `PAYSTACK_SECRET_KEY` is set in Supabase secrets
- [ ] Frontend environment variables are configured:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_PAYSTACK_PUBLIC_KEY`

### Test Scenarios

#### Scenario 1: Fresh Session (Happy Path)
1. **Setup**: Log in as a new user
2. **Action**: Create a group and initiate payment
3. **Expected**:
   - Payment modal opens without CSP warnings
   - After successful payment, verification succeeds
   - User becomes group admin
   - No 401 errors in console

#### Scenario 2: Expired Session
1. **Setup**: 
   - Log in
   - Wait for session to expire (or manually clear refresh token)
   - Try to make a payment
2. **Expected**:
   - Clear error message: "Your session has expired. Please log out and log in again"
   - No confusing technical errors
   - User knows exactly what to do

#### Scenario 3: Network Retry
1. **Setup**: Throttle network to Slow 3G in DevTools
2. **Action**: Complete payment
3. **Expected**:
   - Multiple retry attempts visible in console
   - Eventually succeeds or provides clear timeout message
   - No 401 errors

#### Scenario 4: CSP Compliance
1. **Setup**: Open browser console (F12)
2. **Action**: Initiate any payment
3. **Expected**:
   - No CSP warnings about Paystack scripts
   - Paystack fingerprint script loads successfully
   - Payment modal displays correctly

### Manual Testing Steps

#### Step 1: Deploy Changes
```bash
# Build frontend
npm run build

# Deploy to Vercel (if using Vercel)
vercel --prod

# Or deploy however you normally deploy
```

#### Step 2: Test Payment Flow
1. Navigate to app
2. Open browser DevTools (F12) → Console tab
3. Log in with test account
4. Create a new group or join existing group
5. Click "Pay Now" or equivalent button
6. Complete payment with Paystack test card:
   - **Card**: 4084084084084081
   - **Expiry**: 12/25
   - **CVV**: 123
   - **PIN**: 0000
7. Watch console logs:
   ```
   Verifying payment with reference: GRP_CREATE_xxx (attempt 1/3)
   Edge Function response: { data: { success: true, ... }, error: null }
   Payment verification successful
   ```

#### Step 3: Verify No CSP Warnings
1. Clear console
2. Initiate payment again
3. Look for CSP warnings (should be ZERO):
   - ❌ OLD: "The source list for Content Security Policy directive..."
   - ✅ NEW: No CSP warnings

#### Step 4: Test Error Handling
1. In DevTools → Application → Local Storage
2. Find `sb-xxx-auth-token` key
3. Modify the `access_token` value (make it invalid)
4. Try to make a payment
5. Expected: Clear error message about session expiry

### Automated Checks

#### Build Verification
```bash
cd /path/to/project
npm install
npm run build
```
Expected: No errors, build completes successfully

#### Lint Check
```bash
npm run lint
```
Expected: No errors (warnings are acceptable)

#### Type Check
```bash
npx tsc --noEmit
```
Expected: No type errors

## Edge Function Verification

### Check Edge Function is Deployed
```bash
# Login to Supabase CLI
supabase login

# Link to project
supabase link --project-ref YOUR_PROJECT_REF

# List functions
supabase functions list

# Should show verify-payment as ACTIVE
```

### View Edge Function Logs
```bash
# Real-time logs
supabase functions logs verify-payment --tail

# Or get recent logs
supabase functions logs verify-payment --limit 50
```

**Look for**:
- ✅ "Request from authenticated user: xxx" (Success)
- ❌ "Missing authorization header" (Problem)
- ❌ "Authentication failed" (Problem)

### Test Edge Function Directly
```bash
# Get your access token from browser (DevTools → Application → Local Storage)
# Look for: sb-xxx-auth-token → access_token

# Test the function
curl -X POST \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/verify-payment' \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reference": "test_ref"}'

# Expected: NOT 401
# Expected: {"success":false,"payment_status":"verification_failed",...}
# (Fails because test_ref doesn't exist, but it's AUTHENTICATED)
```

## Rollback Plan

If issues occur in production:

### Quick Rollback
```bash
# Revert the commits
git revert HEAD~2..HEAD

# Push
git push

# Redeploy
vercel --prod  # or your deployment method
```

### Manual Fix (if needed)
If `getUser()` causes issues, you can temporarily revert to the old method with a refresh:
```typescript
// In src/api/payments.ts, replace the session validation with:
const supabase = createClient();

// Try to refresh session first
const { data: { session: refreshedSession }, error: refreshError } = 
  await supabase.auth.refreshSession();

if (refreshError || !refreshedSession) {
  // Fall back to regular getSession
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.access_token) {
    return {
      success: false,
      message: 'Authentication required. Please log in again.',
      // ...
    };
  }
}
```

## Monitoring

### Key Metrics to Watch

1. **Payment Verification Success Rate**
   - Target: > 98%
   - Monitor: Supabase Database → `payments` table
   ```sql
   SELECT 
     COUNT(*) FILTER (WHERE verified = true) * 100.0 / COUNT(*) as success_rate
   FROM payments 
   WHERE created_at > NOW() - INTERVAL '24 hours';
   ```

2. **401 Error Rate**
   - Target: < 0.1%
   - Monitor: Edge Function logs for "Unauthorized" or "Authentication failed"

3. **CSP Violations**
   - Target: 0 CSP warnings related to Paystack
   - Monitor: Browser console in production

### Alert Thresholds

- **Critical**: Verification success rate drops below 95%
- **Warning**: More than 1% 401 errors over 15 minutes
- **Info**: Any CSP violations detected

## Troubleshooting

### Issue: Still Getting 401 Errors

**Check**:
1. Is the user actually logged in?
   ```typescript
   const { data: { user } } = await supabase.auth.getUser();
   console.log('User:', user); // Should not be null
   ```

2. Is the Edge Function deployed with latest code?
   ```bash
   supabase functions list
   # Check deploy timestamp
   ```

3. Are Edge Function secrets set?
   ```bash
   supabase secrets list
   # Should include PAYSTACK_SECRET_KEY
   ```

### Issue: CSP Warnings Still Appearing

**Check**:
1. Is the app loading the new `vercel.json` config?
   - Check browser Network tab → Response headers
   - Look for `Content-Security-Policy` header
   - Verify it includes `https://*.paystack.co`

2. Clear browser cache and hard reload (Ctrl+Shift+R)

3. Verify deployment included `vercel.json` changes:
   ```bash
   # Check what was deployed
   vercel inspect YOUR_DEPLOYMENT_URL
   ```

### Issue: "getUser() is taking too long"

If performance is impacted:
1. Check network latency to Supabase
2. Consider caching user validation (but keep token refresh)
3. May need to adjust timeout settings

## Support

If issues persist after following this guide:

1. **Collect Debug Info**:
   - Browser console output (with errors)
   - Edge Function logs (`supabase functions logs verify-payment --limit 50`)
   - Network tab showing the failed request
   - User session state (from DevTools → Application → Local Storage)

2. **Check Related Docs**:
   - [PAYMENT_VERIFICATION_401_FIX.md](./PAYMENT_VERIFICATION_401_FIX.md)
   - [TROUBLESHOOTING_PAYMENT_401.md](./TROUBLESHOOTING_PAYMENT_401.md)
   - [EDGE_FUNCTIONS_SETUP.md](./EDGE_FUNCTIONS_SETUP.md)

3. **Contact Supabase Support** (if Supabase-related):
   - Dashboard → Support
   - Include project ref and Edge Function logs

## Summary

### What's Fixed
- ✅ 401 Unauthorized errors due to expired/invalid sessions
- ✅ CSP warnings for Paystack scripts
- ✅ Better error messages for users
- ✅ Proper session validation and refresh

### What to Test
- ✅ Payment verification with fresh session
- ✅ Payment verification with expired session
- ✅ No CSP warnings in console
- ✅ Clear error messages when issues occur

### What to Monitor
- Payment verification success rate (target: >98%)
- 401 error rate (target: <0.1%)
- CSP violations (target: 0)
- User-reported payment issues

---

**Version**: 1.0.0  
**Date**: 2026-01-13  
**Status**: Ready for Testing  
**Author**: GitHub Copilot
