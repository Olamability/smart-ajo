# Payment System Realtime Implementation

## Overview

This document describes the enhanced payment verification system that implements the recommended Paystack webhook pattern with frontend updates via Supabase Realtime and polling fallback.

## Architecture Pattern

The system now follows the industry-standard payment verification pattern:

```
1. User pays on frontend (Paystack modal)
2. Paystack sends webhook to backend (Supabase Edge Function)
3. Backend verifies payment, updates Supabase DB
4. Frontend gets update (via Realtime or polling) and activates membership
```

## Implementation Details

### 1. Paystack Webhook Setup ✅

**Location:** `supabase/functions/paystack-webhook/index.ts`

**Configuration:**
- Webhook URL must be configured in Paystack dashboard
- Points to: `https://YOUR_PROJECT.supabase.co/functions/v1/paystack-webhook`
- See `WEBHOOK_CONFIGURATION.md` for setup instructions

**Handles:**
- `charge.success` events
- `charge.failed` events
- Signature validation using HMAC SHA-512
- Idempotent processing (safe to call multiple times)

### 2. Backend Webhook Handler ✅

**Primary Path:** `supabase/functions/verify-payment/index.ts`
- User-initiated synchronous verification
- Called immediately after payment completion
- Provides instant feedback when authentication is valid

**Backup Path:** `supabase/functions/paystack-webhook/index.ts`
- Paystack-initiated asynchronous verification
- Processes payments even if user closes browser
- Critical for handling session expiration edge cases

**Both paths execute the same business logic:**
- Verify payment with Paystack API using SECRET key
- Store payment record in database
- Process business logic:
  - `group_creation`: Add creator as member
  - `group_join`: Add new member to group
  - `contribution`: Mark contribution as paid
- Update membership status and activate account

### 3. Database Update ✅

**Table:** `payments`

**Fields Updated:**
- `reference`: Payment reference from Paystack
- `status`: Payment status ('pending', 'success', 'failed')
- `verified`: Boolean flag indicating verification status
- `amount`: Payment amount in kobo
- `paid_at`: Payment timestamp
- `metadata`: Payment metadata (type, user_id, group_id, etc.)
- All Paystack data stored for audit trail

**Related Tables:**
- `group_members`: Updated with payment status
- `contributions`: Created/updated for contributions
- `transactions`: Transaction records created

### 4. Frontend Update Mechanism ✅ **NEW**

**Location:** `src/pages/PaymentSuccessPage.tsx`

#### Primary: Supabase Realtime Subscription

The frontend now subscribes to real-time database changes:

```typescript
const channel = supabase
  .channel(`payment-${reference}`)
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'payments',
      filter: `reference=eq.${reference}`,
    },
    (payload) => {
      // Handle payment update
      if (payload.new.verified && payload.new.status === 'success') {
        // Check membership activation
        // Update UI automatically
      }
    }
  )
  .subscribe();
```

**Benefits:**
- Instant updates when webhook processes payment
- No manual refresh required
- Better user experience
- Lower server load (no polling needed when Realtime works)

#### Fallback: Polling Mechanism

If Realtime fails or is unavailable:

```typescript
const pollPaymentStatus = async () => {
  const result = await getPaymentStatus(reference);
  if (result.payment.verified) {
    // Check membership activation
    // Update UI
  } else {
    // Retry after delay
    setTimeout(pollPaymentStatus, 3000);
  }
};
```

**Configuration:**
- Polls every 3 seconds
- Maximum 20 attempts (60 seconds total)
- Automatic fallback if Realtime unavailable

## Flow Diagrams

### Happy Path (Synchronous Verification)

```
User → Paystack Payment → Payment Success Page
                           ↓
                     Call verify-payment API
                           ↓
              Backend verifies with Paystack
                           ↓
              Backend activates membership
                           ↓
              Return success to frontend
                           ↓
                   Display success + position
```

### Auth Expired Path (Webhook + Realtime)

```
User → Paystack Payment → Payment Success Page
                           ↓
                  Subscribe to Realtime
                           ↓
                 Call verify-payment API
                           ↓
            Backend verifies with Paystack
                           ↓
            Backend stores payment (auth fails)
                           ↓
         Return "pending activation" to frontend
                           ↓
              Frontend shows "waiting" state
                           ║
                           ║ (Meanwhile...)
                           ║
           Paystack → Webhook receives event
                           ↓
            Webhook verifies payment (no auth needed)
                           ↓
            Webhook activates membership
                           ↓
            Database updated (verified=true)
                           ║
                           ║ (Realtime triggers)
                           ↓
              Frontend receives update
                           ↓
          Display success automatically!
```

### Realtime Unavailable Path (Webhook + Polling)

```
User → Payment Success Page → Subscribe to Realtime (fails)
                                       ↓
                               Start polling fallback
                                       ↓
                        Poll every 3 seconds (max 60s)
                                       ↓
                   Check payment status from database
                                       ↓
                      If verified → Display success
                                       ↓
                   If not verified → Continue polling
```

## Key Features

### 1. Idempotent Operations

All payment processing functions are idempotent:
- Safe to call multiple times with same reference
- Checks existing state before making changes
- Uses database locks to prevent race conditions
- Returns existing result if already processed

### 2. Session Expiration Handling

**Problem:** User session may expire during payment (2-5 minutes)

