# Step-by-Step: First Time Deployment of payment-processor.ts

This guide walks you through deploying the payment-processor.ts edge function **for the very first time**.

## What You'll Learn

By the end of this guide, you'll have:
- ✓ Deployed `verify-payment` edge function (includes payment-processor.ts)
- ✓ Deployed `paystack-webhook` edge function (includes payment-processor.ts)  
- ✓ Configured all required secrets
- ✓ Tested the deployment
- ✓ Set up Paystack webhook

**Time required**: ~15 minutes

---

## Prerequisites

Before you begin, gather these items:

1. **Supabase Project**
   - Create a project at [supabase.com](https://supabase.com)
   - Note your project reference (from dashboard URL)

2. **Paystack Account**
   - Sign up at [paystack.com](https://paystack.com)
   - Get your secret key from [Settings > Developer](https://dashboard.paystack.com/settings/developer)

3. **Terminal Access**
   - macOS: Use Terminal app
   - Windows: Use Git Bash or WSL
   - Linux: Use your preferred terminal

---

## Step 1: Install Supabase CLI

Open your terminal and run:

```bash
npm install -g supabase
```

Verify installation:

```bash
supabase --version
# Should show: supabase 1.x.x
```

**Troubleshooting**:
- If `npm` is not found, install Node.js from [nodejs.org](https://nodejs.org)
- On macOS/Linux, you may need `sudo`: `sudo npm install -g supabase`

---

## Step 2: Login to Supabase

```bash
supabase login
```

This will:
1. Open your browser
2. Ask you to authorize the CLI
3. Return to terminal when complete

**Troubleshooting**:
- If browser doesn't open, copy the URL shown and paste into browser
- Make sure you're logged into supabase.com

---

## Step 3: Navigate to Your Project

```bash
cd /path/to/smart-ajo
```

For example:
```bash
cd ~/projects/smart-ajo
```

Verify you're in the right directory:

```bash
ls -la
# You should see: supabase/ directory, package.json, etc.
```

---

## Step 4: Link to Your Supabase Project

Get your project reference:
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Open your project
3. Look at the URL: `https://app.supabase.com/project/YOUR_PROJECT_REF`
4. Copy `YOUR_PROJECT_REF`

Link your project:

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

Replace `YOUR_PROJECT_REF` with your actual project reference.

Example:
```bash
supabase link --project-ref abcdefghijklmnop
```

**Troubleshooting**:
- "Project not found": Double-check your project reference
- "Not authorized": Make sure you ran `supabase login`

---

## Step 5: Set Required Secrets

### Get Your Keys

**Paystack Secret Key**:
1. Go to [Paystack Dashboard](https://dashboard.paystack.com/settings/developer)
2. Copy your "Secret Key" (starts with `sk_test_` for test mode)

**Supabase Anon Key**:
1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Click Settings > API
3. Copy the "anon public" key (long string starting with `eyJ`)

### Set the Secrets

```bash
# Set Paystack secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_actual_paystack_secret_key

# Set Supabase anon key  
supabase secrets set SUPABASE_ANON_KEY=your_actual_supabase_anon_key
```

**Important**: Replace the placeholder values with your actual keys!

Verify secrets are set:

```bash
supabase secrets list
```

You should see:
```
PAYSTACK_SECRET_KEY
SUPABASE_ANON_KEY
```

---

## Step 6: Deploy Edge Functions

Now for the magic! Run:

```bash
./deploy-edge-functions.sh
```

This will deploy all edge functions, including:
- ✓ verify-payment (includes payment-processor.ts)
- ✓ paystack-webhook (includes payment-processor.ts)
- ✓ And 3 other functions

**Expected output**:
```
========================================
Supabase Edge Functions Deployment
========================================

Deploying verify-payment...
✓ verify-payment deployed successfully

Deploying paystack-webhook...
✓ paystack-webhook deployed successfully

... (other functions)

========================================
Deployment Complete!
========================================
```

**If the script doesn't work**, deploy manually:

```bash
supabase functions deploy verify-payment --no-verify
supabase functions deploy paystack-webhook --no-verify
```

---

## Step 7: Verify Deployment

Check deployed functions:

```bash
supabase functions list
```

You should see:
```
┌─────────────────────┬─────────┬────────────┐
│ Function            │ Status  │ Updated    │
├─────────────────────┼─────────┼────────────┤
│ verify-payment      │ ACTIVE  │ just now   │
│ paystack-webhook    │ ACTIVE  │ just now   │
│ ... (other funcs)   │         │            │
└─────────────────────┴─────────┴────────────┘
```

---

## Step 8: Test the Deployment

### Get Your Function URL

Your function URL format:
```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/verify-payment
```

Replace `YOUR_PROJECT_REF` with your actual project reference.

### Test CORS (Optional)

```bash
curl -X OPTIONS 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/verify-payment' \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: POST' \
  -v
```

**Expected**: Should return `200 OK` with CORS headers.

---

## Step 9: Configure Paystack Webhook (Recommended)

The webhook acts as a backup payment processor.

1. Go to [Paystack Dashboard > Settings > Webhooks](https://dashboard.paystack.com/settings/webhooks)

2. Click "Add Webhook"

3. Enter your webhook URL:
   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook
   ```

4. Select events:
   - ✓ charge.success

5. Click "Add Webhook URL"

**Test the webhook**:
- Paystack will send a test event
- Check logs: `supabase functions logs paystack-webhook`

---

## Step 10: Test End-to-End

### In Your Application

1. Start your app: `npm run dev`

2. Try to create a group or join one

3. Complete payment using test card:
   - Card: `4084084084084081`
   - CVV: `123`
   - Expiry: `12/25`
   - PIN: `1234`
   - OTP: `123456`

4. Payment should process successfully

5. Check function logs:
   ```bash
   supabase functions logs verify-payment
   ```

**Expected logs**:
```
[Payment Processor] Processing group creation payment
[Payment Processor] Reference: PAY_xyz123
[Payment Processor] Status: success
[Payment Processor] Group creation payment processed. Position: 1
```

---

## Congratulations! 🎉

You've successfully deployed payment-processor.ts!

### What You Deployed

- ✓ **verify-payment** - Primary payment processor
- ✓ **paystack-webhook** - Backup payment processor
- ✓ **payment-processor.ts** - Shared business logic (auto-included in both)

### What Happens Now

When a user completes payment:

1. **Frontend** calls `verify-payment` edge function
2. **verify-payment** uses `payment-processor.ts` to process payment
3. **Simultaneously**, Paystack sends webhook to `paystack-webhook`
4. **paystack-webhook** also uses `payment-processor.ts` (backup)
5. **payment-processor.ts** is idempotent - processes once, safe if called twice

---

## Next Steps

### For Development

You're all set! Continue developing with test keys.

### For Production

When ready to go live:

1. **Get live keys**:
   - Paystack: Use live secret key (starts with `sk_live_`)
   - Supabase: Use production project

2. **Update secrets**:
   ```bash
   supabase link --project-ref YOUR_PRODUCTION_PROJECT_REF
   supabase secrets set PAYSTACK_SECRET_KEY=sk_live_your_live_key
   supabase secrets set SUPABASE_ANON_KEY=your_production_anon_key
   ```

3. **Redeploy**:
   ```bash
   ./deploy-edge-functions.sh
   ```

4. **Update Paystack webhook** with production URL

5. **Test thoroughly** before announcing!

---

## Troubleshooting

### "Module not found" Error

**Cause**: Import path incorrect in edge function.

**Fix**: Verify `verify-payment/index.ts` imports:
```typescript
import { processGroupCreationPayment } from "../_shared/payment-processor.ts";
```

Not:
```typescript
import { processGroupCreationPayment } from "./_shared/payment-processor.ts";
```

### "PAYSTACK_SECRET_KEY not configured"

**Cause**: Secret not set.

**Fix**:
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_key
```

### Deployment Hangs or Fails

**Cause**: TypeScript verification issue.

**Fix**: Add `--no-verify` flag:
```bash
supabase functions deploy verify-payment --no-verify
```

### Payment Not Processing

**Cause**: Multiple possible issues.

**Debug**:
```bash
# Check function logs
supabase functions logs verify-payment

# Check for errors
supabase functions logs verify-payment | grep ERROR

# Verify secrets
supabase secrets list
```

### CORS Errors

**Cause**: CORS headers not set or OPTIONS request failing.

**Fix**: Redeploy:
```bash
supabase functions deploy verify-payment --no-verify
```

---

## Updating payment-processor.ts

When you make changes to `payment-processor.ts`:

1. **Edit the file**:
   ```bash
   vim supabase/functions/_shared/payment-processor.ts
   ```

2. **Test locally** (optional):
   ```bash
   supabase functions serve verify-payment
   ```

3. **Redeploy functions that use it**:
   ```bash
   supabase functions deploy verify-payment --no-verify
   supabase functions deploy paystack-webhook --no-verify
   ```

4. **Verify**:
   ```bash
   supabase functions logs verify-payment
   ```

---

## Quick Reference Card

Print or bookmark this:

```
┌─────────────────────────────────────────────────────┐
│         payment-processor.ts Deployment             │
└─────────────────────────────────────────────────────┘

FIRST TIME SETUP:
1. npm install -g supabase
2. supabase login
3. cd smart-ajo
4. supabase link --project-ref YOUR_PROJECT_REF
5. supabase secrets set PAYSTACK_SECRET_KEY=sk_test_...
6. supabase secrets set SUPABASE_ANON_KEY=eyJ...
7. ./deploy-edge-functions.sh

VERIFY:
supabase functions list
supabase functions logs verify-payment

UPDATE payment-processor.ts:
1. Edit: supabase/functions/_shared/payment-processor.ts
2. Deploy: supabase functions deploy verify-payment --no-verify
3. Deploy: supabase functions deploy paystack-webhook --no-verify

LOGS:
supabase functions logs verify-payment
supabase functions logs paystack-webhook --follow

TEST:
- Card: 4084084084084081
- CVV: 123, Expiry: 12/25, PIN: 1234, OTP: 123456
```

---

## Support

If you're stuck:

1. Check [PAYMENT_PROCESSOR_DEPLOYMENT.md](./PAYMENT_PROCESSOR_DEPLOYMENT.md) - comprehensive guide
2. Check [DEPLOY_PAYMENT_PROCESSOR_QUICKSTART.md](./DEPLOY_PAYMENT_PROCESSOR_QUICKSTART.md) - quick reference
3. Check [PAYMENT_PROCESSOR_VISUAL_GUIDE.md](./PAYMENT_PROCESSOR_VISUAL_GUIDE.md) - visual diagrams
4. View logs: `supabase functions logs verify-payment`
5. Check Supabase dashboard for errors

---

**Remember**: `payment-processor.ts` is automatically deployed when you deploy `verify-payment` or `paystack-webhook`. You never deploy it directly!
