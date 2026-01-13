# Deployment Verification Checklist

This checklist helps verify that the CSP and payment verification fixes are properly deployed and working.

## Pre-Deployment Checklist

### Frontend Environment Variables

- [ ] **Development (.env or .env.development)**
  ```bash
  VITE_APP_URL=http://localhost:3000
  VITE_SUPABASE_URL=https://xxx.supabase.co
  VITE_SUPABASE_ANON_KEY=eyJ...
  VITE_PAYSTACK_PUBLIC_KEY=pk_test_...
  ```

- [ ] **Production (Vercel Environment Variables)**
  ```bash
  VITE_APP_URL=https://your-production-domain.com
  VITE_SUPABASE_URL=https://xxx.supabase.co
  VITE_SUPABASE_ANON_KEY=eyJ...
  VITE_PAYSTACK_PUBLIC_KEY=pk_live_...  # Use live key for production
  ```

### Backend Supabase Secrets

- [ ] **Check Existing Secrets**
  ```bash
  supabase login
  supabase link --project-ref YOUR_PROJECT_REF
  supabase secrets list
  ```
  
  Should show:
  - `PAYSTACK_SECRET_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_URL`

- [ ] **Set Missing Secrets** (if needed)
  ```bash
  # For testing
  supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...
  
  # For production (use your live secret key)
  supabase secrets set PAYSTACK_SECRET_KEY=sk_live_...
  ```

### Edge Function Deployment

- [ ] **Deploy Edge Function**
  ```bash
  cd /path/to/smart-ajo
  supabase functions deploy verify-payment
  ```

- [ ] **Verify Deployment**
  ```bash
  supabase functions list
  ```
  Should show: `verify-payment` with STATUS: ACTIVE

---

## Post-Deployment Verification

### 1. CSP Headers Verification

**Steps:**
1. Open your deployed app in browser
2. Open DevTools (F12) → Network tab
3. Reload the page
4. Click on the main document request (usually the first one)
5. Go to Headers tab → Response Headers
6. Find `Content-Security-Policy` header

**Expected Result:**
```
script-src-elem 'self' 'unsafe-inline' https://js.paystack.co https://*.paystack.co https://vercel.live
```

**Status:** ⬜ Pass / ⬜ Fail

---

### 2. CSP Warnings Check

**Steps:**
1. Open your app in browser
2. Open DevTools (F12) → Console tab
3. Navigate to Create Group page
4. Click "Create Group & Pay"
5. Paystack popup should open

**Expected Result:**
- ✅ NO warnings about "invalid path" or "query component"
- ✅ NO messages about `/v2.22/fingerprint?MerchantId=...`
- ✅ Paystack popup loads without errors

**Status:** ⬜ Pass / ⬜ Fail

---

### 3. Payment Flow - Group Creation

**Test Card Details:**
- Card Number: `4084084084084081`
- Expiry: `12/25` (or any future date)
- CVV: `123`
- PIN: `0000`

**Steps:**
1. Log in to your app
2. Navigate to "Create Group"
3. Fill out the form:
   - Name: "Test Group"
   - Description: "Testing payment flow"
   - Contribution: ₦5,000
   - Frequency: Weekly
   - Members: 5
   - Security Deposit: 20%
   - Start Date: Tomorrow
4. Click "Create Group & Pay"
5. Select a payout slot (e.g., Slot 1)
6. Click "Proceed to Payment"
7. Enter test card details in Paystack popup
8. Complete payment

**Expected Result:**
- ✅ After payment, redirected to `/payment/success?reference=XXX&group=YYY`
- ✅ Page shows "Verifying..." state briefly
- ✅ Page shows "Payment Verified" with green checkmark
- ✅ "Go to Group" button appears
- ✅ Clicking button takes you to group detail page
- ✅ You appear as a member with your selected slot

**Status:** ⬜ Pass / ⬜ Fail

**Notes:** _______________________________________________

---

### 4. Payment Verification - No 401 Errors

**Steps:**
1. During the payment flow test above
2. Open DevTools → Network tab
3. Filter by: `verify-payment`
4. Find the verify-payment request

**Expected Result:**
- ✅ Status: 200 OK (NOT 401)
- ✅ Response contains: `"success": true, "verified": true`
- ✅ NO error messages about "Unauthorized"

**Status:** ⬜ Pass / ⬜ Fail

---

### 5. Edge Function Logs

**Steps:**
```bash
supabase functions logs verify-payment --limit 20
```

**Expected Output:**
```
Authorization header present: true
Supabase URL configured: true
Service key configured: true
JWT token length: XXX
Request from authenticated user: [user-id]
===== PAYMENT VERIFICATION START =====
Reference: GRP_CREATE_...
Verifying payment with Paystack: GRP_CREATE_...
Paystack verification successful
Payment status: success
Storing payment record...
===== PAYMENT VERIFICATION END =====
```

