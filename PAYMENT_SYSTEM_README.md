# Smart Ajo Payment System - Complete Implementation Guide

## 🎯 Overview

This document describes the complete end-to-end payment system implementation for Smart Ajo using Paystack. The system handles all payment workflows from group creation to payouts.

## 📦 What's Included

### Core Files

#### Frontend
- `src/lib/paystack.ts` - Paystack integration service
- `src/api/payments.ts` - Payment API layer
- `src/components/SlotSelector.tsx` - Payout slot selection UI
- `src/components/PaymentBreakdown.tsx` - Payment details display
- `src/components/PayoutSchedule.tsx` - Payout timeline display
- `src/pages/PaymentSuccessPage.tsx` - Post-payment verification

#### Backend
- `supabase/functions/verify-payment/index.ts` - Payment verification Edge Function

#### Deployment & Documentation
- `deploy-edge-functions.sh` - Automated deployment script
- `PAYMENT_DEPLOYMENT_GUIDE.md` - Step-by-step deployment instructions
- `DATABASE_FUNCTIONS.md` - Required database functions

## 🔄 Payment Workflows

### 1. Group Creation Payment (Creator)

**Flow:**
1. User creates a new Ajo group
2. User selects their preferred payout slot (position 1-N)
3. System calculates total: `contribution + service fee + security deposit`
4. User pays via Paystack
5. Payment is verified on backend
6. User is added as first group member with selected slot
7. Group status remains 'forming' until all slots filled

**Code Example:**
```typescript
import { initializeGroupCreationPayment } from '@/api/payments';
import { paystackService } from '@/lib/paystack';

// 1. Initialize payment record
const result = await initializeGroupCreationPayment(
  groupId,
  totalAmount,
  selectedSlot
);

// 2. Open Paystack popup
await paystackService.initializePayment({
  email: user.email,
  amount: paystackService.toKobo(totalAmount),
  reference: result.reference,
  metadata: {
    userId: user.id,
    groupId: groupId,
    paymentType: 'group_creation',
    slotNumber: selectedSlot,
  },
  onSuccess: (response) => {
    // Redirect to verification page
    navigate(`/payment/success?reference=${response.reference}&group=${groupId}`);
  },
});
```

### 2. Join Request Payment (Member)

**Flow:**
1. User browses available groups
2. User selects a group and requests to join with preferred slot
3. Group admin receives notification
4. Admin approves request
5. User is prompted to pay: `contribution + service fee + security deposit`
6. User pays via Paystack
7. Payment is verified on backend
8. User is added as group member with selected slot
9. Group status changes to 'active' when all slots filled

**Code Example:**
```typescript
import { initializeGroupJoinPayment } from '@/api/payments';

// After admin approval
const result = await initializeGroupJoinPayment(
  groupId,
  totalAmount,
  approvedSlotNumber
);

await paystackService.initializePayment({
  email: user.email,
  amount: paystackService.toKobo(totalAmount),
  reference: result.reference,
  metadata: {
    userId: user.id,
    groupId: groupId,
    paymentType: 'group_join',
    slotNumber: approvedSlotNumber,
  },
  onSuccess: (response) => {
    navigate(`/payment/success?reference=${response.reference}&group=${groupId}`);
  },
});
```

### 3. Contribution Payment (Cycle)

**Flow:**
1. Group is active and contribution cycle is ongoing
2. Member views their pending contribution
3. Member pays contribution amount (no security deposit)
4. Payment is verified on backend
5. Contribution is recorded in database
6. When all members have contributed, cycle completes
7. Payout is triggered for the slot holder

**Code Example:**
```typescript
import { initializeContributionPayment } from '@/api/payments';

const result = await initializeContributionPayment(
  groupId,
  cycleId,
  contributionAmount
);

await paystackService.initializePayment({
  email: user.email,
  amount: paystackService.toKobo(contributionAmount),
  reference: result.reference,
  metadata: {
    userId: user.id,
    groupId: groupId,
    paymentType: 'contribution',
    cycleId: cycleId,
  },
  onSuccess: (response) => {
    navigate(`/payment/success?reference=${response.reference}&group=${groupId}`);
  },
});
```

## 🔐 Security Architecture

### Frontend (Public)
- Uses Paystack **public key** only
- Never stores or processes sensitive keys
- All payment initialization creates pending records
- Payment verification happens on backend

### Backend (Secure)
- Uses Paystack **secret key** (stored in Supabase secrets)
- Verifies payments with Paystack API
- Updates database with service role key (bypasses RLS)
- Activates memberships automatically

### Payment Flow Security

