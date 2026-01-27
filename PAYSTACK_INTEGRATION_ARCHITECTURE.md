# Paystack Integration Architecture - Clean Implementation

## Overview

This document describes the clean, rebuilt Paystack payment integration for the Smart Ajo platform. The integration follows industry best practices with the backend as the single source of truth for all payment state.

## Design Principles

### ✅ Core Principles

1. **Backend Authority**: Backend is the single source of truth for payment state
2. **Frontend Passivity**: Frontend only initiates payments and displays backend-confirmed results
3. **No Client Assumptions**: No reliance on UI timing, navigation state, or client assumptions
4. **Idempotency**: All operations are safe to execute multiple times
5. **Clear Separation**: Clean separation of concerns between frontend and backend
6. **Security First**: Sensitive operations only on backend with proper authentication

### ❌ Anti-Patterns Eliminated

- Frontend determining payment success based on Paystack callback
- Frontend updating database or business logic
- Polling for payment status
- Race conditions between frontend and backend
- Timing dependencies on UI navigation
- Duplicate payment processing due to lack of idempotency

## Architecture

### High-Level Flow

```
User Action
    ↓
Frontend: Initialize Payment
    ↓
Database: Create pending payment record
    ↓
Frontend: Open Paystack popup
    ↓
User: Complete payment on Paystack
    ↓
Paystack: Redirect to callback URL
    ↓
Frontend: Call verify-payment Edge Function
    ↓
Backend: Verify with Paystack API
    ↓
Backend: Update payment record
    ↓
Backend: Execute business logic
    ↓
Backend: Return result to frontend
    ↓
Frontend: Display result
    ↓
User: Navigate to destination
```

### Components

#### Frontend Components

**1. Paystack Service** (`src/lib/paystack.ts`)
- **Purpose**: Initialize Paystack popup for payment
- **Responsibilities**:
  - Load Paystack inline.js script
  - Open Paystack payment modal with reference
  - Handle popup callbacks (success/close)
- **NOT Responsible For**:
  - Determining payment success
  - Updating database
  - Executing business logic

**2. Payment API** (`src/api/payments.ts`)
- **Purpose**: Interface to payment-related backend operations
- **Functions**:
  - `initializeGroupCreationPayment()`: Creates pending payment record for group creation
  - `initializeGroupJoinPayment()`: Creates pending payment record for joining group
  - `verifyPayment()`: Calls backend to verify payment and execute business logic
  - `getPaymentStatus()`: Queries database for payment status

**3. Payment Success Page** (`src/pages/PaymentSuccessPage.tsx`)
- **Purpose**: Handle payment callback and display result
- **Responsibilities**:
  - Receive payment reference from URL
  - Call `verifyPayment()` to trigger backend verification
  - Display verification result from backend
  - Provide navigation to destination
- **NOT Responsible For**:
  - Determining payment success
  - Polling or waiting
  - Updating any state

#### Backend Components (Edge Functions)

**1. verify-payment** (`supabase/functions/verify-payment/index.ts`)
- **Type**: PRIMARY payment processor (synchronous, user-initiated)
- **Flow**:
  1. Verify user authentication (JWT token)
  2. Verify payment with Paystack API using secret key
  3. Store/update payment record in database
  4. Execute business logic immediately (add member, create contribution)
  5. Return verification result to frontend
- **Security**:
  - Requires valid JWT token
  - Uses Paystack secret key (never exposed to frontend)
  - Validates payment amount against group requirements
- **Idempotency**: Safe to call multiple times for same reference

**2. paystack-webhook** (`supabase/functions/paystack-webhook/index.ts`)
- **Type**: BACKUP payment processor (asynchronous, Paystack-initiated)
- **Purpose**: Ensure payment processing even if user closes browser
- **Flow**:
  1. Verify webhook signature (HMAC SHA512)
  2. Store/update payment record in database
  3. Execute business logic (same as verify-payment)
- **Security**:
  - Validates Paystack webhook signature
  - Uses service role for database operations
- **Idempotency**: Safe to receive multiple webhooks for same payment

**3. payment-processor** (`supabase/functions/_shared/payment-processor.ts`)
- **Type**: Shared business logic module
- **Purpose**: Provide reusable, idempotent business logic
- **Functions**:
  - `processGroupCreationPayment()`: Adds creator as member with selected slot
  - `processGroupJoinPayment()`: Activates joining member with payment
  - `createPaymentTransactions()`: Creates audit trail transactions
