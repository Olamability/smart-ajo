# Paystack Payment System Testing Guide

## Overview
This guide provides step-by-step instructions for testing the Paystack payment implementation according to the requirements in "Paystack steup.md".

## Prerequisites

### 1. Environment Setup
Ensure the following environment variables are configured:

**Frontend (.env.development):**
```bash
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_test_key_here
```

**Backend (Supabase Secrets):**
```bash
PAYSTACK_SECRET_KEY=sk_test_your_test_key_here
```

### 2. Database Setup
Run the migration to create the payments table:
```bash
# Using Supabase CLI
supabase db push

# Or apply the migration manually
psql -d your_database < supabase/migrations/add_payments_table.sql
```

### 3. Deploy Edge Functions
Deploy the payment verification and webhook handler:
```bash
# Deploy verify-payment function
supabase functions deploy verify-payment

# Deploy paystack-webhook function
supabase functions deploy paystack-webhook

# Set secrets
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key
```

## Test Scenarios

### Test 1: Successful Payment Flow

**Objective:** Verify that a successful payment is properly recorded and business logic is executed.

**Steps:**
1. Navigate to a group detail page
2. Click "Pay Security Deposit" or "Pay Contribution"
3. Use test card: `4084084084084081`
   - CVV: `123`
   - Expiry: `12/25`
   - PIN: `1234`
   - OTP: `123456`
4. Complete the payment

**Expected Results:**
- ✅ Payment modal closes successfully
- ✅ Success toast notification appears
- ✅ Payment record created in `payments` table with `verified = true`
- ✅ Business logic executed (contribution marked as paid OR security deposit updated)
- ✅ Transaction record created in `transactions` table
- ✅ UI updates to reflect payment status

**Database Verification:**
```sql
-- Check payment record
SELECT * FROM payments WHERE reference = 'your_payment_reference';

-- Verify fields
-- status should be 'success'
-- verified should be true
-- amount, fees, gateway_response should be populated
-- metadata should contain app, user_id, purpose, entity_id

-- Check business logic execution
SELECT * FROM contributions WHERE transaction_ref = 'your_payment_reference';
-- OR
SELECT * FROM group_members WHERE security_deposit_payment_ref = 'your_payment_reference';

-- Check transaction record
SELECT * FROM transactions WHERE reference = 'your_payment_reference';
```

### Test 2: Failed Payment

**Objective:** Verify that failed payments are properly recorded without executing business logic.

**Steps:**
1. Navigate to a group detail page
2. Click "Pay Security Deposit" or "Pay Contribution"
3. Use failed test card: `4084084084084099`
   - CVV: `123`
   - Expiry: `12/25`
   - PIN: `1234`

**Expected Results:**
- ✅ Payment fails with "Insufficient Funds" message
- ✅ Payment record created in `payments` table with `status = 'failed'` and `verified = false`
- ✅ Business logic NOT executed
- ✅ No transaction record created (or created with status 'failed')

**Database Verification:**
```sql
-- Check payment record
SELECT * FROM payments WHERE reference = 'your_payment_reference';

-- Verify fields
-- status should be 'failed'
-- verified should be false

-- Verify business logic NOT executed
SELECT * FROM contributions WHERE transaction_ref = 'your_payment_reference';
-- Should return no results

SELECT * FROM group_members WHERE security_deposit_payment_ref = 'your_payment_reference';
-- Should return no results
```

### Test 3: Abandoned Payment

**Objective:** Verify that abandoned payments are handled correctly.

**Steps:**
1. Navigate to a group detail page
2. Click "Pay Security Deposit" or "Pay Contribution"
3. Close the payment modal without completing payment

**Expected Results:**
- ✅ Modal closes
- ✅ No payment record created (or created with status 'abandoned')
- ✅ Business logic NOT executed
- ✅ User can retry payment

### Test 4: Webhook Signature Verification

**Objective:** Verify that webhook requests are properly authenticated.

**Steps:**
1. Use a tool like Postman or curl to send a webhook request
2. Send request WITHOUT valid signature

```bash
curl -X POST https://your-supabase-url.supabase.co/functions/v1/paystack-webhook \
  -H "Content-Type: application/json" \
  -d '{"event": "charge.success", "data": {"reference": "test_ref"}}'
```