```
Frontend                  Paystack                 Backend (Edge Function)
   |                         |                            |
   |--1. Create Record------>|                            |
   |--2. Open Popup--------->|                            |
   |                         |--3. Process Payment------->|
   |                         |<--4. Return Success--------|
   |<-5. Close Popup---------|                            |
   |--6. Redirect to Success Page------------------->     |
   |                                                       |
   |--7. Call verify-payment Edge Function--------------->|
   |                                                       |
   |                         |<--8. Verify with API-------|
   |                         |--9. Confirm Payment------->|
   |                                                       |
   |<-10. Activate Membership (DB update)-----------------|
   |                                                       |
```

## 📊 Database Schema

### Required Tables

#### `payments`
```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  group_id UUID REFERENCES groups(id) NOT NULL,
  cycle_id UUID REFERENCES contribution_cycles(id),
  amount NUMERIC NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('group_creation', 'group_join', 'contribution')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'failed')),
  reference TEXT UNIQUE NOT NULL,
  metadata JSONB,
  verified_at TIMESTAMP,
  paystack_response JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `group_members`
```sql
CREATE TABLE group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  rotation_position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  payment_status TEXT DEFAULT 'pending',
  has_paid_security_deposit BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(group_id, user_id),
  UNIQUE(group_id, rotation_position)
);
```

### Required Database Functions

See `DATABASE_FUNCTIONS.md` for the `increment_group_members` function.

## 🚀 Deployment

### Prerequisites

1. **Supabase Project**
   - Active project with database
   - Project URL and anon key
   - Service role key

2. **Paystack Account**
   - Test keys for development
   - Live keys for production

3. **Development Tools**
   - Node.js 18+
   - Supabase CLI
   - Git

### Quick Deployment

```bash
# 1. Install Supabase CLI
brew install supabase/tap/supabase

# 2. Login to Supabase
supabase login

# 3. Link your project
supabase link --project-ref YOUR_PROJECT_REF

# 4. Deploy Edge Functions
./deploy-edge-functions.sh

# 5. Set environment variables
# Update .env.development:
VITE_PAYSTACK_PUBLIC_KEY=pk_test_your_key_here
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here

# 6. Test locally
npm run dev
```

For detailed deployment instructions, see `PAYMENT_DEPLOYMENT_GUIDE.md`.

## 🧪 Testing

### Test Cards (Paystack)

| Purpose | Card Number | CVV | PIN | OTP |
|---------|-------------|-----|-----|-----|
| Success | 4084084084084081 | 123 | 1234 | 123456 |
| Insufficient Funds | 4084084084084099 | 123 | 1234 | 123456 |

### Test Scenarios

1. **Group Creation Test**
   - Create a group as logged-in user
   - Select slot position
   - Complete payment with test card
   - Verify membership activation

2. **Join Request Test**
   - Browse available groups
   - Submit join request
   - Have admin approve (use different account)
   - Complete payment
   - Verify membership

3. **Contribution Test**
   - Join an active group
   - Wait for contribution due
   - Pay contribution
   - Verify payment recorded

## 🔧 Troubleshooting

### Payment Not Verifying

**Symptoms**: Payment succeeds but membership not activated

**Solutions**:
1. Check Edge Function logs: `supabase functions logs verify-payment`
2. Verify Paystack secret key is set
3. Check database RLS policies
4. Verify payment metadata includes all required fields

### CORS Errors

**Symptoms**: "blocked by CORS policy" errors

**Solutions**:
1. Ensure Edge Function has CORS headers
2. Redeploy Edge Function
3. Check request includes `apikey` header
4. Verify Supabase URL in environment

### Payment Popup Not Opening

**Symptoms**: Paystack popup doesn't appear

**Solutions**:
1. Check browser console for errors
2. Verify `VITE_PAYSTACK_PUBLIC_KEY` is set
3. Check if Paystack script is loaded (Network tab)
4. Disable ad blockers

## 📈 Future Enhancements

1. **Webhooks**: Add Paystack webhook handler for real-time updates
2. **Retry Logic**: Implement automatic retry for failed verifications
3. **Payment History**: Add detailed payment history page
4. **Refunds**: Implement security deposit refund logic
5. **Analytics**: Track payment success rates and failures
6. **Email Notifications**: Send payment receipts via email
7. **SMS Notifications**: Send payment confirmations via SMS

## 🤝 Support

For issues or questions:

1. Check `PAYMENT_DEPLOYMENT_GUIDE.md` for common issues
2. Review Edge Function logs for errors
3. Verify environment variables are correct
4. Test with Paystack test cards first
5. Check Paystack dashboard for payment status

## 📚 Additional Resources

- [Paystack API Documentation](https://paystack.com/docs/api)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)
- [Smart Ajo Architecture Guide](./ARCHITECTURE.md)

---

**Version**: 1.0.0  
**Last Updated**: 2026-02-03  
**Status**: Production Ready
