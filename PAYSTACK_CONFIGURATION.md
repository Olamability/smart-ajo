# Paystack Configuration Guide

This document provides the necessary URLs and configuration details for integrating Paystack with the SmartAjo platform.

## 📋 Overview

SmartAjo uses Paystack for payment processing. The integration includes:
- **Frontend**: Paystack Inline JS for payment collection
- **Backend**: Supabase Edge Function for webhook handling and payment verification

---

## 🔑 Required Keys

### Frontend (Already Configured)
The Paystack public key is configured in your `.env.development` file:
```bash
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_paystack_public_key_here
```

**⚠️ Note**: Update this with your actual Paystack public key from your Paystack dashboard.

### Backend (Supabase Edge Function)
The Paystack secret key must be added to Supabase as an environment secret:
1. Go to your Supabase Dashboard
2. Navigate to: **Project Settings** → **Edge Functions** → **Secrets**
3. Add the following secret:
   - **Name**: `PAYSTACK_SECRET_KEY`
   - **Value**: Your Paystack secret key (starts with `sk_test_` or `sk_live_`)

---

## 🌐 Important URLs

### 1. Webhook URL
This is where Paystack will send payment notifications:

```
https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook
```

**Configuration Steps:**
1. Log in to your [Paystack Dashboard](https://dashboard.paystack.com)
2. Go to **Settings** → **Webhooks**
3. Click **Add Webhook**
4. Enter the webhook URL above
5. Select the following events to monitor:
   - `charge.success` ✅ (Required - for successful payments)
   - `charge.failed` (Optional - for failed payment tracking)
   - `transfer.success` (Optional - for payout confirmations)
   - `transfer.failed` (Optional - for payout failures)
6. Click **Save**

### 2. Callback URL (Payment Success Redirect)

**What is a Callback URL?** A callback URL is where users are automatically redirected after completing payment on Paystack. It's **optional** and only affects user experience.

#### Quick Answer:

**Your callback URLs are based on your domain:**

Local Development:
```
http://localhost:3000/payment/success
http://localhost:3000/dashboard
http://localhost:3000/groups/{groupId}
```

Production (Replace with your actual domain):
```
https://your-app-domain.com/payment/success
https://your-app-domain.com/dashboard
https://your-app-domain.com/groups/{groupId}
```

#### How to Find Your Callback URL:

1. **Find your base URL:**
   - Check your `.env` file: `VITE_APP_URL=https://your-app-domain.com`
   - Or check your deployed URL on Vercel/Netlify dashboard
   
2. **Add the page route:**
   - For dashboard: `/dashboard`
   - For payment success: `/payment/success`
   - For group page: `/groups/{groupId}`

3. **Combine them:**
   - `https://your-app-domain.com/payment/success`

#### Important Notes:

⚠️ **Callback URL vs Webhook URL**: These are different!
- **Callback URL**: Where **users** are redirected (optional, for UX)
- **Webhook URL**: Where **Paystack notifies your server** (required, for verification)

✅ **The callback URL is OPTIONAL.** Payment verification is handled by the webhook, not the callback.

🔐 **Security**: NEVER trust the callback URL for payment verification. Always use the webhook.

📖 **For Complete Guide**: See [CALLBACK_URL_GUIDE.md](./CALLBACK_URL_GUIDE.md) for detailed explanations, examples, and troubleshooting.

---

## 🔧 Payment Flow

### How It Works:

1. **User Initiates Payment** (Frontend)
   - User clicks "Pay Security Deposit" or "Pay Contribution"
   - Frontend calls `paystackService.paySecurityDeposit()` or `paystackService.payContribution()`
   - Paystack Inline popup opens
   - User completes payment

2. **Payment Processed** (Paystack)
   - Paystack processes the payment
   - Payment reference is generated

3. **Webhook Notification** (Backend)
   - Paystack sends webhook to: `https://kvxokszuonvdvsazoktc.supabase.co/functions/v1/paystack-webhook`
   - Edge function validates webhook signature
   - Edge function updates database:
     - Marks contribution as "paid"
     - Updates security deposit status
     - Creates transaction record
   - Returns success response to Paystack

4. **User Sees Confirmation** (Frontend)
   - Frontend callback is triggered
   - User sees success toast notification
   - UI updates to reflect payment status

---

## 🔐 Security Features

### Webhook Signature Verification
The Edge Function automatically verifies all webhook requests using HMAC SHA512:
- Prevents unauthorized webhook calls
- Ensures data integrity
- Protects against replay attacks

### Metadata Validation
Every payment includes metadata that is validated:
```json
{
  "type": "contribution" | "security_deposit",
  "user_id": "uuid",
  "group_id": "uuid",
  "cycle_number": 1
}
```

---

## 🧪 Testing

### Test Mode
During development, use Paystack test keys:
- **Public Key**: `pk_test_...`
- **Secret Key**: `sk_test_...`

### Test Cards
Use these test cards in Paystack's test mode:

| Card Number | Description |
|-------------|-------------|
| `4084084084084081` | Successful transaction |
| `4084084084084099` | Failed transaction (insufficient funds) |
| `5060666666666666666` | Success (Verve) |

**Test Details:**
- CVV: Any 3 digits (e.g., `123`)
- Expiry: Any future date (e.g., `12/25`)
- PIN: `1234` (for Nigerian cards)
- OTP: `123456`

### Testing Webhook Locally
To test webhooks during local development:

1. **Use ngrok or similar tool**:
   ```bash
   ngrok http 54321
   ```

2. **Update webhook URL in Paystack**:
   ```
   https://your-ngrok-url.ngrok.io/functions/v1/paystack-webhook
   ```

3. **Or use Supabase CLI**:
   ```bash
   supabase functions serve paystack-webhook
   ```

---

## 📊 Monitoring

### Check Webhook Logs
1. **Paystack Dashboard**:
   - Go to **Settings** → **Webhooks**
   - View webhook delivery logs
   - Check response codes and retry attempts

2. **Supabase Logs**:
   - Go to **Supabase Dashboard** → **Functions**
   - Click on `paystack-webhook`
   - View invocation logs and errors

### Transaction Records
All payments create records in the `transactions` table:
```sql
SELECT * FROM transactions 
WHERE payment_method = 'paystack' 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## 🚨 Troubleshooting

### Webhook Not Receiving Events
1. Verify webhook URL is correct
2. Check Supabase function is deployed:
   ```bash
   supabase functions list
   ```
3. Check Paystack webhook logs for delivery failures
4. Verify `PAYSTACK_SECRET_KEY` is set in Supabase secrets

### Payment Shows Successful but Not Updated in App
1. Check Supabase function logs for errors
2. Verify webhook signature validation is passing
3. Check that metadata is included in payment
4. Ensure database permissions (RLS) allow updates

### Invalid Signature Error
1. Verify `PAYSTACK_SECRET_KEY` in Supabase matches Paystack dashboard
2. Check for extra spaces in the secret key
3. Ensure webhook is using correct secret key (test vs live)

---

## 🔄 Going to Production

When moving to production:

1. **Update Environment Variables**:
   ```bash
   # Frontend (.env.production)
   VITE_PAYSTACK_PUBLIC_KEY=pk_live_your_live_public_key
   
   # Backend (Supabase Secrets)
   PAYSTACK_SECRET_KEY=sk_live_your_live_secret_key
   ```

2. **Update Webhook URL**:
   - Keep the same Supabase function URL
   - Just ensure it's using live keys

3. **Test Thoroughly**:
   - Test with real (small amount) transactions
   - Verify webhook delivery
   - Check transaction records

4. **Enable Monitoring**:
   - Set up alerts for failed webhooks
   - Monitor transaction success rates
   - Track payment processing times

---

## 📞 Support

- **Paystack Documentation**: https://paystack.com/docs
- **Supabase Edge Functions**: https://supabase.com/docs/guides/functions
- **Project Issues**: Contact your development team or system administrator

---

## ✅ Quick Checklist

- [ ] Paystack public key added to `.env.development`
- [ ] Paystack secret key added to Supabase secrets
- [ ] Webhook URL configured in Paystack dashboard
- [ ] Webhook events selected (`charge.success` minimum)
- [ ] Test payment completed successfully
- [ ] Webhook logs show successful delivery
- [ ] Transaction record created in database
- [ ] Ready for production deployment
