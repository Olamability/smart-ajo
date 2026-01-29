# Paystack Webhook Configuration Guide

## Overview

This guide explains how to configure Paystack webhooks for the Smart Ajo application. The webhook is **CRITICAL** for reliable payment processing and membership activation.

## Why Webhooks are Essential

The Smart Ajo App uses a **dual-path payment verification system**:

1. **PRIMARY PATH (verify-payment)**: User-initiated synchronous verification
   - User completes payment → Frontend calls backend
   - Immediate feedback to user
   - Requires active user session

2. **BACKUP PATH (webhook)**: Paystack-initiated asynchronous verification
   - Paystack sends server-to-server notification
   - Processes payment even if user closes browser
   - **Critical for handling session expiration edge cases**

### What Happens Without Webhooks?

❌ **PROBLEM SCENARIO:**
1. User initiates payment (JWT token valid)
2. User completes payment on Paystack (takes 2-5 minutes)
3. User returns to app (JWT token expired)
4. `verify-payment` stores payment but can't activate membership (auth failed)
5. User refreshes but webhook is not configured
6. **Result: Payment successful but membership never activated** 🔴

✅ **WITH WEBHOOKS:**
1. User's session expires during payment
2. `verify-payment` stores payment record
3. Webhook receives Paystack notification
4. Webhook activates membership (no auth required)
5. **Result: Payment successful and membership activated** ✅

## Webhook URL

Your webhook URL format:
```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook
```

**Example:**
```
https://abcdefghijklmnop.supabase.co/functions/v1/paystack-webhook
```

## Configuration Steps

### Step 1: Find Your Supabase Project URL

1. Go to your Supabase dashboard: https://app.supabase.com
2. Select your project
3. Go to **Settings** → **API**
4. Copy your **Project URL** (looks like: `https://abcdefghijklmnop.supabase.co`)

### Step 2: Configure Webhook in Paystack Dashboard

#### For Test Environment:

1. Log in to Paystack Dashboard: https://dashboard.paystack.com
2. Go to **Settings** → **Webhooks**
3. In the **Test Mode** section, click **"Configure"**
4. Enter webhook URL:
   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook
   ```
5. Click **Save Changes**

#### For Production Environment:

1. In Paystack Dashboard, switch to **Live Mode** (toggle in top navigation)
2. Go to **Settings** → **Webhooks**
3. In the **Live Mode** section, click **"Configure"**
4. Enter webhook URL:
   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook
   ```
5. Click **Save Changes**

### Step 3: Verify Webhook Configuration

Run this command to test your webhook:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-paystack-signature: test_signature" \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook \
  -d '{"event": "charge.success", "data": {"reference": "TEST_123"}}'
```

Expected response:
```json
{
  "error": "Invalid signature"
}
```

This confirms your webhook endpoint is accessible. The "Invalid signature" error is expected because we used a test signature.

## Webhook Events Handled

The Smart Ajo webhook handles these events:

| Event | Description | Action Taken |
|-------|-------------|--------------|
| `charge.success` | Payment successful | Process payment, activate membership |
| `charge.failed` | Payment failed | Update payment status to failed |

## Security: Signature Validation

The webhook validates all requests using **HMAC SHA-512 signature verification**:

1. Paystack signs each webhook request with your secret key
2. Webhook validates signature before processing
3. Invalid signatures are rejected (prevents spoofing)

**Implementation:** See `supabase/functions/paystack-webhook/index.ts` lines 99-131

## Testing Webhooks

### Test with Paystack Dashboard

1. Go to **Developers** → **Webhooks** in Paystack Dashboard
2. Click **Send Test Event**
3. Select event type: `charge.success`
4. Click **Send Event**
5. Check logs in Supabase:
   ```bash
   supabase functions logs paystack-webhook --limit 20
   ```

### Test with Real Payment

1. Create a group or join a group
2. Complete payment with Paystack test card:
   - **Card Number:** `4084 0840 8408 4081`
   - **CVV:** `123`
   - **Expiry:** Any future date (e.g., `12/25`)
   - **PIN:** `1234`
   - **OTP:** `123456`

3. Close browser immediately after payment (simulate session expiration)
4. Wait 30 seconds
5. Check database:
   ```sql
   -- Check if payment was stored
   SELECT reference, status, verified 
   FROM payments 
   ORDER BY created_at DESC 
   LIMIT 1;
   
   -- Check if membership was activated
   SELECT user_id, group_id, has_paid_security_deposit, status
   FROM group_members
   ORDER BY created_at DESC
   LIMIT 1;
   ```

Expected result: Both queries show successful payment and active membership.

## Monitoring Webhook Delivery

### Check Webhook Logs in Paystack

1. Go to **Developers** → **Webhooks** in Paystack Dashboard
2. View **Recent Events** tab
3. Check status of each webhook delivery:
   - ✅ Green checkmark: Successfully delivered
   - ❌ Red X: Failed delivery
   - ⏱️ Yellow clock: Pending retry

### Check Supabase Edge Function Logs

```bash
# View recent webhook logs
supabase functions logs paystack-webhook --limit 50

