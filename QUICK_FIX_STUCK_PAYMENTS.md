# Quick Fix: Stuck Payments (GRP_CREATE_8b370128_*)

## Problem
Two payments are stuck in pending status:
- `GRP_CREATE_8b370128_ebde35a2`
- `GRP_CREATE_8b370128_c0ea5b27`

Users' memberships are not activated even though payments were made.

## Quick Fix (5 minutes)

### Step 1: Deploy the fix function
```bash
cd supabase/functions
supabase functions deploy fix-pending-payment
```

### Step 2: Get your service role key
From Supabase Dashboard → Settings → API → service_role key (secret)

### Step 3: Fix the payments
```bash
# Replace YOUR_PROJECT and YOUR_SERVICE_ROLE_KEY with actual values

# Fix first payment
curl -X POST 'https://YOUR_PROJECT.supabase.co/functions/v1/fix-pending-payment' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"reference": "GRP_CREATE_8b370128_ebde35a2"}'

# Fix second payment
curl -X POST 'https://YOUR_PROJECT.supabase.co/functions/v1/fix-pending-payment' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"reference": "GRP_CREATE_8b370128_c0ea5b27"}'
```

### Step 4: Verify
Each curl command should return:
```json
{
  "success": true,
  "message": "Group creation payment processed successfully",
  "payment_status": "success",
  "verified": true,
  "position": 1
}
```

### Step 5: Tell users to refresh
Ask the affected users to refresh their browser. They should see:
- ✅ Membership activated
- ✅ No payment prompts

## Prevention (5 minutes)

### Deploy updated webhook
```bash
cd supabase/functions
supabase functions deploy paystack-webhook
```

This ensures future payments are processed correctly even if users close their browser.

## Done!

For more details, see:
- `FIX_SUMMARY_PAYMENT_ACTIVATION.md` - Full technical details
- `MEMBERSHIP_ACTIVATION_FIX_GUIDE.md` - Comprehensive troubleshooting guide

## Monitoring

Watch for stuck payments:
```sql
SELECT reference, created_at, metadata->>'user_id' AS user_id
FROM payments
WHERE status = 'pending' AND created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```