**Status:** ⬜ Pass / ⬜ Fail

---

### 6. Payment Flow - Group Join

**Steps:**
1. Log in as a different user (or create a new account)
2. Navigate to "Groups"
3. Find the group created in test #3
4. Click to view details
5. Click "Request to Join"
6. (As admin) Approve the join request
7. (As joining user) Click "Pay to Join"
8. Complete payment with test card

**Expected Result:**
- ✅ Redirected to `/payment/success?reference=XXX&group=YYY`
- ✅ Payment verified successfully
- ✅ "Go to Group" button works
- ✅ New member appears in group members list

**Status:** ⬜ Pass / ⬜ Fail

---

### 7. Error Handling - Payment Cancellation

**Steps:**
1. Start creating a group
2. Proceed to payment
3. Close Paystack popup WITHOUT paying
4. Wait a moment

**Expected Result:**
- ✅ User is redirected back to groups list
- ✅ Group is deleted (doesn't appear in list)
- ✅ Error message shown about payment cancellation

**Status:** ⬜ Pass / ⬜ Fail

---

### 8. Error Handling - Verification Retry

**Steps:**
1. Complete a payment
2. If verification fails, "Retry Verification" button should appear
3. Click retry button

**Expected Result:**
- ✅ Retry button triggers new verification attempt
- ✅ Loading state shown during retry
- ✅ Success or failure message displayed after retry

**Status:** ⬜ Pass / ⬜ Fail

---

## Common Issues and Solutions

### Issue: Still seeing CSP warnings

**Solution:**
1. Check Vercel deployment completed: https://vercel.com/dashboard
2. Hard refresh browser: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
3. Check headers in Network tab
4. Wait 5 minutes for CDN cache to clear

---

### Issue: 401 Unauthorized errors

**Solution:**
1. Check Edge Function is deployed:
   ```bash
   supabase functions list
   ```
2. Verify secrets are set:
   ```bash
   supabase secrets list
   ```
3. Check Edge Function logs:
   ```bash
   supabase functions logs verify-payment --tail
   ```
4. Log out and log back in to refresh session
5. If "Missing authorization header" in logs → Frontend not sending token
6. If "Authentication failed" → Token expired or invalid

---

### Issue: Callback URL not working

**Solution:**
1. Check VITE_APP_URL in environment variables
2. Verify format (no trailing slash):
   - ✅ `https://example.com`
   - ❌ `https://example.com/`
3. Rebuild frontend:
   ```bash
   npm run build
   ```
4. Redeploy to Vercel

---

### Issue: Payment verification times out

**Solution:**
1. Check internet connection
2. Verify Paystack secret key is correct
3. Check Edge Function logs for Paystack API errors
4. Try manual retry using button on success page
5. Check payment status in Paystack Dashboard

---

## Production Deployment Notes

### Switching from Test to Live

When deploying to production:

1. **Update Paystack Keys**
   - Frontend: Use `pk_live_...` instead of `pk_test_...`
   - Backend: Use `sk_live_...` instead of `sk_test_...`

2. **Set Production URLs**
   ```bash
   VITE_APP_URL=https://your-actual-domain.com
   ```

3. **Redeploy Everything**
   - Frontend: Merge to main → Vercel auto-deploys
   - Backend: `supabase functions deploy verify-payment`

4. **Test with Real Cards**
   - Start with small amounts
   - Verify funds are captured correctly
   - Check all flows work end-to-end

---

## Sign-Off

### Tested By
- Name: _______________
- Date: _______________
- Environment: ⬜ Development ⬜ Staging ⬜ Production

### Test Results Summary
- CSP Headers: ⬜ Pass ⬜ Fail
- No CSP Warnings: ⬜ Pass ⬜ Fail
- Group Creation Payment: ⬜ Pass ⬜ Fail
- No 401 Errors: ⬜ Pass ⬜ Fail
- Edge Function Logs: ⬜ Pass ⬜ Fail
- Group Join Payment: ⬜ Pass ⬜ Fail
- Error Handling: ⬜ Pass ⬜ Fail
- Verification Retry: ⬜ Pass ⬜ Fail

### Overall Status
⬜ All tests passed - Ready for production
⬜ Some tests failed - See notes below
⬜ Blocked - Cannot proceed

**Notes:**
_______________________________________________
_______________________________________________
_______________________________________________

---

## Reference Documentation

- [CSP_AND_PAYMENT_FIX.md](./CSP_AND_PAYMENT_FIX.md) - Complete fix documentation
- [CALLBACK_URL_GUIDE.md](./CALLBACK_URL_GUIDE.md) - Callback URL details
- [TROUBLESHOOTING_PAYMENT_401.md](./TROUBLESHOOTING_PAYMENT_401.md) - 401 error guide
- [README.md](./README.md) - General setup instructions

---

**Version:** 1.0
**Last Updated:** January 13, 2026
