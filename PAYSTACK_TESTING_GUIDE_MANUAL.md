# Manual Testing Guide for Paystack Verification Flow

## Prerequisites

1. **Paystack Test Account**
   - Test Public Key configured in `.env`: `VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxx`
   - Test Secret Key configured in Supabase: `PAYSTACK_SECRET_KEY=sk_test_xxx`

2. **Supabase Edge Functions Deployed**
   ```bash
   supabase functions deploy verify-payment
   supabase functions deploy paystack-webhook
   ```

3. **Webhook URL Configured in Paystack**
   - Go to Paystack Dashboard > Settings > Webhooks
   - Add webhook URL: `https://your-project.supabase.co/functions/v1/paystack-webhook`
   - Copy the webhook secret (not needed for signature verification with secret key)

## Test Cases

### Test 1: Group Creation Payment

**Steps:**
1. Log in as a user
2. Create a new group with:
   - Contribution amount: ₦5,000
   - Security deposit: ₦2,000
   - Select preferred slot (e.g., 1)
3. Complete payment using Paystack test card:
   - Card: 5531886652142950 (test card)
   - Expiry: Any future date
   - CVV: 123

**Expected Results:**
- ✅ verify-payment returns success immediately
- ✅ User sees success message
- ✅ Webhook is called by Paystack (check Edge Function logs)
- ✅ Database updated:
  - `payments` table: reference stored, status = 'success', verified = true
  - `group_members` table: has_paid_security_deposit = true
  - `contributions` table: cycle 1 status = 'paid'
  - `transactions` table: 2 records created (security deposit + contribution)

**Verification Queries:**
```sql
-- Check payment record
SELECT * FROM payments WHERE reference LIKE 'GRP_CREATE%' ORDER BY created_at DESC LIMIT 1;

-- Check member payment status
SELECT user_id, group_id, has_paid_security_deposit, security_deposit_paid_at, position
FROM group_members WHERE user_id = 'YOUR_USER_ID' AND group_id = 'YOUR_GROUP_ID';

-- Check contribution
SELECT * FROM contributions WHERE user_id = 'YOUR_USER_ID' AND group_id = 'YOUR_GROUP_ID' AND cycle_number = 1;

-- Check transactions
SELECT * FROM transactions WHERE reference LIKE 'GRP_CREATE%' ORDER BY created_at DESC LIMIT 2;
```

### Test 2: Group Join Payment

**Steps:**
1. As group creator, view join requests
2. Approve a pending join request
3. As the joining user, complete payment
4. Use Paystack test card (same as above)

**Expected Results:**
- ✅ verify-payment returns success
- ✅ Webhook updates database:
  - `group_members`: has_paid_security_deposit = true
  - `contributions`: cycle 1 status = 'paid'
  - `group_join_requests`: status = 'joined'
  - `transactions`: 2 records created

**Verification Queries:**
```sql
-- Check member status
SELECT * FROM group_members WHERE user_id = 'JOINING_USER_ID' AND group_id = 'GROUP_ID';

-- Check join request
SELECT * FROM group_join_requests WHERE user_id = 'JOINING_USER_ID' AND group_id = 'GROUP_ID';

-- Check contribution
SELECT * FROM contributions WHERE user_id = 'JOINING_USER_ID' AND group_id = 'GROUP_ID' AND cycle_number = 1;
```

### Test 3: Regular Contribution Payment

**Steps:**
1. As an active group member
2. Navigate to current cycle
3. Make contribution payment
4. Complete payment with test card

**Expected Results:**
- ✅ Webhook updates:
  - `contributions`: status = 'paid', paid_date set
  - `transactions`: 1 record created

**Verification Queries:**
```sql
-- Check contribution status
SELECT * FROM contributions 
WHERE user_id = 'USER_ID' AND group_id = 'GROUP_ID' AND cycle_number = CURRENT_CYCLE;

-- Check transaction
SELECT * FROM transactions WHERE reference = 'YOUR_REFERENCE';
```

