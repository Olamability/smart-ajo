# How to Deploy payment-processor.ts - COMPLETE ANSWER

## TL;DR - The Answer

**Question**: How do I deploy this edge function: payment-processor.ts?

**Answer**: `payment-processor.ts` is **not deployed directly**. It's a shared library that's automatically included when you deploy the edge functions that use it.

**Deployment Command**:
```bash
./deploy-edge-functions.sh
```

That's it! ✅

---

## What is payment-processor.ts?

- **Type**: Shared library module (not a standalone edge function)
- **Location**: `supabase/functions/_shared/payment-processor.ts`
- **Purpose**: Contains reusable payment processing business logic
- **Used by**: 
  - `verify-payment` edge function
  - `paystack-webhook` edge function

---

## Complete Deployment Guide

### Choose Your Path

Pick the guide that matches your needs:

#### 🎯 For First-Time Users
**[First Time Deployment Guide](./FIRST_TIME_DEPLOYMENT_GUIDE.md)**
- Complete step-by-step walkthrough
- Beginner-friendly
- Includes screenshots and examples
- ~15 minutes

#### ⚡ For Quick Deployment  
**[Quick Start Guide](./DEPLOY_PAYMENT_PROCESSOR_QUICKSTART.md)**
- Essential commands only
- Quick troubleshooting
- ~2 minutes

#### 📚 For Deep Understanding
**[Payment Processor Deployment Guide](./PAYMENT_PROCESSOR_DEPLOYMENT.md)**
- Comprehensive documentation
- All configuration options
- Security best practices
- Production checklist

#### 📊 For Visual Learners
**[Visual Guide](./PAYMENT_PROCESSOR_VISUAL_GUIDE.md)**
- Architecture diagrams
- Deployment flowcharts
- Decision trees

#### 🚀 For Automation
**[CI/CD Guide](./CICD_EDGE_FUNCTIONS.md)**
- GitHub Actions workflows
- Automated deployment
- Environment-specific deployment

#### 📖 Need Navigation?
**[Deployment Index](./EDGE_FUNCTIONS_DEPLOYMENT_INDEX.md)**
- Complete documentation index
- Quick navigation by task
- Learning path recommendations

---

## Quick Setup (5 Steps)

If you just want to get it deployed quickly:

```bash
# 1. Install Supabase CLI
npm install -g supabase

# 2. Login and link project
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# 3. Set required secrets
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_key
supabase secrets set SUPABASE_ANON_KEY=your_anon_key

# 4. Deploy all edge functions
./deploy-edge-functions.sh

# 5. Verify deployment
supabase functions list
```

**Done!** ✅ The `payment-processor.ts` module is now deployed as part of `verify-payment` and `paystack-webhook`.

---

## How It Works

```
When you run: ./deploy-edge-functions.sh

1. Supabase CLI bundles verify-payment/index.ts
   └─> Includes _shared/payment-processor.ts automatically

2. Supabase CLI bundles paystack-webhook/index.ts  
   └─> Includes _shared/payment-processor.ts automatically

3. Both functions are deployed to Supabase Edge Runtime
   └─> payment-processor.ts is included in both

Result: payment-processor.ts is deployed (twice, as part of each function)
```

---

## Common Scenarios

### Scenario 1: First Time Deployment
```bash
./deploy-edge-functions.sh
```
**Result**: All functions deployed, including those using payment-processor.ts

### Scenario 2: Update payment-processor.ts
```bash
# Edit the file
vim supabase/functions/_shared/payment-processor.ts

# Redeploy functions that use it
supabase functions deploy verify-payment --no-verify
supabase functions deploy paystack-webhook --no-verify
```
**Result**: Updated logic is now live in both functions

### Scenario 3: Deploy Only Payment Functions
```bash
supabase functions deploy verify-payment --no-verify
supabase functions deploy paystack-webhook --no-verify
```
**Result**: Only payment-related functions deployed (with payment-processor.ts)

---

## FAQ

### Q: Do I need to deploy payment-processor.ts separately?
**A**: No! It's automatically included when you deploy verify-payment or paystack-webhook.

