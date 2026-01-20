# Edge Functions Setup Guide

This guide explains how to deploy and configure the Supabase Edge Functions for SmartAjo.

## Prerequisites

- Supabase CLI installed: `npm install -g supabase`
- Supabase project created and linked
- Required API keys and credentials

## Edge Functions Overview

### 1. Paystack Webhook (`paystack-webhook`)

**Purpose**: Verifies and processes Paystack payment webhooks.

**Features**:
- HMAC SHA512 signature verification (using Web Crypto API)
- Contribution payment processing
- Security deposit payment processing
- Automatic database updates

**Environment Variables**:
```bash
PAYSTACK_SECRET_KEY=sk_test_your_secret_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Deployment**:
```bash
# Using the deployment script (recommended)
./deploy-edge-functions.sh paystack-webhook

# Or manually
supabase functions deploy paystack-webhook --no-verify
```

**Note**: The `--no-verify` flag is required due to transitive dependencies in some packages.

**Webhook URL**:
```
https://your-project.supabase.co/functions/v1/paystack-webhook
```

**Configure in Paystack**:
1. Go to Settings > Webhooks in Paystack Dashboard
2. Add webhook URL
3. Select events: `charge.success`

### 2. Email Notifications (`send-email`)

**Purpose**: Sends email notifications via SMTP.

**Features**:
- Multiple email templates (contribution paid, payout received, penalty applied, etc.)
- HTML email formatting
- SMTP integration

**Environment Variables**:
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=noreply@smartajo.com
SMTP_FROM_NAME=Smart Ajo
```

**Deployment**:
```bash
# Using the deployment script (recommended)
./deploy-edge-functions.sh send-email

# Or manually
supabase functions deploy send-email --no-verify
```

**Note**: The `--no-verify` flag is required due to transitive dependencies in the denomailer SMTP library.

**Usage Example**:
```javascript
const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to: 'user@example.com',
    subject: 'Payment Received',
    type: 'contribution_paid',
    data: {
      userName: 'John Doe',
      amount: 10000,
      groupName: 'My Group',
      cycleNumber: 1,
      date: new Date().toISOString(),
      reference: 'REF123',
      appUrl: 'https://smartajo.com',
      groupId: 'group-id',
    },
  }),
});
```

### 3. Payment Verification (`verify-payment`)

**Purpose**: Verifies payments with Paystack and updates the database.

**Features**:
- Verifies payment with Paystack API using secret key
- Updates payment records in database
- Processes contribution and security deposit payments
- Idempotent (safe to call multiple times)
- CORS enabled for frontend access

**Environment Variables**:
```bash
PAYSTACK_SECRET_KEY=sk_test_your_secret_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Note**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically injected by Supabase. You need to manually set `SUPABASE_ANON_KEY` and `PAYSTACK_SECRET_KEY` as secrets:
```bash
supabase secrets set SUPABASE_ANON_KEY=your_anon_key_here
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key
```

**Deployment**:
```bash
supabase functions deploy verify-payment
```

**Usage Example** (from frontend):
```javascript
const response = await supabase.functions.invoke('verify-payment', {
  body: { reference: 'payment_reference' }
});
```

**CORS Configuration**:
The function includes proper CORS headers to allow frontend access:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`
- `Access-Control-Allow-Methods: POST, OPTIONS`

### 4. BVN Verification (`verify-bvn`)

**Purpose**: Verifies user identity using Bank Verification Number (BVN).

**Features**:
- Paystack Identity API integration
- Flutterwave KYC API integration
- Mock mode for testing
- Automatic KYC status update

**Environment Variables**:
```bash
# Choose one provider
BVN_PROVIDER=paystack  # Options: paystack, flutterwave, mock
BVN_API_KEY=your_api_key

# Or use existing Paystack key
PAYSTACK_SECRET_KEY=sk_test_your_secret_key

# Or Flutterwave
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-your_secret_key

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Deployment**:
```bash
supabase functions deploy verify-bvn
```

**Usage Example** (from frontend):
```javascript
const response = await fetch(`${supabaseUrl}/functions/v1/verify-bvn`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    bvn: '12345678901',
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '1990-01-01',
    phoneNumber: '08012345678',
  }),
});
```

## Deployment Steps

### 1. Install Supabase CLI

```bash
npm install -g supabase
```

### 2. Login to Supabase

```bash
supabase login
```

### 3. Link Your Project

```bash
supabase link --project-ref your-project-ref
```

### 4. Set Environment Variables

Set secrets for each function:

```bash
# Paystack webhook
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...
supabase secrets set SUPABASE_URL=https://...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...

