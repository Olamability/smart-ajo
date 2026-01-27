# Payment Integration Troubleshooting Guide

This guide helps you diagnose and fix common issues with the Paystack payment integration.

## Quick Diagnostic

Run these commands to quickly identify issues:

```bash
# 1. Check Edge Functions deployment
./check-edge-functions.sh

# 2. Check environment variables
grep "VITE_PAYSTACK_PUBLIC_KEY" .env.development

# 3. Check Supabase secrets
supabase secrets list

# 4. Check Edge Function logs
supabase functions logs verify-payment --limit 10

# 5. Run setup verification
./verify-payment-setup.sh
```

## Issue 1: Payment Initialization Fails

**Symptoms:**
- Error: "Paystack public key not configured"
- Payment button doesn't open Paystack popup
- Console error about missing configuration

**Cause:**
`VITE_PAYSTACK_PUBLIC_KEY` not set in `.env.development`

**Solution:**
```bash
# 1. Edit .env.development
nano .env.development

# 2. Add or update:
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_key_here

# 3. Restart dev server
npm run dev
```

**Verification:**
- Paystack popup should open
- No console errors about missing key
- Browser console shows: "[Paystack] Script loaded successfully"

---

## Issue 2: Payment Verification Fails with 404

**Symptoms:**
- Payment completes on Paystack
- Redirects to success page
- Shows "Payment verification failed"
- Console shows 404 error for verify-payment endpoint

**Cause:**
Edge Functions not deployed to Supabase

**Solution:**
```bash
# Deploy Edge Functions
./deploy-payment-system.sh

# Or manually:
supabase functions deploy verify-payment --no-verify-jwt
supabase functions deploy paystack-webhook --no-verify-jwt
```

**Verification:**
```bash
# Should return 204 (not 404)
./check-edge-functions.sh
```

---

## Issue 3: Payment Verification Fails with "Server configuration error"

**Symptoms:**
- Payment completes on Paystack
- Verification returns "Server configuration error"
- Edge Function logs show "PAYSTACK_SECRET_KEY not configured"

**Cause:**
Paystack secret key not set in Supabase secrets

**Solution:**
```bash
# Set the secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_key_here

# Verify it's set
supabase secrets list
```

**Verification:**
- `supabase secrets list` shows `PAYSTACK_SECRET_KEY`
- Payment verification succeeds

---

## Issue 4: Payment Succeeds but Member Not Activated

**Symptoms:**
- Payment verification returns success
- User not shown as group member
- `has_paid_security_deposit` still false
- Status still "pending" instead of "active"

**Cause:**
Business logic error in payment processor

**Debug Steps:**

1. **Check Edge Function logs:**
   ```bash
   supabase functions logs verify-payment --limit 50
   ```

2. **Look for these log entries:**
   - ✅ "Business logic execution complete: SUCCESS"
   - ❌ "Failed to add member"
   - ❌ "Failed to update member payment status"

3. **Check specific error messages:**
   ```bash
   supabase functions logs verify-payment | grep -i "error\|failed"
   ```

**Possible Causes:**

**a) Database Permission Issue**
- Check RLS policies on `group_members` table
- Verify service role can update records

**b) Member Already Exists**
- Check if user is already a member
- Verify idempotency logic

**c) Group Not Found**
- Verify group ID in payment metadata
- Check group exists in database

**Solution:**
```bash
# Check database directly
supabase db pull

# Verify payment record
SELECT * FROM payments WHERE reference = 'YOUR_REFERENCE';

# Verify member record
SELECT * FROM group_members WHERE user_id = 'USER_ID' AND group_id = 'GROUP_ID';

# Check logs for specific error
supabase functions logs verify-payment --limit 100 | grep "reference_here"
```

---

## Issue 5: Session Expired During Verification

**Symptoms:**
- Error: "Session expired. Please refresh the page."
- Payment completed but verification failed
- User must refresh to retry

**Cause:**
JWT token expired while payment was processing (user took too long)

**Solution:**
1. **For users:**
   - Refresh the page
   - Payment will still be verified by webhook

2. **For developers:**
   - This is expected behavior
   - Webhook ensures payment is still processed
   - Verify webhook is configured and working

**Verification:**
```bash
# Check webhook logs
supabase functions logs paystack-webhook --limit 20

# Look for successful processing of same reference
```

**Prevention:**
- Webhook acts as backup processor
- No manual intervention needed

---

## Issue 6: CORS Errors

**Symptoms:**
- Console error: "blocked by CORS policy"
- Preflight request fails
- Edge Function not accessible from frontend

**Cause:**
Edge Functions not properly deployed or CORS headers missing

**Solution:**
```bash
# 1. Redeploy Edge Functions
./deploy-payment-system.sh

# 2. Verify CORS headers
curl -X OPTIONS \
  'https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment' \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: POST' \
  -i
```

**Expected Response:**
```
HTTP/2 204
access-control-allow-origin: *
access-control-allow-headers: authorization, x-client-info, apikey, content-type
access-control-allow-methods: POST, OPTIONS
```

---

## Issue 7: Payment Completes but No Redirect