### Q: How do I know if it's deployed?
**A**: If verify-payment and paystack-webhook are deployed, then payment-processor.ts is deployed.
```bash
supabase functions list
# Should show: verify-payment ✓, paystack-webhook ✓
```

### Q: Can I deploy only payment-processor.ts?
**A**: No, it's a shared module, not a standalone function. Deploy the functions that use it.

### Q: What if I make changes to payment-processor.ts?
**A**: Redeploy the functions that import it:
```bash
supabase functions deploy verify-payment --no-verify
supabase functions deploy paystack-webhook --no-verify
```

### Q: Why do I need both verify-payment and paystack-webhook?
**A**: For reliability:
- `verify-payment` - Primary processor (runs when user completes payment)
- `paystack-webhook` - Backup processor (runs if Paystack sends webhook)
- Both use same logic from payment-processor.ts
- Logic is idempotent (safe to run twice)

### Q: How do I test if it's working?
**A**: 
1. Check logs: `supabase functions logs verify-payment`
2. Test payment in your app
3. Verify database records are created

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Module not found" | Check import uses `../` not `./` |
| "PAYSTACK_SECRET_KEY not configured" | Run: `supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...` |
| Deployment fails | Add `--no-verify` flag |
| CORS errors | Redeploy: `supabase functions deploy verify-payment --no-verify` |
| Payment not processing | Check logs: `supabase functions logs verify-payment` |

**More help**: See [FIRST_TIME_DEPLOYMENT_GUIDE.md - Troubleshooting](./FIRST_TIME_DEPLOYMENT_GUIDE.md#troubleshooting)

---

## Production Deployment

When deploying to production:

```bash
# Link to production project
supabase link --project-ref YOUR_PRODUCTION_PROJECT_REF

# Use live API keys
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_live_key
supabase secrets set SUPABASE_ANON_KEY=your_production_anon_key

# Deploy
./deploy-edge-functions.sh

# Verify
supabase functions list
curl https://YOUR_PROD_PROJECT.supabase.co/functions/v1/health-check
```

**See**: [PAYMENT_PROCESSOR_DEPLOYMENT.md - Production Checklist](./PAYMENT_PROCESSOR_DEPLOYMENT.md#production-checklist)

---

## Next Steps

After deployment:

1. **Test the payment flow** in your application
2. **Configure Paystack webhook** (optional but recommended)
3. **Set up monitoring** and alerts
4. **Review logs** regularly: `supabase functions logs verify-payment`
5. **Plan for CI/CD** using the [CI/CD Guide](./CICD_EDGE_FUNCTIONS.md)

---

## Documentation Suite

This answer is part of a comprehensive documentation suite:

| Document | Purpose | When to Use |
|----------|---------|-------------|
| **This Document** | Quick answer to deployment question | Always start here |
| [Deployment Index](./EDGE_FUNCTIONS_DEPLOYMENT_INDEX.md) | Navigation hub | Need to find specific topic |
| [First Time Guide](./FIRST_TIME_DEPLOYMENT_GUIDE.md) | Complete walkthrough | First deployment |
| [Quick Start](./DEPLOY_PAYMENT_PROCESSOR_QUICKSTART.md) | Quick reference | Subsequent deployments |
| [Full Guide](./PAYMENT_PROCESSOR_DEPLOYMENT.md) | Comprehensive docs | Deep understanding |
| [Visual Guide](./PAYMENT_PROCESSOR_VISUAL_GUIDE.md) | Diagrams & flowcharts | Visual learner |
| [CI/CD Guide](./CICD_EDGE_FUNCTIONS.md) | Automation | Production setup |

---

## Summary

✅ **payment-processor.ts is a shared module**, not a standalone edge function

✅ **Deploy with**: `./deploy-edge-functions.sh`

✅ **It's automatically included** in verify-payment and paystack-webhook

✅ **No special deployment needed** - just deploy the functions that use it

✅ **Update by redeploying** the functions that import it

---

**Still have questions?** Check the [Deployment Index](./EDGE_FUNCTIONS_DEPLOYMENT_INDEX.md) for complete navigation.

**Ready to deploy?** Start with the [First Time Deployment Guide](./FIRST_TIME_DEPLOYMENT_GUIDE.md)!