**Expected Results:**
- ✅ Request returns 401 Unauthorized
- ✅ Error message: "Invalid signature" or "No signature provided"
- ✅ No database updates

**Steps with Valid Signature:**
1. Get your Paystack secret key
2. Calculate HMAC SHA512 signature
3. Send request with `x-paystack-signature` header

**Expected Results:**
- ✅ Request returns 200 OK
- ✅ Payment processed and stored

### Test 5: Duplicate Webhook Handling (Idempotency)

**Objective:** Verify that duplicate webhook events don't cause data corruption.

**Steps:**
1. Complete a successful payment (Test 1)
2. Manually trigger the webhook again with the same reference
3. Check database for duplicate records

**Expected Results:**
- ✅ No duplicate payment records created
- ✅ Existing record updated (if applicable)
- ✅ Business logic NOT executed twice
- ✅ Response indicates "Payment already verified"

**Database Verification:**
```sql
-- Check for duplicate payments
SELECT reference, COUNT(*) as count
FROM payments
GROUP BY reference
HAVING COUNT(*) > 1;
-- Should return no results

-- Check contribution/security deposit not duplicated
SELECT transaction_ref, COUNT(*) as count
FROM contributions
GROUP BY transaction_ref
HAVING COUNT(*) > 1;
-- Should return no results
```

### Test 6: Backend Verification API

**Objective:** Verify that the verify-payment Edge Function works correctly.

**Steps:**
1. Complete a payment and get the reference
2. Call the verify-payment function directly:

```typescript
const supabase = createClient();
const { data, error } = await supabase.functions.invoke('verify-payment', {
  body: { reference: 'your_payment_reference' }
});
```

**Expected Results:**
- ✅ Returns payment status from Paystack
- ✅ Payment record created/updated in database
- ✅ Business logic executed if payment successful
- ✅ Returns detailed payment information

### Test 7: Unauthorized Access Prevention

**Objective:** Verify that RLS policies prevent unauthorized payment manipulation.

**Steps:**
1. As a regular user, try to update a payment's verified status:

```sql
UPDATE payments 
SET verified = true 
WHERE reference = 'some_reference';
```

**Expected Results:**
- ✅ Update fails (RLS policy violation)
- ✅ User can only read their own payments
- ✅ User cannot insert or update payment records

### Test 8: Metadata Validation

**Objective:** Verify that payments include proper metadata.

**Steps:**
1. Complete a payment (security deposit or contribution)
2. Check the payment record in the database

**Expected Results:**
- ✅ Metadata contains required fields:
  - `app`: "smartajo"
  - `user_id`: Valid UUID
  - `purpose`: "security_deposit" or "contribution"
  - `entity_id`: Group ID
- ✅ Metadata also contains backward compatibility fields:
  - `type`: Payment type
  - `group_id`: Group ID
  - `cycle_number`: (for contributions)

**Database Verification:**
```sql
SELECT 
  reference,
  metadata->>'app' as app,
  metadata->>'user_id' as user_id,
  metadata->>'purpose' as purpose,
  metadata->>'entity_id' as entity_id,
  metadata->>'type' as type,
  metadata->>'group_id' as group_id
FROM payments
WHERE reference = 'your_payment_reference';

-- All fields should be populated
```

### Test 9: Multiple Event Types

**Objective:** Verify that webhook handles all specified event types.

**Test Events:**
- `charge.success` - Already tested in Test 1
- `charge.failed` - Already tested in Test 2
- `transfer.success` - Manual webhook test needed
- `refund.processed` - Manual webhook test needed

**For transfer.success and refund.processed:**
Since these are rare events, you can:
1. Manually trigger webhook using Paystack dashboard "Send Webhook" feature
2. Or use test mode to simulate these events

**Expected Results:**
- ✅ All events are received and logged
- ✅ Payment records created for all events
- ✅ Appropriate status set based on event type

### Test 10: Payment Amounts in Kobo

**Objective:** Verify that amounts are correctly converted between Naira and Kobo.

**Steps:**
1. Make a payment for ₦1,000
2. Check database records

**Expected Results:**
- ✅ `payments` table: amount = 100000 (kobo)
- ✅ `transactions` table: amount = 1000.00 (Naira)
- ✅ Paystack receives 100000 (kobo)