# Follow logs in real-time
supabase functions logs paystack-webhook --follow

# Filter for specific payment
supabase functions logs paystack-webhook | grep "PAYMENT_REF_123"
```

### Key Log Messages to Look For

**Successful webhook processing:**
```
=== WEBHOOK RECEIVED ===
[Signature] Valid: true
[Webhook] Event: charge.success
[Webhook] Processing charge.success
[Business Logic] Result: SUCCESS
=== WEBHOOK END ===
```

**Failed webhook:**
```
[Signature] Invalid signature
```
or
```
[Business Logic] Result: FAILED
[Business Logic] Error: [error details]
```

## Troubleshooting

### Problem: Webhooks Not Being Received

**Symptoms:**
- Paystack dashboard shows webhook delivery failed
- No logs in Supabase for webhook function
- Payments verified but membership not activated after session expiration

**Solutions:**
1. **Check webhook URL is correct:**
   - Must be: `https://PROJECT.supabase.co/functions/v1/paystack-webhook`
   - No trailing slash
   - Function name exactly `paystack-webhook`

2. **Verify Edge Function is deployed:**
   ```bash
   supabase functions list
   ```
   Should show `paystack-webhook` in the list

3. **Check function deployment:**
   ```bash
   supabase functions deploy paystack-webhook --no-verify-jwt
   ```

4. **Verify CORS headers allow Paystack:**
   - Edge Function includes CORS headers
   - Should accept requests from any origin

### Problem: Webhook Signature Validation Failing

**Symptoms:**
- Logs show: `[Signature] Invalid signature`
- Paystack dashboard shows 401 Unauthorized

**Solutions:**
1. **Verify secret key is set:**
   ```bash
   supabase secrets list
   ```
   Should show `PAYSTACK_SECRET_KEY`

2. **Set/update secret key:**
   ```bash
   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_YOUR_KEY
   ```

3. **Redeploy webhook function:**
   ```bash
   supabase functions deploy paystack-webhook --no-verify-jwt
   ```

### Problem: Webhook Processes Payment but Business Logic Fails

**Symptoms:**
- Payment record created in database
- Membership not activated
- Logs show: `[Business Logic] Result: FAILED`

**Solutions:**
1. **Check error message in logs:**
   ```bash
   supabase functions logs paystack-webhook | grep "Business Logic"
   ```

2. **Common issues:**
   - Group not found (deleted after payment initiated)
   - User already a member (duplicate processing)
   - Group full (max members reached)
   - Invalid payment amount

3. **Manually retry:**
   - Payment record exists, can manually activate:
   ```sql
   -- Update member to active status
   UPDATE group_members
   SET has_paid_security_deposit = true,
       status = 'active',
       security_deposit_paid_at = NOW()
   WHERE user_id = 'USER_ID' AND group_id = 'GROUP_ID';
   ```

## Webhook Security Best Practices

1. ✅ **Always validate signatures** (already implemented)
2. ✅ **Use HTTPS only** (Supabase enforces this)
3. ✅ **Log all webhook events** (already implemented)
4. ✅ **Handle idempotency** (already implemented)
5. ✅ **Return 200 OK quickly** (already implemented)
6. ⚠️ **Monitor webhook failures** (set up alerts)

## Production Checklist

Before going live:

- [ ] Webhook URL configured in Paystack **Live Mode**
- [ ] Live secret key set in Supabase: `PAYSTACK_SECRET_KEY=sk_live_...`
- [ ] Edge Function deployed: `supabase functions deploy paystack-webhook`
- [ ] Webhook test completed successfully
- [ ] End-to-end payment flow tested in production
- [ ] Monitoring set up for webhook failures
- [ ] Team notified of webhook URL and configuration

## Additional Resources

- **Paystack Webhooks Documentation:** https://paystack.com/docs/payments/webhooks
- **Supabase Edge Functions:** https://supabase.com/docs/guides/functions
- **Smart Ajo Payment Architecture:** See `PAYMENT_VERIFICATION.md`
- **Edge Function Code:** `supabase/functions/paystack-webhook/index.ts`

## Support

If you encounter issues:

1. Check Supabase Edge Function logs
2. Check Paystack webhook delivery logs
3. Verify environment variables
4. Review error messages in logs
5. Contact support with:
   - Payment reference
   - Timestamp of issue
   - Edge Function logs
   - Paystack webhook delivery status

---

**Last Updated:** 2026-01-29
**Version:** 1.0.0