- **Features**:
  - All functions are idempotent
  - Comprehensive error handling
  - Detailed logging
  - Validates payment amounts
  - Checks for duplicate processing

## Payment Flow Details

### Group Creation Payment Flow

```
1. User creates group and selects payout slot
2. Frontend calls initializeGroupCreationPayment(groupId, amount, slot)
3. Backend creates pending payment record in database
4. Backend returns payment reference
5. Frontend opens Paystack popup with reference
6. User completes payment on Paystack
7. Paystack redirects to /payment/success?reference=XXX&group=YYY
8. PaymentSuccessPage calls verifyPayment(reference)
9. verify-payment Edge Function:
   - Verifies with Paystack API
   - Updates payment record (status: success, verified: true)
   - Calls processGroupCreationPayment():
     - Adds creator as group member
     - Assigns selected payout slot
     - Creates first contribution record
     - Updates member status to 'active'
     - Creates transaction records
10. Edge Function returns success + position
11. Frontend displays success message
12. User navigates to group page
```

### Group Join Payment Flow

```
1. User's join request is approved
2. User clicks Pay button
3. Frontend calls initializeGroupJoinPayment(groupId, amount, slot)
4. Backend creates pending payment record in database
5. Backend returns payment reference
6. Frontend opens Paystack popup with reference
7. User completes payment on Paystack
8. Paystack redirects to /payment/success?reference=XXX&group=YYY
9. PaymentSuccessPage calls verifyPayment(reference)
10. verify-payment Edge Function:
    - Verifies with Paystack API
    - Updates payment record (status: success, verified: true)
    - Calls processGroupJoinPayment():
      - Adds user as group member (if not already added)
      - Assigns payout slot
      - Creates first contribution record
      - Updates member status to 'active'
      - Updates join request status to 'joined'
      - Creates transaction records
11. Edge Function returns success + position
12. Frontend displays success message
13. User navigates to group page
```

### Webhook Backup Flow

```
If user closes browser before verify-payment completes:

1. Paystack sends webhook to /paystack-webhook
2. Webhook validates signature
3. Webhook stores payment record
4. Webhook executes business logic (same as verify-payment)
5. Webhook returns 200 OK to Paystack

User's membership is still activated even though they closed browser!
```

## Security Features

### Authentication & Authorization

1. **Frontend**: Only uses Paystack public key
2. **verify-payment**: Requires valid JWT token from authenticated user
3. **paystack-webhook**: Validates Paystack signature (HMAC SHA512)
4. **Business Logic**: Uses service role for database operations

### Secret Management

```bash
# Frontend (.env)
VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxx  # Public key, safe to expose

# Backend (Supabase secrets)
PAYSTACK_SECRET_KEY=sk_test_xxx  # Secret key, never exposed
```

### Validation

1. **Payment Amount**: Backend validates amount matches group requirements
2. **User Authorization**: Backend verifies user is group creator (for group creation)
3. **Group Capacity**: Backend checks group is not full (for group join)
4. **Idempotency**: Backend checks if payment already processed

## Idempotency

All operations are idempotent - safe to execute multiple times:

### Payment Storage
```typescript
// Check if payment exists
const existing = await supabase
  .from('payments')
  .select('verified, status')
  .eq('reference', reference)
  .maybeSingle();

// If already verified, return success immediately
if (existing?.verified && existing?.status === 'success') {
  return { success: true, message: 'Already verified' };
}

// Otherwise, update/insert
```

### Member Addition
```typescript
// Check if member already exists
const existingMember = await supabase
  .from('group_members')
  .select('has_paid_security_deposit')
  .eq('group_id', groupId)
  .eq('user_id', userId)
  .maybeSingle();

// If already paid, return success
if (existingMember?.has_paid_security_deposit) {
  return { success: true, message: 'Already processed' };
}

// Otherwise, add/update member
```

## Error Handling

### Frontend Error Handling

```typescript
try {
  const result = await verifyPayment(reference);
  
  if (result.verified && result.success) {
    // Success: Display confirmation
    toast.success('Payment verified!');
  } else {
    // Failed: Display error and retry option
    toast.error(result.message);
  }
} catch (error) {
  // Exception: Display generic error
  toast.error('Failed to verify payment');
}
```

### Backend Error Handling

```typescript
// 1. Authentication errors (401)
if (!authHeader) {
  return { error: 'Unauthorized', status: 401 };
}

// 2. Paystack API errors
try {
  const result = await verifyWithPaystack(reference);
} catch (error) {
  return {
    success: false,
    payment_status: 'verification_failed',
    error: 'Payment verification failed'
  };
}

// 3. Business logic errors
try {
  const result = await processGroupCreationPayment(...);
} catch (error) {
  return {
    success: false,
    payment_status: 'verified_but_processing_error',
    message: 'Payment verified but processing failed. Webhook will retry.'
  };
}
```

