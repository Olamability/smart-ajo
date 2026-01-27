# Payment Processor Deployment - Visual Guide

## Architecture: How payment-processor.ts Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    Edge Functions Architecture                  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐
│   verify-payment     │         │  paystack-webhook    │
│   Edge Function      │         │   Edge Function      │
│                      │         │                      │
│  ┌────────────────┐  │         │  ┌────────────────┐  │
│  │  index.ts      │  │         │  │  index.ts      │  │
│  │                │  │         │  │                │  │
│  │  import {      │  │         │  │  import {      │  │
│  │    process...  │──┼─────┐   │  │    process...  │──┼──┐
│  │  } from        │  │     │   │  │  } from        │  │  │
│  │  "../_shared/  │  │     │   │  │  "../_shared/  │  │  │
│  │   payment-     │  │     │   │  │   payment-     │  │  │
│  │   processor"   │  │     │   │  │   processor"   │  │  │
│  └────────────────┘  │     │   │  └────────────────┘  │  │
└──────────────────────┘     │   └──────────────────────┘  │
                             │                             │
                             │                             │
                             ▼                             ▼
                  ┌──────────────────────────────────────────┐
                  │  supabase/functions/_shared/             │
                  │  payment-processor.ts                    │
                  │                                          │
                  │  ✓ processGroupCreationPayment()         │
                  │  ✓ processGroupJoinPayment()             │
                  │  ✓ createPaymentTransactions()           │
                  │                                          │
                  │  Shared business logic used by both      │
                  │  edge functions                          │
                  └──────────────────────────────────────────┘
```

## Deployment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      Deployment Process                         │
└─────────────────────────────────────────────────────────────────┘

1. Prerequisites Setup
   ┌──────────────────────────────────────┐
   │ npm install -g supabase             │
   │ supabase login                      │
   │ supabase link --project-ref XXX     │
   └──────────────────────────────────────┘
                    │
                    ▼
2. Set Secrets
   ┌──────────────────────────────────────┐
   │ supabase secrets set                │
   │   PAYSTACK_SECRET_KEY=sk_test_...   │
   │ supabase secrets set                │
   │   SUPABASE_ANON_KEY=eyJ...          │
   └──────────────────────────────────────┘
                    │
                    ▼
3. Deploy Functions
   ┌──────────────────────────────────────┐
   │ ./deploy-edge-functions.sh          │
   │                                      │
   │ OR                                   │
   │                                      │
   │ supabase functions deploy           │
   │   verify-payment --no-verify        │
   └──────────────────────────────────────┘
                    │
                    ▼
4. Supabase Bundles & Deploys
   ┌──────────────────────────────────────┐
   │ ┌──────────────────────────────────┐ │
   │ │ verify-payment/index.ts          │ │
   │ │ +                                │ │
   │ │ _shared/payment-processor.ts     │ │
   │ │ +                                │ │
   │ │ All dependencies                 │ │
   │ │        ↓                         │ │
   │ │   Bundled & Deployed to          │ │
   │ │   Supabase Edge Runtime          │ │
   │ └──────────────────────────────────┘ │
   └──────────────────────────────────────┘
                    │
                    ▼
5. Verify Deployment
   ┌──────────────────────────────────────┐
   │ supabase functions list             │
   │ supabase functions logs             │
   │   verify-payment                    │
   └──────────────────────────────────────┘
```

## Payment Processing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                How Payment Processing Works                     │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐
│   Frontend   │
│   Payment    │
│   Complete   │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│ Call verify-payment Edge Function    │
│ POST /verify-payment                 │
│ Body: { reference: "PAY_123" }       │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ verify-payment/index.ts              │
│                                      │
│ 1. Verify with Paystack API          │
│ 2. Import processGroupCreation...()  │
│    from payment-processor.ts         │
│ 3. Process payment                   │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ payment-processor.ts                 │
│                                      │
│ ✓ Check if already processed         │
│   (idempotent)                       │
│ ✓ Add user to group                  │
│ ✓ Create contribution record         │
│ ✓ Create transaction records         │
│ ✓ Update member status               │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ Return result to frontend            │
│ { success: true, position: 1 }       │
└──────────────────────────────────────┘

SIMULTANEOUSLY (Backup/Redundancy):

