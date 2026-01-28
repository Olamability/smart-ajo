# Payment Verification & Membership Activation

## Overview

This document explains how the Secured-Ajo application securely verifies payments and activates memberships after successful payment.

## Security Architecture

### 🔒 Key Security Principles

1. **Backend-First Verification**: Payment verification ALWAYS happens on the backend, never trusted from the frontend
2. **Secret Key Protection**: Paystack secret key is NEVER exposed to the frontend - only stored in Supabase Edge Functions
3. **Dual Verification**: Both synchronous (verify-payment) and asynchronous (webhook) verification for reliability
4. **Idempotent Processing**: All payment processing is idempotent - safe to call multiple times without duplication
5. **Row-Level Security**: Users can only view their own payment records via RLS policies

## Payment Flow

### Step 1: Payment Initialization (Frontend)

```typescript
// User initiates payment (e.g., joining a group)
const result = await initializeGroupJoinPayment(groupId, amount, preferredSlot);

if (result.success) {
  const reference = result.reference; // Unique payment reference
  
  // Open Paystack modal with reference
  await paystackService.initializePayment({
    email: user.email,
    amount: amount * 100, // Convert to kobo
    reference: reference,
    onSuccess: () => {
      // Redirect to verification page
      navigate(`/payment-success?reference=${reference}&group=${groupId}`);
    }
  });
}
```

**What happens:**
- Creates a `pending` payment record in the database
- Generates unique payment reference (e.g., `GRP_JOIN_abc123_xyz789`)
- Stores metadata: payment type, group_id, user_id, preferred_slot
- Opens Paystack payment modal (using PUBLIC key only)

### Step 2: User Completes Payment (Paystack)

The user enters their payment details and completes the transaction on Paystack's secure platform.

**What happens:**
- Payment processed by Paystack
- Paystack validates payment method
- User redirected back to app with payment reference

### Step 3: Backend Verification (PRIMARY - Synchronous)

```typescript
// PaymentSuccessPage automatically calls this on load
const result = await verifyPayment(reference);

if (result.verified && result.success) {
  // Payment verified AND membership activated!
  // User can now access the group
  navigate(`/groups/${groupId}`);
}
```

**What happens on the backend (verify-payment Edge Function):**

1. **Authenticate User**: Validates JWT token from request
2. **Verify with Paystack API**: 
   ```typescript
   GET https://api.paystack.co/transaction/verify/{reference}
   Authorization: Bearer {SECRET_KEY}
   ```
3. **Store Payment Record**: Updates database with Paystack response
4. **Execute Business Logic** (CRITICAL):
   - For `group_creation`: Add creator as member with selected slot
   - For `group_join`: Add member to group with assigned position
   - For `contribution`: Mark contribution as paid
5. **Return Result**: Success/failure with position assigned

**Code Location**: `supabase/functions/verify-payment/index.ts`

### Step 4: Webhook Backup (SECONDARY - Asynchronous)

Paystack also sends a webhook notification to our backend. This acts as a backup in case the synchronous verification fails due to network issues.

**What happens:**
- Paystack sends webhook POST request to `/paystack-webhook`
- Webhook validates signature (HMAC-SHA512)
- Executes SAME business logic as verify-payment
- Idempotent: If already processed, returns success without duplication

**Code Location**: `supabase/functions/paystack-webhook/index.ts`

## Membership Activation

### When Does Membership Get Activated?

Membership is activated **IMMEDIATELY** after successful payment verification in Step 3.

The `verify-payment` Edge Function:
1. Verifies payment with Paystack ✅
2. Stores payment record ✅
3. **Adds user to group_members table** ✅
4. **Sets has_paid_security_deposit = true** ✅
5. **Sets status = 'active'** ✅
6. **Assigns position/slot** ✅
7. Creates first contribution record ✅
8. Creates transaction records ✅

### Database Changes After Verification

**payments table:**
```sql
UPDATE payments SET
  status = 'success',
  verified = true,
  paid_at = '2024-01-15T10:30:00Z',
  gateway_response = 'Approved',
  updated_at = NOW()
WHERE reference = 'GRP_JOIN_abc123_xyz789';
```

