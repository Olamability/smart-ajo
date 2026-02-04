# Edge Functions Deployment Guide

This guide provides complete instructions for deploying all required Edge Functions for the Smart Ajo application.

## 📋 Overview

Smart Ajo uses **2 Edge Functions**:

| Function | Purpose | Status | Required |
|----------|---------|--------|----------|
| **verify-payment** | Verifies Paystack payments and activates group membership | ✅ Ready | **CRITICAL** |
| **verify-bvn** | Verifies Bank Verification Numbers for KYC compliance | ✅ Ready | Optional |

## 🚀 Quick Start (5 Minutes)

### Prerequisites

Before deploying, ensure you have:

1. **Supabase Account & Project**
   - Active Supabase project
   - Project URL (e.g., `https://xxxxx.supabase.co`)
   - Anon key (for frontend)
   - Service role key (automatically configured for Edge Functions)

2. **Paystack Account**
   - Test secret key: `sk_test_...` (for development)
   - Test public key: `pk_test_...` (for frontend)
   - Live keys for production

3. **Development Tools**
   - Supabase CLI installed
   - Git (for cloning repository)

### Step 1: Install Supabase CLI

Choose your platform:

```bash
# macOS
brew install supabase/tap/supabase

# Windows (with Scoop)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Linux
brew install supabase/tap/supabase

# npm (all platforms)
npm install -g supabase
```

Verify installation:
```bash
supabase --version
```

### Step 2: Login to Supabase

```bash
supabase login
```

This will open your browser for authentication. Follow the prompts to authenticate.

### Step 3: Link Your Project

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

**How to find your project ref:**
- Go to your Supabase dashboard: https://app.supabase.com/
- Select your project
- Your project ref is in the URL: `https://app.supabase.com/project/YOUR_PROJECT_REF`
- Or find it in Settings → General → Reference ID

### Step 4: Run the Deployment Script

```bash
cd /path/to/smart-ajo
chmod +x deploy-edge-functions.sh
./deploy-edge-functions.sh
```

The script will:
1. ✅ Verify Supabase CLI is installed
2. ✅ Check that your project is linked
3. ✅ Deploy `verify-payment` Edge Function
4. ✅ Deploy `verify-bvn` Edge Function
5. ✅ Prompt for your Paystack secret key
6. ✅ Configure secrets in Supabase
7. ✅ (Optional) Configure BVN verification API

### Step 5: Configure Frontend Environment

Update your `.env.development` file:

```bash
# Supabase Configuration (Public keys only)
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Paystack Configuration (Public key only)
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_public_key

# Application Settings
VITE_APP_NAME=Smart Ajo
VITE_APP_URL=http://localhost:3000
```

**Important:** Never put secret keys in `.env` files that are committed to Git!

### Step 6: Test Your Deployment

```bash
# Start the development server
npm run dev

# Visit http://localhost:3000
# Try creating a group and completing payment
```

---

## 🔧 Manual Deployment (Alternative)

If the script doesn't work or you prefer manual deployment:

### Deploy verify-payment

```bash
supabase functions deploy verify-payment --no-verify-jwt
```

The `--no-verify-jwt` flag is important because payment verification uses custom authorization logic.

### Deploy verify-bvn

```bash
supabase functions deploy verify-bvn
```

This function uses JWT verification, so no special flags are needed.

### Set Secrets

```bash
# Required: Paystack secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key

# Optional: BVN verification API (if using real BVN service)
supabase secrets set BVN_VERIFICATION_API_KEY=your_bvn_api_key
supabase secrets set BVN_VERIFICATION_API_URL=https://api.bvn-provider.com/verify
```

### Verify Deployment

```bash
# List deployed functions
supabase functions list

# Check configured secrets
supabase secrets list
```

---

## 🧪 Testing Edge Functions

### Test verify-payment

Use Paystack test cards to test the payment flow:

| Card Number | Result |
|-------------|--------|
| 4084084084084081 | Success |
| 4084084084084099 | Insufficient Funds |

**Test Payment Flow:**
1. Create a group in the application
2. Select a payout slot
3. Click "Pay Now"
4. Use test card: `4084084084084081`
5. Enter CVV: `123`, PIN: `1234`, OTP: `123456`
6. Payment should be verified and membership activated

### Test verify-bvn

The `verify-bvn` function supports test BVNs in development mode:

| BVN | Result |
|-----|--------|
| 22222222222 | Always passes |
| 00000000000 | Always fails |
| Any other 11-digit | Basic validation |

**Test BVN Verification:**
1. Navigate to `/kyc-verification` in your application
2. Use test BVN: `22222222222`
3. Fill in first name, last name, and date of birth
4. Submit the form
5. Verification should succeed

### Manual API Testing

#### Test verify-payment via curl

```bash
curl -i --location --request POST 'https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "reference": "TEST_REFERENCE_123"
  }'
```

#### Test verify-bvn via curl

```bash
curl -i --location --request POST 'https://YOUR_PROJECT.supabase.co/functions/v1/verify-bvn' \
  --header 'Authorization: Bearer YOUR_USER_JWT_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "bvn": "22222222222",
    "firstName": "John",
    "lastName": "Doe",
    "dateOfBirth": "1990-01-01"
  }'
```

---

## 🔍 Troubleshooting

### Problem: Supabase CLI not found

**Solution:**
```bash
# Install Supabase CLI
npm install -g supabase

# Or use package manager (see Step 1 above)
```