### Test 4: Idempotency - Duplicate Webhook

**Steps:**
1. Complete any payment (e.g., group creation)
2. Manually trigger webhook again with same reference (using Paystack dashboard or curl)
3. Check logs and database

**Expected Results:**
- ✅ First webhook: Processes payment, updates database
- ✅ Second webhook: Returns success but doesn't duplicate updates
- ✅ Logs show "already processed (duplicate webhook)"
- ✅ Database has only one set of records (no duplicates)

**Curl Example:**
```bash
# Get webhook payload from Paystack dashboard event log
# Then replay it
curl -X POST https://your-project.supabase.co/functions/v1/paystack-webhook \
  -H "Content-Type: application/json" \
  -H "x-paystack-signature: YOUR_SIGNATURE" \
  -d @webhook-payload.json
```

### Test 5: Failed Payment

**Steps:**
1. Start payment flow
2. Use Paystack test card for failed transaction:
   - Card: 5060666666666666666 (insufficient funds)
3. Complete payment

**Expected Results:**
- ✅ Payment fails on Paystack
- ✅ verify-payment returns failure
- ✅ Webhook receives 'charge.failed' event
- ✅ Database updated:
  - `payments`: status = 'failed', verified = false
- ✅ No business logic executed (no group_members or contributions updates)

## Monitoring

### Check Edge Function Logs

**Supabase Dashboard:**
1. Go to Edge Functions
2. Select function (verify-payment or paystack-webhook)
3. Click "Logs" tab
4. Filter by time period

**Key Log Messages to Look For:**

**verify-payment:**
```
"===== PAYMENT VERIFICATION START ====="
"Verifying payment with Paystack: GRP_CREATE_xxx"
"Paystack verification successful"
"Payment verified and stored. Business logic will be processed by webhook."
"===== PAYMENT VERIFICATION END ====="
```

**webhook:**
```
"Received Paystack event: charge.success, reference: GRP_CREATE_xxx"
"Payment stored: reference GRP_CREATE_xxx"
"Processing group creation payment for user xxx in group yyy"
"Adding creator as member with preferred slot 1"
"Group creation payment processed successfully"
```

### Check for Errors

**Common Issues:**

1. **"No signature provided"**
   - Webhook signature missing
   - Check Paystack webhook configuration

2. **"Invalid signature"**
   - Wrong PAYSTACK_SECRET_KEY
   - Check environment variables in Supabase

3. **"Payment type not specified"**
   - Missing metadata.type in payment
   - Check frontend payment initialization

4. **"Group not found"**
   - Invalid group_id in metadata
   - Check frontend is passing correct group_id

5. **"User is not a member"**
   - For group_join, user should be added before payment
   - Check join request approval flow

## Success Criteria

All tests must pass with:
- ✅ No errors in Edge Function logs
- ✅ Database updated correctly for each payment type
- ✅ Idempotency works (duplicate webhooks safe)
- ✅ Failed payments don't update business logic
- ✅ Frontend shows correct payment status

## Rollback Plan

If issues are found:
1. Keep webhook active (don't disable)
2. Fix specific payment type handler
3. Deploy updated webhook function
4. Re-test specific payment type
5. Webhook signature validation ensures only real Paystack events processed

## Go-Live Checklist

Before production:
- [ ] All 5 test cases pass
- [ ] Test keys removed from code
- [ ] Live keys configured in Supabase environment
- [ ] Webhook URL updated in Paystack dashboard (live mode)
- [ ] Monitoring and alerts configured
- [ ] Support team trained on payment flow
- [ ] Rollback plan documented and tested

## Support

For issues:
1. Check Edge Function logs first
2. Verify payment in Paystack dashboard
3. Check database records with verification queries
4. See PAYSTACK_WEBHOOK_IMPLEMENTATION.md for architecture details
