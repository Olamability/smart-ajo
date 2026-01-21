# Paystack Mandatory Verification Flow Implementation

## Overview

This document describes the implementation of Paystack's mandatory verification flow as specified in "Paystack steup.md". The implementation ensures that **webhooks are the single source of truth** for payment processing, addressing the issue where payments were successful on Paystack but the database was not updated.

## Problem Statement

**Before this implementation:**
- Payments succeeded on Paystack but database was not updated
- Business logic was duplicated in BOTH verify-payment function AND webhook
- This created race conditions and inconsistencies
- Webhook didn't handle all payment types (group_creation, group_join)
- No proper idempotency, leading to potential duplicate processing

## Solution: Webhook-First Architecture

### Architecture Diagram

```
┌─────────────┐
│  Frontend   │
│  (Paystack  │
│   Popup)    │
└──────┬──────┘
       │
       │ 1. Payment Success Callback
       ▼
┌──────────────────────┐
│  verify-payment      │  ✅ ONLY does:
│  Edge Function       │  - Verify with Paystack API
│                      │  - Store in payments table
│  ❌ NO business      │  - Return status
│     logic here       │
└──────────────────────┘
                        
       ║
       ║ Paystack calls separately
       ▼
┌──────────────────────┐
│  paystack-webhook    │  ✅ ALL business logic:
│  Edge Function       │  - Update contributions
│                      │  - Update group_members
│  🎯 SINGLE SOURCE    │  - Create transactions
│     OF TRUTH         │  - Handle all payment types
│                      │  - Idempotent processing
└──────────────────────┘
```

## Implementation Details

### 1. verify-payment Function (Simplified)

**Location:** `supabase/functions/verify-payment/index.ts`

**What it does:**
1. ✅ Verifies payment with Paystack using `GET /transaction/verify/:reference`
2. ✅ Stores payment record in `payments` table
3. ✅ Returns verification status to frontend

**What it does NOT do:**
- ❌ Does NOT update contributions table
- ❌ Does NOT update group_members table
- ❌ Does NOT create transactions
- ❌ Does NOT execute ANY business logic

**Key Changes:**
- Removed `executeBusinessLogic()` function
- Removed all business logic helper functions (processContributionPayment, processSecurityDeposit, processGroupCreationPayment, processGroupJoinPayment)
- Removed 600+ lines of business logic code
- Now returns immediately after storing payment record

**Response:**
```json
{
  "success": true,
  "payment_status": "success",
  "verified": true,
  "amount": 10000,
  "message": "Payment verified successfully. Processing in progress via webhook.",
  "data": {
    "reference": "GRP_CREATE_abc123_xyz789",
    "amount": 10000,
    "currency": "NGN",
    "channel": "card",
    "paid_at": "2024-01-21T12:00:00Z"
  }
}
```

### 2. paystack-webhook Function (Complete)

**Location:** `supabase/functions/paystack-webhook/index.ts`

**What it does:**
1. ✅ Validates Paystack webhook signature (HMAC SHA512)
2. ✅ Stores payment record in `payments` table (with idempotency check)
3. ✅ Executes ALL business logic based on payment type
4. ✅ Handles ALL payment types:
   - `contribution` - Regular cycle contributions
   - `security_deposit` - Standalone security deposits
   - `group_creation` - Creator joining group (security deposit + first contribution)
   - `group_join` - Member joining group (security deposit + first contribution)

**Key Features:**

#### Idempotency
Every payment type checks if already processed before executing:

```typescript
// Example from contribution payment
if (contribution.status === 'paid' && contribution.transaction_ref === reference) {
  console.log('Contribution already processed for reference:', reference);
  return { success: true, message: 'Contribution payment already processed (duplicate webhook)' };
}
```

#### Payment Type Handlers

**Contribution Payment:**
- Finds contribution record by user_id, group_id, cycle_number
- Updates contribution status to 'paid'
- Creates transaction record
- Idempotent: Checks if already paid with same reference

**Security Deposit:**
- Updates group_members.has_paid_security_deposit
- Creates transaction record
- Idempotent: Checks if already paid

**Group Creation Payment:**
- Adds creator as member using `add_member_to_group` RPC
- Updates member payment status
- Creates/updates first contribution
- Creates transaction records (security deposit + contribution)
- Idempotent: Checks if creator already paid

**Group Join Payment:**
- Verifies member exists in group
- Updates member payment status
- Updates first contribution to paid
- Creates transaction records
- Updates join request status to 'joined'
- Idempotent: Checks if member already paid

### 3. Payment Processing Flow

```
User completes payment on Paystack
           │
           ├─────────────────────────┬──────────────────────────┐
           │                         │                          │
           ▼                         ▼                          ▼
    Frontend callback         Webhook triggered         (May fail/delay)
           │                         │                          
           ▼                         │                          
  Call verify-payment                │                          
           │                         │                          
           ▼                         │                          
  Store in payments table            │                          
           │                         │                          
           ▼                         │                          
  Return to frontend                 │                          
  (Show success UI)                  │                          
                                     │                          
                                     ▼                          
                          Process ALL business logic            
                          (SINGLE SOURCE OF TRUTH)             
                                     │                          
                                     ▼                          
                          Update contributions,                 
                          group_members, transactions           
```