**Solution:**
- Payment ALWAYS stored first (no auth required)
- Business logic requires auth but isn't critical
- Webhook processes payment asynchronously (no auth needed)
- Frontend waits for webhook via Realtime/polling
- User sees automatic activation without manual refresh

### 3. Error Recovery

**Scenarios handled:**
- Network timeout during verification
- Webhook delivery failure
- Realtime connection failure
- Polling timeout

**Recovery mechanisms:**
- Retry logic with exponential backoff
- Automatic fallback from Realtime to polling
- Clear error messages to user
- Payment data always preserved

## Testing

### Test Successful Payment

1. Create/join a group
2. Complete payment with test card:
   - Card: `4084 0840 8408 4081`
   - CVV: `123`
   - Expiry: `12/25`
   - PIN: `1234`
   - OTP: `123456`
3. Observe:
   - Immediate success if auth valid
   - "Waiting for activation" if auth expired
   - Automatic update within seconds

### Test Session Expiration

1. Start payment process
2. Wait 5+ minutes before completing payment
3. Complete payment on Paystack
4. Observe:
   - Page shows "waiting for activation"
   - Webhook processes payment
   - Page automatically updates to success
   - No manual refresh required!

### Test Realtime Fallback

1. Disable Realtime in Supabase settings (or block WebSocket)
2. Complete payment
3. Observe:
   - Realtime subscription fails
   - Polling automatically starts
   - Page updates when payment verified
   - Max 60 seconds wait time

## Configuration

### Environment Variables

Frontend (`.env`):
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxx
```

Backend (Supabase Secrets):
```bash
PAYSTACK_SECRET_KEY=sk_test_xxx  # or sk_live_xxx for production
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Webhook Configuration

See `WEBHOOK_CONFIGURATION.md` for detailed webhook setup instructions.

### Realtime Configuration

Realtime is enabled by default in Supabase. To verify:

1. Go to Supabase Dashboard → Settings → API
2. Check "Realtime" section
3. Ensure `payments` table has Realtime enabled
4. Publications should include the `payments` table

## Monitoring

### Check Realtime Subscriptions

```javascript
// In browser console
const supabase = createClient();
const channels = supabase.getChannels();
console.log('Active channels:', channels);
```

### Check Webhook Logs

```bash
# View webhook logs
supabase functions logs paystack-webhook --limit 50

# Follow webhook logs in real-time
supabase functions logs paystack-webhook --follow
```

### Check Polling Activity

```javascript
// In browser console on PaymentSuccessPage
// Look for these log messages:
// "[Payment Success] Polling attempt X/20"
// "[Payment Success] Poll result: {...}"
```

## Troubleshooting

### Issue: Frontend doesn't update automatically

**Check:**
1. Is Realtime enabled in Supabase?
2. Is polling running? (Check browser console)
3. Is webhook processing payment? (Check webhook logs)
4. Is payment record updated in database?

**Solution:**
1. Verify Realtime configuration
2. Check browser console for errors
3. Verify webhook is deployed and receiving events
4. Check database for payment status

### Issue: Webhook not receiving events

**Check:**
1. Is webhook URL configured in Paystack dashboard?
2. Is Edge Function deployed?
3. Is secret key set correctly?

**Solution:**
See `WEBHOOK_CONFIGURATION.md` for detailed troubleshooting.

### Issue: Polling not working

**Check:**
1. Are there errors in browser console?
2. Is `getPaymentStatus` API working?
3. Is payment record in database?

**Solution:**
1. Check browser console for errors
2. Verify RLS policies allow user to read their payment
3. Check network tab for API calls

## Security Considerations

### ✅ What's Secure

1. **Payment verification with SECRET key** (backend only)
2. **Signature validation** on webhook
3. **JWT authentication** for business logic
4. **Row Level Security** on database
5. **No sensitive data** in frontend code
6. **Idempotent operations** prevent duplicates
7. **Advisory locks** prevent race conditions

### ⚠️ Important Notes

1. **Realtime listens to payment table** (user can only see their own payments via RLS)
2. **Polling uses authenticated API** (user can only check their own payment)
3. **Frontend never trusts client-side data** (always verifies with backend)
4. **Webhook uses service role** (bypasses RLS for updates)

## Migration Notes

### Changes Made

1. ✅ Added Realtime subscription to `PaymentSuccessPage`
2. ✅ Added polling fallback mechanism
3. ✅ Removed auto-refresh logic (replaced with Realtime/polling)
4. ✅ Added cleanup for subscriptions and timers
5. ✅ Enhanced status messages for waiting state
6. ✅ Updated documentation

### Breaking Changes

**None.** This is a backward-compatible enhancement.

### Deployment Steps

1. Deploy updated frontend:
   ```bash
   npm run build
   vercel deploy --prod  # or your deployment method
   ```

2. Verify webhook is configured:
   ```bash
   # Check webhook URL in Paystack dashboard
   # Should be: https://YOUR_PROJECT.supabase.co/functions/v1/paystack-webhook
   ```

3. Test end-to-end flow

4. Monitor for first few transactions

## Conclusion

The payment system now follows industry best practices with:
- ✅ Webhook verification (backup path)
- ✅ Database updates on success
- ✅ Frontend automatic updates (Realtime + polling)
- ✅ Session expiration handling
- ✅ Error recovery
- ✅ No manual refresh required

This provides a seamless user experience even in edge cases like session expiration.

---

**Last Updated:** 2026-02-01  
**Version:** 2.0.0
