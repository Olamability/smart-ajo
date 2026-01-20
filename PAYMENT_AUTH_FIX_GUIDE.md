# Payment Authentication Fix Guide

## Problem Summary

The payment verification was failing with a 401 error:
- Error: "Token was not properly extracted from request"
- Despite the token being provided correctly from the frontend
- The Edge Function was unable to verify user authentication

## Root Cause

The Edge Function was incorrectly using a **service role client** to verify user JWT tokens:

```typescript
// INCORRECT approach (before fix)
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const result = await supabase.auth.getUser(jwt);
```

This doesn't work because:
- Service role clients are designed for privileged database operations
- They cannot properly verify user JWT tokens
- The authentication context is lost

## Solution

The fix implements the correct authentication pattern for Supabase Edge Functions:

1. **Create TWO separate clients**:
   - One with anon key + user JWT for authentication
   - One with service role for database operations

2. **Use the proper authentication flow**:
   ```typescript
   // CORRECT approach (after fix)
   
   // 1. Client for authentication verification
   const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
     global: {
       headers: {
         Authorization: authHeader,
       },
     },
   });
   
   // 2. Verify user without passing JWT explicitly
   const result = await supabaseAuth.auth.getUser();
   
   // 3. Separate client for database operations
   const supabase = createClient(supabaseUrl, supabaseServiceKey);
   ```

## Deployment Steps

### 1. Set the SUPABASE_ANON_KEY Secret

The Edge Function now requires `SUPABASE_ANON_KEY` which is not automatically injected by Supabase. Set it as a secret:

```bash
# Get your anon key from Supabase Dashboard > Settings > API
# Or from your .env file (VITE_SUPABASE_ANON_KEY)

supabase secrets set SUPABASE_ANON_KEY=your_anon_key_here
```

### 2. Verify Other Secrets

Ensure all required secrets are set:

```bash
# List current secrets
supabase secrets list

# Set missing secrets if needed
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key
```

### 3. Deploy the Updated Edge Function

```bash
# Deploy using the deployment script
./deploy-edge-functions.sh verify-payment

# Or deploy manually
supabase functions deploy verify-payment --no-verify
```

### 4. Test the Fix

After deployment, test the payment flow:

1. Go to your app and try to create a group or join a group that requires payment
2. Complete the payment with Paystack
3. Verify that payment verification succeeds without 401 errors

## Expected Logs (Success)

After the fix, you should see these logs in the Edge Function:

```
=== AUTH CHECK START ===
Authorization header present: true
Authorization header format valid: true
JWT token extracted. Length: 994
Verifying JWT with Supabase auth...
Auth verification result: { hasUser: true, hasError: false, userId: "..." }
Request from authenticated user: <user_id>
=== AUTH CHECK PASSED ===
Service role client created for database operations
```

## Verification

To verify the fix is working:

1. **Check Edge Function logs**:
   ```bash
   supabase functions logs verify-payment
   ```

2. **Test payment verification**:
   - The 401 error should no longer appear
   - Authentication should pass successfully
   - Payment verification should complete

3. **Monitor for errors**:
   - No "Token was not properly extracted" errors
   - No "Invalid or expired authentication token" errors (unless actually expired)

## Files Changed

1. `supabase/functions/verify-payment/index.ts`
   - Added SUPABASE_ANON_KEY environment variable
   - Created separate auth client with anon key
   - Updated auth verification to use proper client
   - Kept service role client for database operations

2. `EDGE_FUNCTIONS_SETUP.md`
   - Added SUPABASE_ANON_KEY to environment variables
   - Added instructions for setting secrets

3. `deploy-edge-functions.sh`
   - Added reminder to set SUPABASE_ANON_KEY secret

## Troubleshooting

### Still getting 401 errors?

1. **Verify SUPABASE_ANON_KEY is set**:
   ```bash
   supabase secrets list
   ```
   You should see `SUPABASE_ANON_KEY` in the list.

2. **Check the anon key matches your project**:
   - Go to Supabase Dashboard > Settings > API
   - Copy the "anon public" key
   - Ensure it matches what you set as the secret

3. **Verify frontend is sending token**:
   - Check browser DevTools > Network tab
   - Look for the verify-payment request
   - Ensure Authorization header is present

4. **Check Edge Function logs**:
   ```bash
   supabase functions logs verify-payment --tail
   ```
   Look for detailed auth error messages.

### Token expired errors?

This is expected if the user's session has genuinely expired:
- User should log out and log in again
- Frontend handles this with appropriate error messages

## Architecture

The new authentication flow:

```
Frontend
  ↓ (sends user JWT in Authorization header)
Edge Function
  ↓ (creates anon client with user JWT)
Supabase Auth
  ↓ (verifies JWT and returns user)
Edge Function
  ↓ (creates service role client)
Database Operations
  ↓ (using elevated privileges)
Return Success
```

This pattern:
- ✅ Properly verifies user authentication
- ✅ Uses service role only for database operations
- ✅ Follows Supabase best practices
- ✅ Maintains security boundaries

## References

- [Supabase Edge Functions Authentication](https://supabase.com/docs/guides/functions/auth)
- [Supabase Client Authentication](https://supabase.com/docs/reference/javascript/auth-getuser)
- Payment verification implementation: `supabase/functions/verify-payment/index.ts`