┌──────────────┐
│   Paystack   │
│   Sends      │
│   Webhook    │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│ paystack-webhook Edge Function       │
│ POST /paystack-webhook               │
│ Body: { event: "charge.success" }    │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ paystack-webhook/index.ts            │
│                                      │
│ 1. Verify webhook signature          │
│ 2. Import processGroupCreation...()  │
│    from payment-processor.ts         │
│ 3. Process payment (same logic)      │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ payment-processor.ts                 │
│                                      │
│ ✓ Check if already processed         │
│   → Already done by verify-payment!  │
│ ✓ Return success (idempotent)        │
└──────────────────────────────────────┘
```

## Deployment Decision Tree

```
                 Need to deploy payment-processor.ts?
                              │
                              ▼
                     ┌─────────────────┐
                     │ Is it a NEW     │
                     │ deployment?     │
                     └────┬───────┬────┘
                          │       │
                    YES   │       │   NO
                          │       │
              ┌───────────▼       ▼───────────┐
              │                               │
              ▼                               ▼
    ┌─────────────────┐          ┌──────────────────────┐
    │ Deploy all      │          │ Did you MODIFY       │
    │ functions:      │          │ payment-processor.ts?│
    │                 │          └──────┬───────┬───────┘
    │ ./deploy-edge-  │                 │       │
    │   functions.sh  │           YES   │       │   NO
    └─────────────────┘                 │       │
                              ┌─────────▼       ▼─────────┐
                              │                           │
                              ▼                           ▼
                    ┌──────────────────┐      ┌─────────────────┐
                    │ Redeploy funcs   │      │ No action       │
                    │ that use it:     │      │ needed!         │
                    │                  │      │                 │
                    │ supabase funcs   │      │ payment-        │
                    │   deploy         │      │ processor.ts is │
                    │   verify-payment │      │ already         │
                    │   --no-verify    │      │ deployed        │
                    │                  │      └─────────────────┘
                    │ supabase funcs   │
                    │   deploy         │
                    │   paystack-      │
                    │   webhook        │
                    │   --no-verify    │
                    └──────────────────┘
```

## Files Involved

```
smart-ajo/
├── supabase/
│   └── functions/
│       ├── _shared/
│       │   └── payment-processor.ts  ← Shared module (auto-included)
│       │
│       ├── verify-payment/
│       │   └── index.ts              ← Imports payment-processor.ts
│       │
│       └── paystack-webhook/
│           └── index.ts              ← Imports payment-processor.ts
│
├── deploy-edge-functions.sh         ← Deployment script
├── PAYMENT_PROCESSOR_DEPLOYMENT.md  ← Full guide (this doc)
└── DEPLOY_PAYMENT_PROCESSOR_QUICKSTART.md  ← Quick reference
```

## Common Scenarios

### Scenario 1: First Time Deployment
```bash
# You have never deployed edge functions before
./deploy-edge-functions.sh

# Result: All functions deployed including verify-payment 
# and paystack-webhook (which contain payment-processor.ts)
```

### Scenario 2: Update payment-processor.ts Logic
```bash
# You edited supabase/functions/_shared/payment-processor.ts
# Now you need to redeploy functions that use it

supabase functions deploy verify-payment --no-verify
supabase functions deploy paystack-webhook --no-verify

# Result: Updated logic is now live
```

### Scenario 3: Update Only verify-payment
```bash
# You edited supabase/functions/verify-payment/index.ts
# payment-processor.ts unchanged

supabase functions deploy verify-payment --no-verify

# Result: Only verify-payment is redeployed
# payment-processor.ts is included automatically
```

### Scenario 4: Deploy to Multiple Environments
```bash
# Development
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...
./deploy-edge-functions.sh

# Production (link different project)
supabase link --project-ref PROD_PROJECT_REF
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_...
./deploy-edge-functions.sh

# Result: Same code deployed to both environments
# with different configurations
```

## Troubleshooting Flowchart

```
          Deployment failing?
                 │
                 ▼
        ┌────────────────┐
        │ Error message? │
        └────┬───────────┘
             │
    ┌────────┼────────┐
    │                 │
    ▼                 ▼
"CLI not       "Module not
installed"      found"
    │                 │
    ▼                 ▼
npm install    Check import
-g supabase    path uses ../
                not ./


    ┌────────┼────────┐
    │                 │
    ▼                 ▼
"PAYSTACK_      "verify
SECRET_KEY      error"
not config"        │
    │              ▼
    ▼          Add --no-
supabase       verify flag
secrets set
KEY=value
```

## Success Checklist

After deployment, verify:

```
✓ supabase functions list
  Shows: verify-payment, paystack-webhook

✓ supabase functions logs verify-payment
  Shows: Recent deployments, no errors

✓ supabase secrets list
  Shows: PAYSTACK_SECRET_KEY, SUPABASE_ANON_KEY

✓ Test payment in application
  Payment processes successfully

✓ Check database
  group_members record created
  transactions records created
  contributions record created
```

## Key Takeaways

1. **payment-processor.ts is NOT deployed directly** - it's a shared module

2. **It's automatically included** when you deploy verify-payment or paystack-webhook

3. **One deployment command** deploys everything:
   ```bash
   ./deploy-edge-functions.sh
   ```

4. **Shared logic ensures consistency** - both functions use same business logic

5. **Idempotent operations** - safe to call multiple times, no duplicate processing

6. **Changes require redeployment** - after editing payment-processor.ts, redeploy the functions that use it
