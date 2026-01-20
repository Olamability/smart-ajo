# Payment Verification Flow - Secured Ajo

## Overview

This document describes the payment verification architecture for Secured Ajo, following industry best practices and Paystack security requirements.

## Architecture Principles

1. **Backend Authority**: ALL payment verification and business logic MUST happen on the backend
2. **Frontend Display Only**: Frontend only initializes payments and displays results
3. **Zero Trust**: Never trust frontend callbacks - always verify with Paystack API
4. **Idempotency**: Payment processing must be idempotent (safe to call multiple times)
5. **Single Source of Truth**: verify-payment Edge Function is the single source of truth

## Payment Flow

### 1. Payment Initialization (Frontend)

**Files**: `src/lib/paystack.ts`, `src/api/payments.ts`, `src/pages/GroupDetailPage.tsx`

```typescript
// 1. Create pending payment record
const { reference } = await initializeGroupCreationPayment(groupId, amount);

// 2. Initialize Paystack payment modal (public key only)
await paystackService.initializePayment({
  email: user.email,
  amount: amount * 100, // Convert to kobo
  reference: reference,
  metadata: {
    type: 'group_creation',
    user_id: user.id,
    group_id: groupId,
    preferred_slot: selectedSlot
  },
  callback_url: `${VITE_APP_URL}/payment/success?reference=${reference}&group=${groupId}`,
  callback: async (response) => {
    // Frontend callback - only verify, NO business logic
    const result = await verifyPayment(response.reference);
    if (result.verified && result.success) {
      // Backend has already processed everything
      toast.success('Payment verified!');
      // Just reload data to reflect changes
      await loadGroupDetails();
    }
  }
});
```

**Key Points**:
- ✅ Only uses Paystack public key
- ✅ Creates pending payment record in database
- ✅ Includes metadata for backend processing
- ✅ Callback URL is frontend route (`/payment/success`)
- ✅ Callback only calls verification, no business logic

### 2. Payment Verification (Backend)

**File**: `supabase/functions/verify-payment/index.ts`

```typescript
// Backend Edge Function handles EVERYTHING
async function serve(req) {
  // 1. Authenticate user via JWT
  const user = await supabase.auth.getUser(jwt);
  
  // 2. Verify with Paystack API (using SECRET key)
  const verificationResponse = await verifyWithPaystack(reference, PAYSTACK_SECRET_KEY);
  
  // 3. Store payment record (idempotent)
  await storePaymentRecord(supabase, verificationResponse.data);
  
  // 4. Execute business logic if payment successful
  if (verificationResponse.data.status === 'success') {
    const result = await executeBusinessLogic(supabase, verificationResponse.data);
    // For group_creation: adds creator as member, creates contribution, etc.
    // For group_join: adds member to group, creates contribution, etc.
  }
  
  // 5. Return verification result + position
  return { verified: true, success: true, position: 1 };
}
```

**Key Points**:
- ✅ Uses Paystack SECRET key (never exposed to frontend)
- ✅ Validates JWT authentication
- ✅ Calls Paystack API to verify transaction
- ✅ Stores payment record with idempotency check
- ✅ Executes ALL business logic (add member, create contribution, etc.)
- ✅ Returns position assigned to user

### 3. Callback URL Page (Frontend)

**File**: `src/pages/PaymentSuccessPage.tsx`

```typescript
// This page ONLY displays verification status
export default function PaymentSuccessPage() {
  const reference = searchParams.get('reference');
  
  useEffect(() => {
    if (reference) {
      // Call backend to verify - backend does everything
      const result = await verifyPayment(reference);
      
      if (result.verified && result.success) {
        // Display success with position
        setMessage(`Payment verified! Position: ${result.position}`);
      } else {
        // Display error
        setMessage(result.message || 'Verification failed');
      }
    }
  }, [reference]);
  
  return <div>{/* Display verification status */}</div>;
}
```

**Key Points**:
- ✅ ONLY displays verification results
- ✅ NO business logic execution
- ✅ All processing already done by backend
- ✅ Just shows user-friendly status message

### 4. Webhook Handler (Backup/Async)

**File**: `supabase/functions/paystack-webhook/index.ts`

```typescript
// Webhook provides redundancy for async confirmations
async function serve(req) {
  // 1. Validate Paystack signature
  const isValid = await verifySignature(rawBody, signature, PAYSTACK_SECRET_KEY);
  
  // 2. Store payment record (idempotent)
  await storePaymentRecord(supabase, event.data);
  
  // 3. Process payment based on type
  if (event.event === 'charge.success') {
    if (paymentType === 'contribution') {
      await processContributionPayment(supabase, event.data);
    }
    // Note: group_creation/join already handled by verify-payment
  }
  
  return { received: true };
}
```