## Testing

### Test Scenarios

1. **Happy Path**: User completes payment successfully
2. **User Closes Browser**: Webhook processes payment
3. **Duplicate Verification**: Idempotency prevents duplicate processing
4. **Insufficient Amount**: Backend rejects payment
5. **Unauthorized User**: Backend rejects verification
6. **Paystack API Failure**: Frontend displays error with retry
7. **Session Expiry**: Frontend prompts user to refresh

### Testing Checklist

- [ ] Group creation payment flow
- [ ] Group join payment flow
- [ ] Webhook processing
- [ ] Idempotency (call verify-payment twice)
- [ ] Session expiry during verification
- [ ] User closes browser before verification
- [ ] Insufficient payment amount
- [ ] Invalid group ID
- [ ] Network failures and retries

## Deployment

### Prerequisites

1. Supabase project with service role key
2. Paystack account with secret and public keys
3. Vercel or other hosting for frontend

### Environment Variables

**Frontend (Vercel)**
```bash
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx...
VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxx
VITE_APP_URL=https://your-app.vercel.app
```

**Backend (Supabase)**
```bash
# Set via Supabase CLI or dashboard
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx
```

### Deploy Edge Functions

```bash
# Deploy verify-payment
supabase functions deploy verify-payment

# Deploy paystack-webhook
supabase functions deploy paystack-webhook
```

### Configure Paystack Webhook

1. Go to Paystack Dashboard > Settings > Webhooks
2. Add webhook URL: `https://xxx.supabase.co/functions/v1/paystack-webhook`
3. Select events: `charge.success`, `charge.failed`
4. Save

## Monitoring

### Key Metrics

1. **Payment Success Rate**: Successful payments / Total payments
2. **Verification Latency**: Time from payment to verification
3. **Webhook Success Rate**: Successful webhooks / Total webhooks
4. **Duplicate Processing**: Should be 0 (idempotency working)

### Logging

All Edge Functions log to Supabase Edge Function logs:

```typescript
console.log('[Verification] Reference:', reference);
console.log('[Verification] Payment status:', status);
console.log('[Business Logic] Processing complete');
```

### Alerts

Monitor for:
- High verification failure rate
- Webhook signature validation failures
- Duplicate processing (idempotency failures)
- High latency in payment verification

## Troubleshooting

### Payment stuck in "pending" state

**Cause**: verify-payment not called or failed
**Solution**: 
1. Check Edge Function logs
2. Retry verification from PaymentSuccessPage
3. Check if webhook processed payment

### Member not added after payment

**Cause**: Business logic error
**Solution**:
1. Check Edge Function logs for errors
2. Check payment record in database (verified = true?)
3. Check group_members table for user
4. Retry webhook if needed

### "Session expired" error

**Cause**: User token expired during payment
**Solution**:
1. Frontend automatically refreshes session before verification
2. User can refresh page and retry
3. Payment is not lost - webhook will process

## Maintenance

### Adding New Payment Types

To add a new payment type (e.g., standalone contribution):

1. **Frontend**: Create initialization function in `src/api/payments.ts`
2. **Backend**: Add processor function in `payment-processor.ts`
3. **verify-payment**: Add case for new payment type
4. **paystack-webhook**: Add case for new payment type
5. **Test**: Ensure idempotency and error handling

### Database Schema Changes

If modifying payment-related tables:

1. Create migration in `supabase/migrations/`
2. Update RLS policies if needed
3. Update Edge Functions if schema changes affect queries
4. Test with existing payments (backward compatibility)

## Best Practices

1. **Never Trust Frontend**: Always verify payment on backend
2. **Always Use Idempotency**: Check if operation already completed
3. **Log Everything**: Comprehensive logging for debugging
4. **Handle Failures Gracefully**: Clear error messages to users
5. **Test Edge Cases**: Session expiry, network failures, duplicates
6. **Monitor Continuously**: Watch logs and metrics
7. **Keep Secrets Secret**: Never expose secret keys to frontend

## References

- [Paystack Documentation](https://paystack.com/docs)
- [Paystack Webhook Signature Validation](https://paystack.com/docs/payments/webhooks#validating-paystack-webhook)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Idempotency Best Practices](https://stripe.com/docs/api/idempotent_requests)
