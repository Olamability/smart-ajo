# Payment Processor Deployment Guide

## Understanding payment-processor.ts

**Important**: `payment-processor.ts` is **NOT** a standalone Edge Function. It is a **shared library module** located in `/supabase/functions/_shared/` that contains reusable payment processing business logic.

### What is payment-processor.ts?

It's a TypeScript module that provides:
- Payment transaction creation logic
- Group creation payment processing
- Group join payment processing  
- Idempotent operations (safe to call multiple times)
- Shared business logic between multiple edge functions

### Which Edge Functions Use It?

The `payment-processor.ts` module is imported and used by:

1. **verify-payment** - Primary payment processor (user-initiated, synchronous)
2. **paystack-webhook** - Backup payment processor (Paystack-initiated, asynchronous)

Both functions execute the same business logic for reliability and redundancy.

## How to Deploy payment-processor.ts

Since `payment-processor.ts` is a shared module, you **do not deploy it directly**. Instead, you deploy the Edge Functions that import it:

### Quick Deployment (Recommended)

Use the provided deployment script to deploy all edge functions (including those using payment-processor):

```bash
./deploy-edge-functions.sh
```

This will deploy:
- `verify-payment` (which uses payment-processor.ts)
- `paystack-webhook` (which uses payment-processor.ts)
- `send-email`
- `verify-bvn`
- `health-check`

### Deploy Specific Functions

To deploy only the functions that use payment-processor.ts:

```bash
# Deploy verify-payment (includes payment-processor.ts)
./deploy-edge-functions.sh verify-payment

# Deploy paystack-webhook (includes payment-processor.ts)
./deploy-edge-functions.sh paystack-webhook
```

### Manual Deployment

If you prefer manual deployment:

```bash
# Prerequisites
npm install -g supabase  # Install Supabase CLI
supabase login           # Login to Supabase
supabase link --project-ref YOUR_PROJECT_REF  # Link your project

# Deploy verify-payment (includes payment-processor.ts)
supabase functions deploy verify-payment --no-verify

# Deploy paystack-webhook (includes payment-processor.ts)  
supabase functions deploy paystack-webhook --no-verify
```

**Note**: The `--no-verify` flag is required for functions with transitive dependencies.

## Prerequisites

Before deploying, ensure you have:

### 1. Supabase CLI Installed

```bash
npm install -g supabase
```

### 2. Authentication

```bash
supabase login
```

### 3. Project Linked

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

Find your project ref in your Supabase dashboard URL:
`https://app.supabase.com/project/YOUR_PROJECT_REF`

### 4. Environment Secrets Configured

The functions using payment-processor.ts require these secrets:

```bash
# Required for verify-payment
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key
supabase secrets set SUPABASE_ANON_KEY=your_anon_key

# Required for paystack-webhook
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_secret_key
```

**Note**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically injected by Supabase.

## Deployment Steps (Detailed)

### Step 1: Set Environment Secrets

```bash
# Get your Paystack secret key from: https://dashboard.paystack.com/settings/developer
# Get your Supabase anon key from: Supabase Dashboard > Settings > API

supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_paystack_secret_key
supabase secrets set SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Step 2: Deploy Edge Functions

```bash
# Option A: Deploy all functions (recommended)
./deploy-edge-functions.sh

# Option B: Deploy specific functions
supabase functions deploy verify-payment --no-verify
supabase functions deploy paystack-webhook --no-verify
```

### Step 3: Verify Deployment

```bash
# List deployed functions
supabase functions list

# Test verify-payment function
curl -X POST 'https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment' \
  -H 'Authorization: Bearer YOUR_USER_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"reference": "test_reference"}'

# Test CORS for verify-payment
curl -X OPTIONS 'https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment' \
  -H 'Origin: https://your-frontend-domain.com' \
  -H 'Access-Control-Request-Method: POST' \
  -v
```

### Step 4: Configure Paystack Webhook (Optional but Recommended)

The webhook serves as a backup payment processor:

1. Go to [Paystack Dashboard > Settings > Webhooks](https://dashboard.paystack.com/settings/webhooks)
2. Add webhook URL:
   ```
   https://YOUR_PROJECT.supabase.co/functions/v1/paystack-webhook
   ```
3. Select events: `charge.success`
4. Save webhook configuration

## What Happens When You Deploy?

When you deploy `verify-payment` or `paystack-webhook`:

1. **Supabase CLI bundles the function** with all its imports
2. **payment-processor.ts is included** in the bundle automatically
3. **The function is deployed** to Supabase Edge Runtime
4. **The shared module code** is available to the function at runtime

You don't need to do anything special for `payment-processor.ts` - it's automatically included!

## Testing the Deployment

### Test verify-payment Locally

```bash
# Start local Supabase
supabase functions serve verify-payment