**Key Points**:
- ✅ Validates webhook signature
- ✅ Provides redundancy if frontend callback missed
- ✅ Processes contribution payments asynchronously
- ✅ Idempotent (won't duplicate member creation)

## Payment Types and Business Logic

### Group Creation Payment

**Metadata**:
```typescript
{
  type: 'group_creation',
  user_id: string,
  group_id: string,
  preferred_slot: number
}
```

**Backend Processing** (in verify-payment Edge Function):
1. Verify payment amount = contribution_amount + security_deposit_amount
2. Check if user already a member (idempotency)
3. Add creator as member with selected slot
4. Create first contribution record (status: 'paid')
5. Create transaction records (security deposit + contribution)
6. Update group.current_members count
7. Return position assigned

### Group Join Payment

**Metadata**:
```typescript
{
  type: 'group_join',
  user_id: string,
  group_id: string,
  preferred_slot?: number
}
```

**Backend Processing** (in verify-payment Edge Function):
1. Verify payment amount = contribution_amount + security_deposit_amount
2. Check if user already a member (idempotency)
3. Check if group is full
4. Determine position (use preferred or next available)
5. Add member to group
6. Create first contribution record (status: 'paid')
7. Create transaction records (security deposit + contribution)
8. Update group.current_members count
9. Update join_request status if exists
10. Return position assigned

### Contribution Payment

**Metadata**:
```typescript
{
  type: 'contribution',
  user_id: string,
  group_id: string,
  cycle_number: number
}
```

**Backend Processing**:
1. Find contribution record
2. Update status to 'paid'
3. Set paid_date
4. Create transaction record

### Security Deposit Payment

**Metadata**:
```typescript
{
  type: 'security_deposit',
  user_id: string,
  group_id: string
}
```

**Backend Processing**:
1. Update group_members.has_paid_security_deposit
2. Set security_deposit_payment_ref
3. Create transaction record

## Error Handling

### Frontend Errors
- Display user-friendly messages from backend
- Show reference number for support
- Provide retry option for verification failures

### Backend Errors
- Log detailed errors server-side
- Return generic error messages to frontend (no sensitive data)
- Handle timeout, network, and auth errors
- Implement retry logic for Paystack API calls

## Idempotency

All payment processing functions check for existing records:

```typescript
// Check if user already a member
const { data: existingMember } = await supabase
  .from('group_members')
  .select('id, position')
  .eq('group_id', groupId)
  .eq('user_id', userId)
  .maybeSingle();

if (existingMember) {
  // Already processed, return success with existing position
  return { success: true, position: existingMember.position };
}
```

This ensures:
- Multiple verification calls don't create duplicate members
- Safe to retry failed verifications
- Webhook won't duplicate work already done by verify-payment

## Security Considerations

1. **Secret Key Protection**
   - ✅ Paystack secret key ONLY in backend environment variables
   - ✅ Never exposed to frontend
   - ✅ Only used in Edge Functions

2. **Authentication**
   - ✅ All backend calls require valid JWT
   - ✅ User ID extracted from JWT, not from request body
   - ✅ Prevents user impersonation

3. **Authorization**
   - ✅ Backend verifies user matches payment.user_id
   - ✅ Database RLS policies enforce access control

4. **Payment Verification**
   - ✅ ALWAYS verify with Paystack API
   - ✅ Never trust frontend status
   - ✅ Check payment.verified flag in database

5. **Data Validation**
   - ✅ Verify payment amount matches expected amount
   - ✅ Validate payment status = 'success'
   - ✅ Check metadata contains required fields

## Testing Checklist

- [ ] Group creation payment flow
  - [ ] Successful payment adds creator as member
  - [ ] Creator gets selected slot position
  - [ ] First contribution marked as paid
  - [ ] Security deposit recorded
  - [ ] Transactions created
  
- [ ] Group join payment flow
  - [ ] Successful payment adds member
  - [ ] Position assigned correctly
  - [ ] First contribution marked as paid
  - [ ] Security deposit recorded
  - [ ] Join request updated if exists

- [ ] Payment failures
  - [ ] Failed payment doesn't create member
  - [ ] Clear error message displayed
  - [ ] Payment record marked as failed

- [ ] Edge cases
  - [ ] Duplicate verification doesn't create duplicate member
  - [ ] Network interruption handled gracefully
  - [ ] Session expiry handled with refresh
  - [ ] Insufficient payment amount rejected

- [ ] Webhook
  - [ ] Webhook processes payments independently
  - [ ] Webhook doesn't duplicate member creation
  - [ ] Webhook validates signature

## Environment Variables

### Frontend (.env)
```
VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
VITE_APP_URL=http://localhost:3000
```

### Backend (Supabase Edge Functions)
```
PAYSTACK_SECRET_KEY=sk_test_xxxxx
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
```

## Migration Notes

### Old Flow (Deprecated)
```typescript
// ❌ OLD: Frontend executed business logic
const result = await verifyPayment(reference);
if (result.verified) {
  // Frontend called RPC function
  await processGroupCreationPayment(reference, groupId, slot);
}
```

### New Flow (Current)
```typescript
// ✅ NEW: Backend handles everything
const result = await verifyPayment(reference);
if (result.verified && result.success) {
  // Backend already processed everything
  // Just reload data and show success
  toast.success(`You are now a member at position ${result.position}`);
  await loadGroupDetails();
}
```

## Deprecated Functions

The following frontend functions are deprecated and should not be used:
- ❌ `processGroupCreationPayment()` - Backend handles this
- ❌ `processGroupJoinPayment()` - Backend handles this
- ❌ `processApprovedJoinPayment()` - Backend handles this
- ❌ `pollPaymentStatus()` - Creates race conditions, don't use

## Support and Troubleshooting

### Payment verification failed
1. Check Paystack dashboard for transaction status
2. Verify backend logs in Supabase Edge Functions
3. Check payment record in database
4. Retry verification with reference number

### Member not added after payment
1. Check payment.verified = true in database
2. Check group_members table for user
3. Review verify-payment Edge Function logs
4. Check for errors in business logic execution

### Duplicate member errors
- This should not happen due to idempotency checks
- If it does, review database constraints
- Check verify-payment Edge Function logs

## References

- Paystack API Documentation: https://paystack.com/docs/api
- Paystack Webhook Documentation: https://paystack.com/docs/payments/webhooks
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Payment Security Best Practices: https://paystack.com/docs/security