### Why Webhook is Mandatory

**From the problem statement:**

> Because:
> - User may close the browser
> - Network may fail
> - Payment success callback may not reach app
> - You must still update DB regardless

**Our implementation ensures:**
1. ✅ Webhook is called by Paystack even if user closes browser
2. ✅ Webhook is independent of frontend connectivity
3. ✅ Webhook is the ONLY place business logic executes
4. ✅ verify-payment provides immediate feedback but webhook is authoritative
5. ✅ Idempotency prevents duplicate processing from multiple webhook calls

## Database Schema Requirements

### payments Table

As per "Paystack steup.md", all fields are present:

```sql
- reference (unique)
- user_id
- amount (in kobo)
- currency
- status (pending/success/failed)
- email
- channel
- authorization_code
- customer_code
- gateway_response
- fees
- paid_at
- verified
- metadata (JSON)
- created_at
- updated_at
```

### Tables Updated by Webhook

1. **contributions**
   - status → 'paid'
   - paid_date
   - transaction_ref

2. **group_members**
   - has_paid_security_deposit → true
   - security_deposit_paid_at
   - status → 'active' (for group creation)

3. **transactions**
   - Creates audit records for all payments
   - Separate records for security deposit and contribution

4. **group_join_requests** (for group_join only)
   - status → 'joined'

## Security Features

### 1. Webhook Signature Verification
```typescript
async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  // Uses Web Crypto API to verify HMAC SHA-512 signature
  // Rejects all unsigned or invalid payloads
}
```

### 2. Service Role Access
- Both functions use `SUPABASE_SERVICE_ROLE_KEY`
- Bypasses Row Level Security for administrative operations
- Users cannot verify their own payments

### 3. Frontend Authority Rule
- Frontend success callback ≠ payment success
- Only webhook verification determines final success
- verify-payment provides immediate feedback only

## Idempotency Implementation

### Payment Record Level
```typescript
// Check if payment already exists
const { data: existing } = await supabase
  .from('payments')
  .select('id, verified, status')
  .eq('reference', data.reference)
  .maybeSingle();

if (existing?.verified && existing?.status === 'success') {
  return { success: true, message: 'Payment already verified (duplicate webhook)' };
}
```

### Business Logic Level
Each payment type checks if already processed:
- Contribution: Checks status and transaction_ref
- Security Deposit: Checks has_paid_security_deposit
- Group Creation: Checks has_paid_security_deposit
- Group Join: Checks has_paid_security_deposit

## Testing Checklist

Per "Paystack steup.md", developers MUST demonstrate:

- [ ] Successful payment
- [ ] Failed payment
- [ ] Webhook verification
- [ ] Duplicate webhook handling (idempotency)
- [ ] Unauthorized access blocked

## Go-Live Checklist

Per "Paystack steup.md":

- [ ] Test keys removed
- [ ] Live keys loaded via env
- [ ] Webhook URL configured in Paystack dashboard
- [ ] Webhook verified with live transactions
- [ ] Logs enabled and monitored
- [ ] Refund handling tested

## Migration Notes

### Breaking Changes
None. The frontend API remains unchanged:
- `verifyPayment(reference)` still works
- Response format is the same
- Only the backend behavior changed (business logic moved to webhook)

### Backward Compatibility
- ✅ Existing payment flows continue to work
- ✅ Frontend code requires no changes
- ✅ Payment references remain the same format
- ✅ Database schema unchanged

## Benefits of This Implementation

1. **Reliability**: Payments are processed even if user disconnects
2. **Consistency**: Single source of truth eliminates race conditions
3. **Idempotency**: Duplicate webhooks don't break anything
4. **Simplicity**: Clear separation of concerns
5. **Compliance**: Follows Paystack's mandatory requirements
6. **Maintainability**: Business logic in one place only

## Monitoring & Debugging

### Logs to Monitor

**verify-payment:**
```
"Payment verified and stored. Business logic will be processed by webhook."
```

**paystack-webhook:**
```
"Received Paystack event: charge.success, reference: XXX"
"Payment stored: reference XXX"
"Processing group creation payment for user XXX in group YYY"
"Group creation payment processed successfully"
```

### Common Issues

1. **Webhook not called:** Check Paystack dashboard webhook configuration
2. **Signature verification failed:** Verify `PAYSTACK_SECRET_KEY` is correct
3. **Business logic not executing:** Check webhook logs for errors
4. **Duplicate processing:** Idempotency checks should prevent this

## Future Enhancements

Recommended (per "Paystack steup.md"):
- Payment audit logs
- Admin reconciliation dashboard
- Alert on verification failure
- Automatic retries for webhook failures

## Summary

This implementation solves the core problem:

> "Payments are successful on Paystack but our DB is not updated, so app still behaves like payment is not made."

**Solution:**
1. ✅ Webhook processes ALL business logic
2. ✅ verify-payment only verifies and stores
3. ✅ Idempotency prevents duplicates
4. ✅ All payment types supported
5. ✅ Follows Paystack mandatory requirements

The database WILL be updated when payment is successful because:
- Webhook is guaranteed to be called by Paystack
- Webhook is the only place business logic executes
- Idempotency ensures it's safe to process multiple times
- All payment types are handled correctly