**Database Verification:**
```sql
SELECT 
  p.reference,
  p.amount as payment_amount_kobo,
  t.amount as transaction_amount_naira
FROM payments p
LEFT JOIN transactions t ON t.reference = p.reference
WHERE p.reference = 'your_payment_reference';

-- payment_amount_kobo should be 100x transaction_amount_naira
```

## Monitoring and Logs

### Check Supabase Function Logs
```bash
# View verify-payment logs
supabase functions logs verify-payment

# View webhook logs
supabase functions logs paystack-webhook
```

### Check Paystack Webhook Logs
1. Go to Paystack Dashboard
2. Navigate to Settings → Webhooks
3. Click on your webhook
4. View delivery logs, response codes, and retry attempts

### Database Queries for Monitoring

```sql
-- Recent payments
SELECT reference, status, verified, amount, created_at
FROM payments
ORDER BY created_at DESC
LIMIT 10;

-- Failed payments
SELECT reference, status, gateway_response, created_at
FROM payments
WHERE status = 'failed'
ORDER BY created_at DESC;

-- Unverified payments
SELECT reference, status, created_at
FROM payments
WHERE verified = false
ORDER BY created_at DESC;

-- Payment statistics
SELECT 
  status,
  COUNT(*) as count,
  SUM(amount) as total_amount
FROM payments
GROUP BY status;
```

## Troubleshooting

### Issue: Webhook not receiving events
**Solutions:**
1. Verify webhook URL is correct in Paystack dashboard
2. Check Supabase function is deployed: `supabase functions list`
3. Check Paystack webhook logs for delivery failures
4. Verify `PAYSTACK_SECRET_KEY` is set in Supabase secrets

### Issue: Payment successful but not updated in app
**Solutions:**
1. Check Supabase function logs for errors
2. Verify webhook signature validation is passing
3. Check that metadata is included in payment
4. Ensure database RLS policies allow updates

### Issue: Invalid signature error
**Solutions:**
1. Verify `PAYSTACK_SECRET_KEY` matches Paystack dashboard
2. Check for extra spaces in the secret key
3. Ensure webhook is using correct secret key (test vs live)

### Issue: Duplicate payments
**Solutions:**
1. Check idempotency is working correctly
2. Verify webhook is not being called multiple times manually
3. Check Paystack retry settings

## Go-Live Checklist

Before deploying to production:

- [ ] Test keys removed from environment variables
- [ ] Live keys loaded via environment variables
- [ ] Webhook configured with live URL
- [ ] Webhook events verified (`charge.success` minimum)
- [ ] All test scenarios passed
- [ ] RLS policies verified
- [ ] Payment amounts verified (kobo/naira conversion)
- [ ] Metadata validation working
- [ ] Webhook signature verification working
- [ ] Idempotency tested
- [ ] Monitoring and alerts set up
- [ ] Backup and recovery procedures documented

## Security Validation

Verify these security requirements are met:

- [ ] Frontend uses only PUBLIC key
- [ ] SECRET key never exposed to frontend
- [ ] Frontend cannot mark payments as successful
- [ ] Frontend cannot update verified field
- [ ] Only service role can insert/update payments
- [ ] Users can only read their own payments
- [ ] Webhook signature always verified
- [ ] No card details stored (CVV, PIN, card number)
- [ ] Authorization code stored for recurring payments
- [ ] All sensitive operations logged

## Performance Validation

- [ ] Database indexes created and used
- [ ] Webhook responds quickly (< 5 seconds)
- [ ] No N+1 queries in payment processing
- [ ] Payment verification is idempotent
- [ ] Concurrent payments handled correctly

---

## Summary

This testing guide ensures that the Paystack payment implementation meets all requirements from "Paystack steup.md":

✅ Environment & Keys properly configured
✅ Payment flow (frontend → backend verification)
✅ Database requirements (all mandatory fields)
✅ Security rules (RLS, backend authority)
✅ Webhook implementation (signature verification, multiple events)
✅ Metadata usage (app, user_id, purpose, entity_id)
✅ Failure & edge case handling (duplicate webhooks, abandoned payments)
✅ Testing requirements (successful, failed, webhook, unauthorized access)