### Problem: Project not linked

**Error Message:** `Error: Supabase project not linked`

**Solution:**
```bash
supabase link --project-ref YOUR_PROJECT_REF
```

### Problem: Deployment fails with authentication error

**Error Message:** `Error: Authentication failed`

**Solution:**
```bash
# Re-authenticate
supabase login

# Try deployment again
./deploy-edge-functions.sh
```

### Problem: Payment verification fails

**Error Message:** `Payment verification failed`

**Possible Causes:**
1. **Paystack secret key not set**
   - Check: `supabase secrets list`
   - Fix: `supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_key`

2. **Wrong Paystack key**
   - Verify you're using the correct test/live key
   - Test keys start with `sk_test_`
   - Live keys start with `sk_live_`

3. **Edge Function not deployed**
   - Check: `supabase functions list`
   - Fix: `supabase functions deploy verify-payment --no-verify-jwt`

**Debug Steps:**
```bash
# Check Edge Function logs
supabase functions logs verify-payment --tail

# Check secrets are set
supabase secrets list
```

### Problem: CORS errors

**Error Message:** `blocked by CORS policy`

**Solution:**
The Edge Functions include CORS headers. If you still see CORS errors:

1. Verify the Edge Function was deployed successfully
2. Check that you're using the correct Supabase URL
3. Ensure frontend is making requests to the correct endpoint
4. Redeploy the function: `supabase functions deploy verify-payment --no-verify-jwt`

### Problem: BVN verification returns 401

**Error Message:** `Invalid or expired authentication token`

**Solution:**
BVN verification requires a valid user JWT token:

1. Ensure user is logged in
2. Check that the Authorization header includes a valid token
3. Token format should be: `Bearer <jwt_token>`
4. Frontend should use `session.access_token` from Supabase Auth

---

## 🔐 Security Best Practices

### Environment Variables

**Frontend (.env files):**
```bash
# ✅ PUBLIC KEYS ONLY - These are exposed to the browser
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_public_key
```

**Backend (Supabase Secrets):**
```bash
# ✅ SECRET KEYS - These are only accessible to Edge Functions
PAYSTACK_SECRET_KEY=sk_test_your_secret_key
BVN_VERIFICATION_API_KEY=your_bvn_api_key (optional)
```

### Never Commit Secrets

```bash
# ❌ NEVER do this
git add .env
git commit -m "Add environment variables"

# ✅ Always use .env.example instead
git add .env.example
git commit -m "Add environment template"
```

### Use Test Keys in Development

```bash
# Development
PAYSTACK_SECRET_KEY=sk_test_...
VITE_PAYSTACK_PUBLIC_KEY=pk_test_...

# Production
PAYSTACK_SECRET_KEY=sk_live_...
VITE_PAYSTACK_PUBLIC_KEY=pk_live_...
```

---

## 🎯 Production Deployment

When deploying to production:

### 1. Switch to Live Paystack Keys

```bash
# Set live secret key in Supabase
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_live_key

# Update frontend environment (Vercel/deployment platform)
VITE_PAYSTACK_PUBLIC_KEY=pk_live_your_live_key
```

### 2. Configure BVN Verification API (Optional)

If you want real BVN verification in production:

```bash
# Set BVN API credentials
supabase secrets set BVN_VERIFICATION_API_KEY=your_production_api_key
supabase secrets set BVN_VERIFICATION_API_URL=https://api.bvn-provider.com/verify
```

**Popular BVN Verification Services:**
- Paystack Identity: https://paystack.com/docs/identity-verification
- Mono: https://mono.co
- Smile Identity: https://usesmileid.com
- Youverify: https://youverify.co

### 3. Enable Paystack Webhooks (Optional)

For real-time payment updates, configure Paystack webhooks:

1. Go to Paystack Dashboard → Settings → Webhooks
2. Add webhook URL: `https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment`
3. (Note: Current implementation doesn't use webhooks but you can extend it)

### 4. Monitor Edge Functions

```bash
# Watch real-time logs
supabase functions logs verify-payment --tail
supabase functions logs verify-bvn --tail

# Check function status
supabase functions list
```

### 5. Set Up Alerts

Monitor these metrics:
- Edge Function invocation count
- Edge Function error rate
- Payment verification success rate
- Database RLS policy errors

---

## 📚 Additional Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli)
- [Paystack API Documentation](https://paystack.com/docs/api)
- [Paystack Test Cards](https://paystack.com/docs/payments/test-payments)

---

## 📞 Support

If you encounter issues not covered in this guide:

1. Check Edge Function logs: `supabase functions logs verify-payment`
2. Verify environment variables are set correctly
3. Test with Paystack test cards first
4. Review the Edge Function source code for additional context

---

## ✅ Deployment Checklist

Before going live:

- [ ] Supabase CLI installed and authenticated
- [ ] Project linked to Supabase
- [ ] `verify-payment` Edge Function deployed
- [ ] `verify-bvn` Edge Function deployed (if using KYC)
- [ ] Paystack secret key configured
- [ ] Frontend environment variables set
- [ ] Test payment flow works end-to-end
- [ ] Test BVN verification (if enabled)
- [ ] Database schema is up to date
- [ ] RLS policies configured correctly
- [ ] Production keys ready (for production deployment)
- [ ] Monitoring and alerts configured

---

**Version:** 1.0.0  
**Last Updated:** 2026-02-04  
**Status:** Production Ready
