# Quick Start: Deploy payment-processor.ts

**Question**: How do I deploy the payment-processor.ts edge function?

**Answer**: `payment-processor.ts` is a **shared module**, not a standalone edge function. It's automatically deployed when you deploy the functions that use it.

## TL;DR - Just Run This

```bash
./deploy-edge-functions.sh
```

That's it! This deploys all edge functions, including those that use `payment-processor.ts`.

## What is payment-processor.ts?

- **Location**: `supabase/functions/_shared/payment-processor.ts`
- **Type**: Shared library module (not a standalone edge function)
- **Used by**: 
  - `verify-payment` edge function
  - `paystack-webhook` edge function

## Step-by-Step Deployment

### 1. Prerequisites (One-time Setup)

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link your project (find PROJECT_REF in your Supabase dashboard URL)
supabase link --project-ref YOUR_PROJECT_REF
```

### 2. Set Required Secrets

```bash
# Set Paystack secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_paystack_secret_key

# Set Supabase anon key (from your Supabase dashboard)
supabase secrets set SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Deploy

```bash
# Deploy all edge functions (includes payment-processor.ts)
./deploy-edge-functions.sh
```

**Or deploy specific functions**:

```bash
# Deploy verify-payment (includes payment-processor.ts)
supabase functions deploy verify-payment --no-verify

# Deploy paystack-webhook (includes payment-processor.ts)
supabase functions deploy paystack-webhook --no-verify
```

### 4. Verify Deployment

```bash
# List deployed functions
supabase functions list

# Should show:
# - verify-payment ✓
# - paystack-webhook ✓
# - (and other functions)
```

## Common Questions

### Q: Do I need to deploy payment-processor.ts separately?

**A**: No! It's automatically included when you deploy `verify-payment` or `paystack-webhook`.

### Q: How do I update payment-processor.ts?

**A**: Edit the file, then redeploy the functions that use it:

```bash
# Edit the file
vim supabase/functions/_shared/payment-processor.ts

# Redeploy functions that use it
supabase functions deploy verify-payment --no-verify
supabase functions deploy paystack-webhook --no-verify
```

### Q: How do I test if it's working?

**A**: Test the functions that use it:

```bash
# View logs for verify-payment
supabase functions logs verify-payment

# View logs for paystack-webhook
supabase functions logs paystack-webhook
```

### Q: What if I get deployment errors?

**A**: Make sure to use the `--no-verify` flag:

```bash
supabase functions deploy verify-payment --no-verify
```

## Production Deployment

For production, use live API keys:

```bash
# Set live Paystack secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_live_key

# Set production Supabase anon key
supabase secrets set SUPABASE_ANON_KEY=your_production_anon_key

# Deploy
./deploy-edge-functions.sh
```

## Need More Help?

See the comprehensive guide: [PAYMENT_PROCESSOR_DEPLOYMENT.md](./PAYMENT_PROCESSOR_DEPLOYMENT.md)

## Quick Reference

| Command | Description |
|---------|-------------|
| `./deploy-edge-functions.sh` | Deploy all edge functions |
| `supabase functions deploy verify-payment --no-verify` | Deploy verify-payment only |
| `supabase functions deploy paystack-webhook --no-verify` | Deploy paystack-webhook only |
| `supabase functions list` | List deployed functions |
| `supabase functions logs verify-payment` | View verify-payment logs |
| `supabase secrets set KEY=value` | Set environment secret |
| `supabase secrets list` | List configured secrets |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "PAYSTACK_SECRET_KEY not configured" | Run: `supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...` |
| "Module not found" error | Check import path in verify-payment/index.ts uses `../` not `./` |
| Deployment fails | Add `--no-verify` flag to deploy command |
| CORS errors | Redeploy verify-payment: `supabase functions deploy verify-payment --no-verify` |

---

**Remember**: `payment-processor.ts` is automatically deployed with the edge functions that import it. You never deploy it directly!