**group_members table:**
```sql
INSERT INTO group_members (group_id, user_id, position, status, has_paid_security_deposit)
VALUES ('group-uuid', 'user-uuid', 3, 'active', true);
```

**contributions table:**
```sql
INSERT INTO contributions (group_id, user_id, cycle_number, status, paid_date)
VALUES ('group-uuid', 'user-uuid', 1, 'paid', NOW());
```

## Payment Verification States

| State | Description | User Experience |
|-------|-------------|-----------------|
| `pending` | Payment initiated but not completed | User sees Paystack modal |
| `verifying` | Payment completed, backend verification in progress | Loading spinner on success page |
| `success` | Payment verified, membership activated | Success message, redirect to group |
| `failed` | Payment or verification failed | Error message, retry button |
| `abandoned` | User closed payment modal | Payment record exists but not completed |

## Error Handling & Retries

### Frontend Retry Logic

The `verifyPayment()` function includes automatic retry logic:

```typescript
// Retries up to 3 times with exponential backoff
const result = await verifyPayment(reference, retries=3, delayMs=2000);
```

**Retry conditions:**
- Network errors or timeouts
- Payment still processing (status = 'processing')
- Server errors (5xx)

**Do NOT retry:**
- Authentication errors (401) - session expired, user must refresh
- Not found errors (404) - invalid reference
- Invalid format errors (400)

### Backend Idempotency

Both `verify-payment` and `paystack-webhook` check if payment was already processed:

```typescript
// Check if already processed
const { data: existing } = await supabase
  .from('payments')
  .select('verified, status')
  .eq('reference', reference)
  .single();

if (existing.verified && existing.status === 'success') {
  // Already processed - return success without re-executing
  return { success: true, message: 'Payment already verified' };
}
```

This prevents:
- Duplicate member additions
- Double-counting contributions
- Multiple transaction records

## Security Measures

### 1. Secret Key Protection

```
❌ Frontend (.env):
VITE_PAYSTACK_SECRET_KEY=sk_live_xxx  # NEVER DO THIS!

✅ Backend (Supabase Edge Functions):
PAYSTACK_SECRET_KEY=sk_live_xxx  # Safe, not exposed to browser
```

### 2. JWT Authentication

```typescript
// verify-payment Edge Function
const authHeader = req.headers.get('Authorization');
const jwt = authHeader.replace('Bearer ', '');

// Validate JWT with Supabase
const { data: { user }, error } = await supabase.auth.getUser(jwt);

if (error || !user) {
  return 401 Unauthorized;
}
```

### 3. Row-Level Security

```sql
-- Users can only see their own payments
CREATE POLICY "Users can view their own payments"
  ON payments FOR SELECT
  USING (auth.uid() = user_id);

-- Only backend (service role) can update payments
-- No user-facing UPDATE policy
```

### 4. Webhook Signature Validation

```typescript
// paystack-webhook validates Paystack signature
const signature = req.headers.get('x-paystack-signature');
const hash = crypto.createHmac('sha512', secretKey)
  .update(body)
  .digest('hex');

if (hash !== signature) {
  return 401 Unauthorized; // Invalid signature
}
```

## Testing the Flow

### Manual Testing

1. **Start local development:**
   ```bash
   npm run dev
   ```

2. **Create/Join a group** (triggers payment)

3. **Complete test payment** on Paystack (use test card: **4084 0840 8408 4081 - TEST MODE ONLY**)

4. **Monitor console logs:**
   - Frontend: Check browser console for verification steps
   - Backend: Check Supabase Edge Function logs

5. **Verify in database:**
   ```sql
   -- Check payment record
   SELECT reference, status, verified, paid_at 
   FROM payments 
   WHERE reference = 'your-reference';

   -- Check membership
   SELECT user_id, group_id, status, has_paid_security_deposit, position
   FROM group_members
   WHERE user_id = 'your-user-id';
   ```

### Test Scenarios

