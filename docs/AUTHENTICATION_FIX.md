# Authentication Error Fix - Payment Verification

## Issue Summary

Users were experiencing authentication errors during payment verification with the error:

```
Authentication error detected after proactive session refresh
Edge Function returned a non-2xx status code (401 Unauthorized)
Your session has expired. Please log out and log in again, then try the payment.
```

## Root Cause Analysis

### The Problem

The issue was a **race condition** in how the Supabase client handles session refresh and propagation:

1. **Session Refresh Called**: `supabase.auth.refreshSession()` successfully refreshed the user's session
2. **New Client Created**: Code created a new Supabase client using `createClient()` from `@supabase/ssr`
3. **Storage Propagation Delay**: The refreshed session wasn't immediately available in the browser storage (localStorage/cookies)
4. **Missing/Old Token Sent**: When `freshSupabase.functions.invoke()` was called, it sent either:
   - The old expired token
   - No token at all
   - A token that hadn't propagated to storage yet
5. **Backend Rejected**: The Edge Function validated the JWT and returned 401 Unauthorized

### Technical Details

The `createBrowserClient` from `@supabase/ssr` reads session state from browser storage. When you call:

```typescript
const { data: refreshData } = await supabase.auth.refreshSession();
const freshSupabase = createClient(); // ❌ New client may not have refreshed token yet
```

There's a timing issue where:
- The session is refreshed in memory
- But the storage update happens asynchronously
- The new client reads from storage before the update completes

## Solution

### Frontend Changes (`src/api/payments.ts`)

**Before:**
```typescript
// Recreate client after refresh
const freshSupabase = createClient();

// Call Edge Function (relies on automatic session)
const { data, error } = await freshSupabase.functions.invoke('verify-payment', {
  body: { reference },
});
```

**After:**
```typescript
// Get the access token directly from the refreshed session
const accessToken = activeSession.access_token;

// Explicitly pass the token in the Authorization header
const { data, error } = await supabase.functions.invoke('verify-payment', {
  body: { reference },
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});
```

### Backend Changes (`supabase/functions/verify-payment/index.ts`)

Enhanced logging to detect and diagnose authorization issues:

```typescript
console.log('Authorization header present:', !!authHeader);
console.log('Authorization header format valid:', authHeader?.startsWith('Bearer ') || false);

if (!authHeader) {
  console.error('CRITICAL: Missing authorization header');
  console.error('Available request headers:', Array.from(req.headers.entries()).map(([k]) => k).join(', '));
  console.error('This suggests the frontend did not pass the Authorization header');
  // Return 401...
}
```

## Benefits of This Fix

1. **Eliminates Race Condition**: The access token is taken directly from the session object, not from storage
2. **Immediate Availability**: Token is available immediately after refresh, no waiting for storage sync
3. **Explicit Control**: We control exactly which token gets sent to the Edge Function
4. **Better Debugging**: Enhanced logging helps diagnose future auth issues
5. **More Reliable**: No dependency on storage propagation timing

## How Session Management Works Now

### 1. Payment Initiation
```typescript
// User initiates payment
const paymentData = await initializeGroupCreationPayment(groupData);
// Paystack modal opens, user completes payment
```

### 2. Payment Verification (Critical Path)

```typescript
// Step 1: Proactively refresh session
const { data: refreshData } = await supabase.auth.refreshSession();
const activeSession = refreshData.session; // Or fallback to current if refresh fails

// Step 2: Extract token directly from session object
const accessToken = activeSession.access_token;

// Step 3: Call Edge Function with explicit token
const { data, error } = await supabase.functions.invoke('verify-payment', {
  body: { reference },
  headers: {
    Authorization: `Bearer ${accessToken}`, // 🔑 Explicit token passing
  },
});
```

### 3. Backend Validation

```typescript
// Edge Function extracts token
const authHeader = req.headers.get('Authorization');
const jwt = authHeader.replace('Bearer ', '');

// Validate with Supabase auth
const { data: { user }, error } = await supabase.auth.getUser(jwt);

if (error || !user) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
}

// User authenticated, proceed with payment verification...
```

## Testing Recommendations

To verify this fix works:

1. **Test Normal Flow**: 
   - Create/join group with payment
   - Verify payment completes successfully
   - Check console logs for "Access token available: true"

2. **Test Session Expiry**:
   - Open app, leave idle for ~1 hour (session near expiry)
   - Attempt payment
   - Session refresh should work automatically
   - Payment should succeed

3. **Test Edge Cases**:
   - Network interruptions during payment
   - Multiple rapid payment attempts
   - Browser refresh during payment flow

## Monitoring & Logging

### Frontend Logs to Watch For

✅ **Success Indicators:**
```
Proactively refreshing session before verification...
Session refreshed successfully
Access token available: true Length: 450
Calling Edge Function with explicit authorization...
Edge Function response received: { hasData: true, hasError: false }
```

❌ **Failure Indicators:**
```
Authentication error detected despite explicit token passing
Session state: { hasSession: true, isExpired: true }
```

### Backend Logs to Watch For

✅ **Success Indicators:**
```
=== AUTH CHECK START ===
Authorization header present: true
Authorization header format valid: true
JWT token extracted. Length: 450
Request from authenticated user: <user-id>
=== AUTH CHECK PASSED ===
```

❌ **Failure Indicators:**
```
CRITICAL: Missing authorization header
Available request headers: content-type, accept, ...
```

## Security Considerations

1. **Token Never Logged**: We log token length, never the actual token value
2. **HTTPS Required**: Tokens are only sent over HTTPS in production
3. **Short-Lived Tokens**: Supabase JWTs expire after 1 hour by default
4. **No Token Storage**: We don't store tokens, we get them fresh from the session
5. **Service Role Separation**: Edge Function uses service role for DB operations, not user token

## Related Files

- `/src/api/payments.ts` - Payment verification with explicit token passing
- `/supabase/functions/verify-payment/index.ts` - Backend validation and logging
- `/src/lib/client/supabase.ts` - Supabase client factory
- `/src/pages/GroupDetailPage.tsx` - Payment flow UI

## Migration Notes

No migration needed. This is a backward-compatible fix:
- Frontend now explicitly passes token
- Backend already accepted Authorization headers
- No database schema changes required
- No API contract changes

## Future Improvements

1. **Retry Logic**: Already implemented (3 retries with exponential backoff)
2. **Session Monitoring**: Could add proactive session refresh before expiry
3. **Error Analytics**: Could track auth error frequency to detect issues early
4. **Token Refresh Strategy**: Could implement automatic token refresh on 401 errors