**Symptoms:**
- Payment completes on Paystack
- Modal closes but nothing happens
- No redirect to success page

**Cause:**
`callback_url` not properly configured or `VITE_APP_URL` incorrect

**Debug:**
1. **Check environment variable:**
   ```bash
   grep VITE_APP_URL .env.development
   # Should be: http://localhost:3000 (or your actual dev URL)
   ```

2. **Check payment initialization:**
   - Browser console should show callback URL
   - Should be: `http://localhost:3000/payment/success?reference=...&group=...`

**Solution:**
```bash
# Update .env.development
VITE_APP_URL=http://localhost:3000

# Restart dev server
npm run dev
```

---

## Issue 8: Webhook Not Receiving Events

**Symptoms:**
- Payments complete but webhook never called
- Webhook logs empty
- No backup processing happening

**Cause:**
Webhook not configured in Paystack dashboard

**Solution:**
1. Go to Paystack Dashboard → Settings → Webhooks
2. Add webhook URL: `https://YOUR_PROJECT.supabase.co/functions/v1/paystack-webhook`
3. Save and test

**Verification:**
```bash
# Check webhook logs after payment
supabase functions logs paystack-webhook --limit 10

# Should see: "=== WEBHOOK RECEIVED ==="
```

**Test Webhook:**
- Paystack Dashboard → Webhooks → Send Test Event
- Check logs for received event

---

## Issue 9: Multiple Members Added for Same Payment

**Symptoms:**
- User appears multiple times as group member
- Duplicate contribution records
- Multiple transaction records

**Cause:**
Idempotency check not working

**Debug:**
```bash
# Check payment record
SELECT * FROM payments WHERE reference = 'YOUR_REF';

# Check if verified = true
# If true but duplicates exist, idempotency logic failed

# Check member records
SELECT * FROM group_members 
WHERE user_id = 'USER_ID' AND group_id = 'GROUP_ID';
```

**Solution:**
- Payment processor has built-in idempotency
- If duplicates exist, manually clean up:
  ```sql
  -- Keep only the first record, delete duplicates
  DELETE FROM group_members 
  WHERE id NOT IN (
    SELECT MIN(id) 
    FROM group_members 
    GROUP BY user_id, group_id
  );
  ```

---

## Issue 10: Test Card Doesn't Work

**Symptoms:**
- Test card rejected
- Payment fails with "card declined" or similar

**Cause:**
Using wrong test card or wrong details

**Solution:**
Use exact test card details:

**Success Card:**
- Number: `4084084084084081`
- CVV: `123`
- Expiry: `12/25`
- PIN: `1234`
- OTP: `123456`

**Failed Card (for testing failures):**
- Number: `4084084084084099`
- Same other details

**Important:**
- Must use exact numbers
- Must follow PIN and OTP prompts
- Paystack test mode must be enabled

---

## Debugging Workflow

When encountering any payment issue:

1. **Check Edge Functions status:**
   ```bash
   ./check-edge-functions.sh
   ```

2. **Check environment configuration:**
   ```bash
   ./verify-payment-setup.sh
   ```

3. **Check Edge Function logs:**
   ```bash
   supabase functions logs verify-payment --limit 50
   ```

4. **Check browser console:**
   - Open DevTools → Console
   - Look for payment-related errors
   - Note any failed network requests

5. **Check payment record:**
   ```sql
   SELECT * FROM payments WHERE reference = 'YOUR_REF';
   ```

6. **Check member record:**
   ```sql
   SELECT * FROM group_members WHERE user_id = 'USER_ID' AND group_id = 'GROUP_ID';
   ```

---

## Getting Help

If issues persist:

1. **Collect information:**
   - Payment reference
   - Edge Function logs
   - Browser console logs
   - Database query results

2. **Check documentation:**
   - `PAYMENT_INTEGRATION_README.md`
   - `PAYSTACK_INTEGRATION_DEPLOYMENT.md`
   - This troubleshooting guide

3. **Review code:**
   - `src/api/payments.ts`
   - `supabase/functions/verify-payment/index.ts`
   - `supabase/functions/_shared/payment-processor.ts`

4. **Common fixes:**
   - Redeploy Edge Functions
   - Restart dev server
   - Clear browser cache
   - Check all environment variables

---

## Prevention Checklist

To avoid common issues:

- [ ] Run `./deploy-payment-system.sh` before testing
- [ ] Set all environment variables correctly
- [ ] Configure Paystack webhook URL
- [ ] Use exact test card details
- [ ] Monitor Edge Function logs regularly
- [ ] Test both success and failure scenarios
- [ ] Verify idempotency works (retry same payment)
- [ ] Test webhook by closing browser mid-payment

---

## Quick Reference Commands

```bash
# Deploy everything
./deploy-payment-system.sh

# Check deployment
./check-edge-functions.sh

# Verify setup
./verify-payment-setup.sh

# View logs
supabase functions logs verify-payment --limit 50
supabase functions logs paystack-webhook --limit 50

# Set secret
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...

# List secrets
supabase secrets list

# Restart dev server
npm run dev

# Run linter
npm run lint

# Build for production
npm run build
```