- [ ] **Happy Path**: Payment succeeds, membership activated immediately
- [ ] **Network Failure**: Frontend verification fails, webhook processes payment
- [ ] **Duplicate Call**: Verify calling verify-payment multiple times doesn't duplicate
- [ ] **Session Expired**: User session expires during payment, proper error shown
- [ ] **Insufficient Amount**: User pays less than required, payment rejected
- [ ] **Failed Payment**: Payment fails on Paystack, proper error handling

## Troubleshooting

### Issue: Payment successful but membership not activated

**Possible Causes:**
1. Edge Function not deployed
2. Environment variables missing (PAYSTACK_SECRET_KEY)
3. Database permissions issue
4. Business logic error in payment-processor.ts

**Solutions:**
1. Check Edge Function logs in Supabase dashboard
2. Verify environment variables in Supabase project settings
3. Check RLS policies on affected tables
4. Look for errors in `payment-processor.ts` console logs

### Issue: "Session expired" error after payment

**Cause:** JWT token expired during payment process (Paystack modal took too long)

**Solution:** 
- Frontend automatically refreshes session before verification
- If still fails, user can click "Retry Verification" button
- Webhook will process payment as backup

### Issue: Payment verified but user can't access group

**Possible Causes:**
1. Business logic completed but frontend not refreshing
2. RLS policy blocking group access
3. Cache issue in frontend

**Solutions:**
1. Check `result.position` in verification response - should have assigned position
2. Force refresh: `navigate(0)` or reload page
3. Check browser console for errors
4. Verify `group_members` table has active status

## API Reference

### Frontend APIs

#### `initializeGroupJoinPayment(groupId, amount, preferredSlot?)`
Creates pending payment record for joining a group.

**Returns:** `{ success: boolean, reference?: string, error?: string }`

#### `verifyPayment(reference, retries?, delayMs?)`
Verifies payment with backend and activates membership.

**Returns:** `PaymentVerificationResult` with status, position, and messages

#### `getPaymentStatus(reference)`
Checks current payment status from database.

**Returns:** `{ success: boolean, payment?: {...}, error?: string }`

### Backend Edge Functions

#### `POST /verify-payment`
**Headers:** `Authorization: Bearer {jwt}`  
**Body:** `{ reference: string }`  
**Response:** 
```json
{
  "success": true,
  "payment_status": "success",
  "verified": true,
  "amount": 500000,
  "message": "Payment verified and processed successfully",
  "position": 3,
  "data": {
    "reference": "GRP_JOIN_abc123_xyz789",
    "amount": 500000,
    "currency": "NGN",
    "channel": "card",
    "paid_at": "2024-01-15T10:30:00Z"
  }
}
```

#### `POST /paystack-webhook`
**Headers:** `x-paystack-signature: {hmac}`  
**Body:** Paystack webhook event  
**Response:** `{ received: true }`

## File Locations

### Frontend
- `src/api/payments.ts` - Payment API functions
- `src/lib/paystack.ts` - Paystack modal integration
- `src/pages/PaymentSuccessPage.tsx` - Verification UI
- `src/components/PaymentBreakdown.tsx` - Payment amount breakdown

### Backend
- `supabase/functions/verify-payment/index.ts` - Primary verification
- `supabase/functions/paystack-webhook/index.ts` - Webhook backup
- `supabase/functions/_shared/payment-processor.ts` - Business logic

### Database
- `supabase/migrations/add_payments_table.sql` - Payments table schema
- `supabase/migrations/payment_based_membership.sql` - Payment processing functions

## Summary

**The application securely verifies payments and activates memberships through:**

1. ✅ Backend-only verification with Paystack secret key
2. ✅ Dual processing (synchronous + webhook backup)
3. ✅ Immediate membership activation after verification
4. ✅ Idempotent operations preventing duplicates
5. ✅ Comprehensive error handling and retries
6. ✅ Row-level security protecting user data

**Users are redirected to the payment success page which:**
1. Automatically calls backend verification
2. Shows loading spinner during verification
3. Executes business logic (add member, activate status)
4. Displays success message with assigned position
5. Allows navigation to group/dashboard

**The system is production-ready and secure!** 🎉
