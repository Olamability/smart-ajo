# Webhook Setup Guide

This guide explains how to configure and verify Paystack webhooks for the Smart Ajo application.

## Why Webhooks Are Critical

Webhooks are **essential** for payment processing in Smart Ajo. Here's why:

1. **Reliability**: Webhooks are called by Paystack even if the user closes their browser
2. **Single Source of Truth**: All business logic (adding members, creating contributions) happens in the webhook
3. **Idempotency**: Webhooks handle duplicate events safely
4. **Asynchronous Processing**: Business logic runs independently from frontend verification

## Payment Flow Overview

```
User initiates payment
    ↓
Frontend: Create payment record in DB with metadata (including preferred_slot)
    ↓
Paystack: Process payment
    ↓
[PARALLEL PATHS]
    ↓                                    ↓
Frontend Callback                   Webhook (ASYNC)
    ↓                                    ↓
verify-payment Edge Function        paystack-webhook Edge Function
    ↓                                    ↓
Verify with Paystack API            Receive event from Paystack
Update payment record               Execute business logic:
Return success                      - Add member to group
    ↓                               - Create contribution record
PaymentSuccessPage                  - Update payment status
Poll database to confirm            - Create transactions
business logic completed                ↓
                                    Business logic complete
```

## Webhook Configuration

### 1. Get Your Webhook URL

Your webhook URL follows this format:
```
https://[your-project-ref].supabase.co/functions/v1/paystack-webhook
```

Example:
```
https://abc123xyz.supabase.co/functions/v1/paystack-webhook
```

### 2. Configure in Paystack Dashboard

1. Log in to your [Paystack Dashboard](https://dashboard.paystack.com/)
2. Navigate to **Settings** → **Webhooks**
3. Click **Add Webhook URL**
4. Enter your webhook URL
5. Click **Save**

### 3. Test Webhook

1. In Paystack Dashboard, go to **Settings** → **Webhooks**
2. Find your webhook URL in the list
3. Click **Test** to send a test event
4. Check your Supabase Edge Function logs to confirm receipt

### 4. Verify Webhook Logs

Check if your webhook is receiving events:

```bash
# View webhook logs
supabase functions logs paystack-webhook --follow
```

Look for:
- ✅ `Received Paystack event: charge.success`
- ✅ `Processing group creation payment for user...`
- ✅ `Group creation payment processed successfully`

### 5. Common Webhook Issues

#### Issue: Webhook not receiving events

**Symptoms:**
- Payments verify successfully in frontend
- But members are not added to groups
- No logs in `paystack-webhook`

**Diagnosis:**
```bash
# Check if webhook function exists
supabase functions list

# Check webhook logs
supabase functions logs paystack-webhook
```

**Solutions:**
1. Verify webhook URL is correct in Paystack dashboard
2. Ensure webhook function is deployed:
   ```bash
   supabase functions deploy paystack-webhook
   ```
3. Check webhook signature verification (Paystack sends `x-paystack-signature` header)

#### Issue: Webhook receiving events but failing

**Symptoms:**
- Webhook logs show events received
- But business logic fails with errors
- Members not added to groups

**Diagnosis:**
```bash
# View detailed error logs
supabase functions logs paystack-webhook --follow
```

**Common Errors:**

1. **Missing metadata:**
   ```
   Error: Missing required metadata for group creation
   ```
   **Fix:** Ensure frontend passes all required metadata when initializing payment

2. **Invalid preferred_slot:**
   ```
   Error: Slot X already taken
   ```
   **Fix:** Frontend now stores `preferred_slot` in payment metadata (fixed in this PR)

3. **User not creator:**
   ```
   Error: Only the group creator can make this payment
   ```
   **Fix:** Verify `created_by` field matches `user_id` in metadata

#### Issue: Payments stuck in "processing" state

**Symptoms:**
- Frontend shows "Processing your membership..."
- Never completes to "verified"

**Diagnosis:**
This means:
- Payment was verified with Paystack ✅
- But webhook hasn't completed business logic ❌

**Solutions:**
1. Check webhook logs for errors
2. Verify database state:
   ```sql
   -- Check payment record
   SELECT * FROM payments WHERE reference = 'your-reference';
   
   -- Check if member was added
   SELECT * FROM group_members WHERE user_id = 'user-id' AND group_id = 'group-id';
   ```
3. If webhook failed, check:
   - Database RLS policies allow webhook to insert/update
   - Group exists and is valid
   - User is authenticated properly

### 6. Webhook Security

The webhook verifies Paystack signature using:
```typescript
x-paystack-signature header + PAYSTACK_SECRET_KEY
```

**Never expose your secret key!** It should only exist in:
- Supabase Edge Function environment variables
- Never in frontend code
- Never in git repository

### 7. Testing Payment Flow End-to-End

1. Create a group as a creator
2. Select a payout slot
3. Click "Pay Security Deposit"
4. Complete payment in Paystack modal
5. Wait for redirect to PaymentSuccessPage
6. Observe:
   - "Verifying your payment..." (verify-payment running)
   - "Processing your membership..." (waiting for webhook)
   - "Payment verified! You have been added to position X" (webhook completed)
7. Navigate to group page
8. Confirm you appear as a member with payment completed

### 8. Monitoring Webhook Health

**Set up alerts:**
1. Monitor webhook response times
2. Alert on webhook failures
3. Track payment verification success rate

**Key Metrics:**
- Webhook success rate (should be >99%)
- Average webhook processing time (should be <3s)
- Payment-to-member-addition time (should be <20s)

## Environment Variables Required

### Frontend (.env)
```
VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxx  # or pk_live_xxx for production
VITE_APP_URL=http://localhost:3000     # Your app URL for callbacks
```

### Backend (Supabase Dashboard → Settings → Edge Functions)
```
PAYSTACK_SECRET_KEY=sk_test_xxx        # or sk_live_xxx for production
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

## Troubleshooting Checklist

- [ ] Webhook URL configured in Paystack dashboard
- [ ] Webhook URL matches your Supabase project URL
- [ ] `paystack-webhook` Edge Function deployed
- [ ] `PAYSTACK_SECRET_KEY` set in Supabase environment
- [ ] Webhook logs show events being received
- [ ] Payment metadata includes `preferred_slot` (for group creation)
- [ ] Database RLS policies allow service role to insert/update
- [ ] Test payment completes successfully end-to-end

## Support

If webhooks are still not working after following this guide:

1. Check Edge Function logs:
   ```bash
   supabase functions logs paystack-webhook --follow
   ```

2. Enable verbose logging in development:
   ```typescript
   console.log('=== WEBHOOK DEBUG ===');
   console.log('Event:', event.event);
   console.log('Metadata:', JSON.stringify(event.data.metadata, null, 2));
   ```

3. Contact support with:
   - Payment reference
   - Timestamp of payment
   - Webhook logs
   - Expected vs actual behavior
