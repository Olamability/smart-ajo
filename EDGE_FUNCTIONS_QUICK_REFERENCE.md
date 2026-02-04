# Edge Functions - Quick Reference

## 🚀 Quick Deployment Commands

### Prerequisites Check
```bash
# Check if Supabase CLI is installed
supabase --version

# If not installed:
npm install -g supabase
```

### One-Command Deployment
```bash
# Login, link, and deploy everything
supabase login
supabase link --project-ref YOUR_PROJECT_REF
./deploy-edge-functions.sh
```

---

## 📋 Edge Functions Overview

### verify-payment
**Path:** `supabase/functions/verify-payment/index.ts`

**Purpose:** Verifies Paystack payments and activates group memberships

**Environment Variables:**
- `PAYSTACK_SECRET_KEY` (required)
- `SUPABASE_URL` (auto-configured)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-configured)

**Deploy:**
```bash
supabase functions deploy verify-payment --no-verify-jwt
```

**Test:**
```bash
# Use Paystack test card
Card: 4084084084084081
CVV: 123
PIN: 1234
OTP: 123456
```

---

### verify-bvn
**Path:** `supabase/functions/verify-bvn/index.ts`

**Purpose:** Verifies Bank Verification Numbers for KYC (optional feature)

**Environment Variables:**
- `BVN_VERIFICATION_API_KEY` (optional - uses mock if not set)
- `BVN_VERIFICATION_API_URL` (optional - uses mock if not set)
- `SUPABASE_URL` (auto-configured)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-configured)

**Deploy:**
```bash
supabase functions deploy verify-bvn
```

**Test:**
```bash
# Test BVNs
Success: 22222222222
Failure: 00000000000
```

---

## 🔑 Required Secrets

### Set Paystack Secret Key (Required)
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key
```

### Set BVN API Credentials (Optional)
```bash
supabase secrets set BVN_VERIFICATION_API_KEY=your_api_key
supabase secrets set BVN_VERIFICATION_API_URL=https://api.provider.com
```

### View Configured Secrets
```bash
supabase secrets list
```

---

## 🧪 Testing

### Test Payment Verification
1. Create a group in the application
2. Select a payout slot
3. Click "Pay Now"
4. Use test card: `4084084084084081`
5. Complete payment
6. Verify membership is activated

### Test BVN Verification (Optional)
1. Navigate to `/kyc-verification`
2. Enter test BVN: `22222222222`
3. Fill in name and date of birth
4. Submit
5. Verify status updates to "verified"

### Check Logs
```bash
# View real-time logs
supabase functions logs verify-payment --tail
supabase functions logs verify-bvn --tail

# View recent logs
supabase functions logs verify-payment
```

---

## 🔍 Troubleshooting

### Payment Verification Fails
```bash
# Check if function is deployed
supabase functions list

# Check if secret is set
supabase secrets list

# View logs for errors
supabase functions logs verify-payment --tail
```

### CORS Errors
```bash
# Redeploy function
supabase functions deploy verify-payment --no-verify-jwt
```

### Authentication Errors
```bash
# Re-login
supabase login

# Re-link project
supabase link --project-ref YOUR_PROJECT_REF
```

---

## 📊 Function Status

### Check Deployed Functions
```bash
supabase functions list
```

### Check Function Details
```bash
# Get function info
supabase functions inspect verify-payment

# Get function logs
supabase functions logs verify-payment
```

---

## 🔐 Security Notes

### Frontend Environment Variables (Public)
```bash
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxx
```

### Backend Secrets (Private - Supabase only)
```bash
PAYSTACK_SECRET_KEY=sk_test_xxx
BVN_VERIFICATION_API_KEY=xxx (optional)
```

**Never mix these up!**
- Public keys → Frontend (.env files)
- Secret keys → Supabase secrets only

---

## 📱 Production Deployment

### Switch to Live Keys
```bash
# Update Supabase secret
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_live_key

# Update Vercel/frontend environment
VITE_PAYSTACK_PUBLIC_KEY=pk_live_your_live_key
```

### Monitor Production
```bash
# Watch logs
supabase functions logs verify-payment --tail

# Check Paystack dashboard
# - Verify transactions
# - Monitor success rates
```

---

## 🆘 Quick Help

### Common Issues

**Issue:** Function not found
```bash
# Solution: Deploy function
supabase functions deploy verify-payment --no-verify-jwt
```

**Issue:** Payment verification fails
```bash
# Solution: Set Paystack secret
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx
```

**Issue:** CORS error
```bash
# Solution: Redeploy function
supabase functions deploy verify-payment --no-verify-jwt
```

**Issue:** BVN verification fails
```bash
# Solution: Check user is authenticated
# The function requires a valid JWT token in Authorization header
```

---

## 📚 Documentation

- **Full Guide:** `EDGE_FUNCTIONS_DEPLOYMENT.md`
- **Configuration:** `CONFIGURATION_VALIDATION.md`
- **Payment Guide:** `PAYMENT_DEPLOYMENT_GUIDE.md`
- **Supabase Docs:** https://supabase.com/docs/guides/functions

---

## ✅ Deployment Checklist

Quick checklist for deployment:

- [ ] Supabase CLI installed
- [ ] Logged in: `supabase login`
- [ ] Project linked: `supabase link --project-ref XXX`
- [ ] verify-payment deployed
- [ ] verify-bvn deployed
- [ ] Paystack secret set
- [ ] Functions list shows both functions
- [ ] Payment flow tested
- [ ] Logs checked for errors

---

**Version:** 1.0.0  
**Last Updated:** 2026-02-04