# Email notifications
supabase secrets set SMTP_HOST=smtp.gmail.com
supabase secrets set SMTP_PORT=587
supabase secrets set SMTP_USER=...
supabase secrets set SMTP_PASSWORD=...
supabase secrets set SMTP_FROM_EMAIL=...
supabase secrets set SMTP_FROM_NAME="Smart Ajo"

# BVN verification
supabase secrets set BVN_PROVIDER=mock  # or paystack, flutterwave
supabase secrets set BVN_API_KEY=...
```

### 5. Deploy Functions

**Recommended: Use the deployment script**
```bash
# Deploy all functions
./deploy-edge-functions.sh

# Or deploy a specific function
./deploy-edge-functions.sh paystack-webhook
```

**Manual deployment**
```bash
# Deploy individual functions with --no-verify flag
supabase functions deploy verify-payment --no-verify
supabase functions deploy paystack-webhook --no-verify
supabase functions deploy send-email --no-verify
supabase functions deploy verify-bvn --no-verify
```

**Note**: The `--no-verify` flag is required to allow transitive dependencies in some packages (denomailer, hmac) that import from external registries.

### 6. Test Functions

Test locally:
```bash
supabase functions serve

# In another terminal
curl -X POST http://localhost:54321/functions/v1/paystack-webhook \
  -H "Content-Type: application/json" \
  -H "x-paystack-signature: test-signature" \
  -d '{"event": "charge.success", ...}'
```

## SMTP Configuration

### Gmail Setup

1. Enable 2-Factor Authentication
2. Generate App Password:
   - Go to Google Account > Security > 2-Step Verification
   - Scroll to "App passwords"
   - Generate password for "Mail" app
3. Use the generated password in `SMTP_PASSWORD`

### SendGrid Setup

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your_sendgrid_api_key
SMTP_FROM_EMAIL=noreply@yourdomain.com
```

### AWS SES Setup

```bash
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your_ses_smtp_username
SMTP_PASSWORD=your_ses_smtp_password
SMTP_FROM_EMAIL=verified@yourdomain.com
```

## BVN Verification Providers

### Paystack Identity (Recommended)

- **Cost**: ₦50 per verification
- **Accuracy**: High
- **Setup**: Use existing Paystack account
- **Documentation**: https://paystack.com/docs/identity-verification/

### Flutterwave KYC

- **Cost**: Variable pricing
- **Accuracy**: High
- **Setup**: Requires Flutterwave account
- **Documentation**: https://developer.flutterwave.com/docs/kyc-verification

### Mock Mode (Development Only)

- **Cost**: Free
- **Accuracy**: N/A (always succeeds if BVN is 11 digits)
- **Setup**: Set `BVN_PROVIDER=mock`
- **Note**: DO NOT USE IN PRODUCTION

## Monitoring and Debugging

### View Function Logs

```bash
supabase functions logs paystack-webhook
supabase functions logs send-email
supabase functions logs verify-bvn
```

### Check Function Status

```bash
supabase functions list
```

### Test Webhooks Locally

Use tools like:
- [ngrok](https://ngrok.com/) for local webhook testing
- [webhook.site](https://webhook.site/) for webhook inspection

## Security Best Practices

1. **Never expose service role key to frontend**
2. **Always verify webhook signatures**
3. **Use environment variables for all secrets**
4. **Rotate API keys regularly**
5. **Monitor function logs for suspicious activity**
6. **Implement rate limiting for sensitive endpoints**
7. **Use HTTPS only in production**

## Troubleshooting

### Webhook not receiving events

1. Check webhook URL is correct in Paystack dashboard
2. Verify function is deployed: `supabase functions list`
3. Check function logs: `supabase functions logs paystack-webhook`
4. Test webhook signature verification

### Email not sending

1. Verify SMTP credentials
2. Check SMTP port (587 for TLS, 465 for SSL)
3. Enable "Less secure app access" for Gmail (or use App Password)
4. Check function logs: `supabase functions logs send-email`

### BVN verification failing

1. Verify API key is correct
2. Check provider (Paystack/Flutterwave) account has sufficient balance
3. Ensure BVN format is correct (11 digits)
4. Check function logs: `supabase functions logs verify-bvn`

## Additional Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Paystack Webhook Docs](https://paystack.com/docs/payments/webhooks)
- [Deno Deploy Docs](https://deno.com/deploy/docs)