# In another terminal, test the function
curl -X POST 'http://localhost:54321/functions/v1/verify-payment' \
  -H 'Authorization: Bearer YOUR_TEST_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"reference": "test_ref_123"}'
```

### Test verify-payment in Production

After deployment, test from your frontend:

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Verify payment
const { data, error } = await supabase.functions.invoke('verify-payment', {
  body: { reference: 'payment_reference_from_paystack' }
});

console.log('Verification result:', data);
```

## Monitoring and Logs

### View Function Logs

```bash
# View verify-payment logs
supabase functions logs verify-payment

# View paystack-webhook logs  
supabase functions logs paystack-webhook

# Follow logs in real-time
supabase functions logs verify-payment --follow
```

### Check Function Status

```bash
# List all deployed functions
supabase functions list

# Expected output should include:
# - verify-payment
# - paystack-webhook
```

## Troubleshooting

### Issue: "Module not found" error

**Cause**: The shared module import path is incorrect.

**Solution**: Verify the import statement uses the correct relative path:
```typescript
// Correct
import { processGroupCreationPayment } from "../_shared/payment-processor.ts";

// Incorrect
import { processGroupCreationPayment } from "./_shared/payment-processor.ts";
```

### Issue: "PAYSTACK_SECRET_KEY not configured"

**Cause**: Environment secret not set.

**Solution**:
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_key
```

Verify secrets are set:
```bash
supabase secrets list
```

### Issue: "CORS error" when calling verify-payment

**Cause**: CORS headers not properly configured or OPTIONS request failing.

**Solution**: 
1. Redeploy the function:
   ```bash
   supabase functions deploy verify-payment --no-verify
   ```
2. Test CORS:
   ```bash
   curl -X OPTIONS 'https://YOUR_PROJECT.supabase.co/functions/v1/verify-payment' \
     -H 'Origin: https://your-domain.com' \
     -H 'Access-Control-Request-Method: POST' \
     -v
   ```

### Issue: Payment processed twice

**Cause**: Both verify-payment and paystack-webhook processed the same payment.

**Solution**: This is expected and safe! The payment processing logic in `payment-processor.ts` is idempotent - it checks if a payment has already been processed and returns success without duplicating actions.

### Issue: Deployment fails with "verify" error

**Cause**: TypeScript dependencies or transitive imports.

**Solution**: Always use the `--no-verify` flag:
```bash
supabase functions deploy verify-payment --no-verify
```

## Updating payment-processor.ts

When you make changes to `payment-processor.ts`:

1. **Edit the file**: Make your changes to `/supabase/functions/_shared/payment-processor.ts`

2. **Test locally**:
   ```bash
   supabase functions serve verify-payment
   # Test your changes
   ```

3. **Redeploy the functions that use it**:
   ```bash
   supabase functions deploy verify-payment --no-verify
   supabase functions deploy paystack-webhook --no-verify
   ```

4. **Verify the changes**:
   ```bash
   supabase functions logs verify-payment
   ```

## Production Checklist

Before deploying to production:

- [ ] Replace test keys with live keys
  ```bash
  supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_live_key
  ```
- [ ] Test payment flow end-to-end with test cards
- [ ] Configure Paystack webhook with production URL
- [ ] Monitor logs after deployment
- [ ] Set up alerts for function errors
- [ ] Document rollback procedure

## Security Best Practices

1. **Never expose service role key** - It's auto-injected, don't set it manually
2. **Use environment secrets** for all sensitive data
3. **Validate webhook signatures** in paystack-webhook
4. **Implement rate limiting** for verify-payment endpoint
5. **Monitor logs** for suspicious activity
6. **Rotate API keys** regularly

## Additional Resources

- [Supabase Edge Functions Documentation](https://supabase.com/docs/guides/functions)
- [Paystack Payment Verification API](https://paystack.com/docs/payments/verify-payments/)
- [Paystack Webhook Documentation](https://paystack.com/docs/payments/webhooks/)
- [Full Edge Functions Setup Guide](./EDGE_FUNCTIONS_SETUP.md)
- [Payment CORS Fix Guide](./PAYMENT_CORS_FIX_COMPLETE.md)

## Quick Reference Commands

```bash
# Login to Supabase
supabase login

# Link project
supabase link --project-ref YOUR_PROJECT_REF

# Set secrets
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...
supabase secrets set SUPABASE_ANON_KEY=eyJ...

# Deploy all functions
./deploy-edge-functions.sh

# Deploy specific function
supabase functions deploy verify-payment --no-verify

# View logs
supabase functions logs verify-payment

# List functions
supabase functions list

# Test locally
supabase functions serve verify-payment
```

## Summary

**Key Takeaway**: `payment-processor.ts` is automatically deployed when you deploy the Edge Functions that import it (`verify-payment` and `paystack-webhook`). You don't deploy it separately!

**Deployment Command**:
```bash
./deploy-edge-functions.sh
```

This single command deploys all edge functions including those that use `payment-processor.ts`.
