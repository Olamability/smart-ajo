# Payment Flow Visual Guide

## Complete Payment Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SMART AJO PAYMENT FLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

STEP 1: PAYMENT INITIATION
═══════════════════════════════════════════════════════════════════════════════

┌──────────────┐
│    User      │  Clicks "Pay Security Deposit" or "Pay Contribution"
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend (React)                                                            │
│  - GroupDetailPage.tsx or ContributionsList.tsx                             │
│                                                                              │
│  1. Call initializeGroupCreationPayment() or                                │
│     initializeGroupJoinPayment() or                                         │
│     initializeContributionPayment()                                         │
│                                                                              │
│  2. Creates transaction record:                                             │
│     ┌─────────────────────────────────────────┐                            │
│     │ transactions table                      │                            │
│     ├─────────────────────────────────────────┤                            │
│     │ reference: AJO-1234567890-123456        │                            │
│     │ status: pending                         │                            │
│     │ amount: 52500                           │                            │
│     │ user_id: user-uuid                      │                            │
│     │ group_id: group-uuid                    │                            │
│     │ metadata: { paymentType, slotNumber }   │                            │
│     └─────────────────────────────────────────┘                            │
│                                                                              │
│  3. Returns reference to frontend                                           │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼

STEP 2: PAYSTACK PAYMENT
═══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend                                                                    │
│  - src/lib/paystack.ts                                                      │
│                                                                              │
│  paystackService.initializePayment({                                        │
│    email: user.email,                                                       │
│    amount: 52500 * 100, // Convert to kobo                                 │
│    reference: "AJO-1234567890-123456",                                     │
│    metadata: {                                                              │
│      userId: "user-uuid",                                                   │
│      groupId: "group-uuid",                                                 │
│      paymentType: "group_creation",                                         │
│      slotNumber: 1                                                          │
│    },                                                                       │
│    onSuccess: (response) => {                                               │
│      window.location.href = "/payment/success?reference=...&group=..."     │
│    }                                                                        │
│  })                                                                         │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │   Paystack Modal     │
                        │   Opens (Popup)      │
                        └──────────┬───────────┘
                                   │
                                   │ User enters card details
                                   │ Card: 4084084084084081
                                   │ CVV: 123, PIN: 1234, OTP: 123456
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │  Paystack Processes  │
                        │  Payment             │
                        └──────────┬───────────┘
                                   │
                   ┌───────────────┴────────────────┐
                   │                                │
                   ▼                                ▼
           ┌──────────────┐              ┌──────────────┐
           │   SUCCESS    │              │    FAILED    │
           └──────┬───────┘              └──────┬───────┘
                  │                             │
                  │                             │
                  ▼                             ▼
         onSuccess() fires              onCancel() fires
                  │                             │
                  │                             │
                  ▼                             ▼
    window.location.href =              User sees error
    "/payment/success?..."              Can try again


STEP 3: REDIRECT TO VERIFICATION PAGE
═══════════════════════════════════════════════════════════════════════════════

                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Browser performs FULL PAGE RELOAD                                          │
│                                                                              │
│  URL: /payment/success?reference=AJO-1234567890-123456&group=group-uuid    │
│                                                                              │
│  Why full reload?                                                           │
│  - Ensures auth session is properly restored                                │
│  - Clears any stale state                                                   │
│  - Guarantees fresh data load                                               │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼

STEP 4: VERIFICATION PAGE LOADS
═══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│  PaymentSuccessPage.tsx                                                     │
│                                                                              │
│  1. Extract reference from URL params                                       │
│     reference = "AJO-1234567890-123456"                                     │
│     groupId = "group-uuid"                                                  │
│                                                                              │
│  2. Show loading state:                                                     │
│     ┌──────────────────────────────────┐                                   │
│     │  ⏳ Verifying Payment...          │                                   │
│     │                                   │                                   │
│     │  Please wait while we verify     │                                   │
│     │  your payment                    │                                   │
│     └──────────────────────────────────┘                                   │
│                                                                              │
│  3. Wait for auth context to be ready                                       │
│     (authLoading === false && isAuthenticated === true)                    │
│                                                                              │
│  4. Call verifyPaymentAndActivateMembership(reference)                     │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼

STEP 5: BACKEND VERIFICATION
═══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend API Call                                                          │
│  - src/api/payments.ts                                                      │
│                                                                              │
│  supabase.functions.invoke('verify-payment', {                             │
│    body: { reference: "AJO-1234567890-123456" }                            │
│  })                                                                         │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Supabase Edge Function                                                     │
│  - supabase/functions/verify-payment/index.ts                              │
│                                                                              │
│  1. Receive reference                                                       │
│     console.log('Payment verification request received')                   │
│     console.log(`Verifying payment: ${reference}`)                         │
│                                                                              │
│  2. Call Paystack API to verify:                                           │
│     ┌─────────────────────────────────────────────────────┐               │
│     │ GET https://api.paystack.co/transaction/verify/     │               │
│     │     AJO-1234567890-123456                           │               │
│     │                                                      │               │
│     │ Headers:                                             │               │
│     │   Authorization: Bearer sk_test_xxxxx               │               │
│     │   Content-Type: application/json                    │               │
│     └─────────────────────────────────────────────────────┘               │
│                                                                              │
│  3. Paystack Response:                                                      │
│     {                                                                       │
│       "status": true,                                                       │
│       "data": {                                                             │
│         "status": "success",                                                │
│         "reference": "AJO-1234567890-123456",                              │
│         "amount": 5250000, // kobo                                         │
│         "currency": "NGN",                                                  │
│         "metadata": {                                                       │
│           "userId": "user-uuid",                                            │
│           "groupId": "group-uuid",                                          │
│           "paymentType": "group_creation",                                  │
│           "slotNumber": 1                                                   │
│         }                                                                   │
│       }                                                                     │
│     }                                                                       │
│                                                                              │
│  4. Validate:                                                               │
│     ✓ Status is "success"                                                  │
│     ✓ Amount matches expected                                              │
│     ✓ Currency is NGN                                                       │
│     ✓ Metadata has userId, groupId                                         │
│                                                                              │
│  5. Update Database                                                         │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼

STEP 6: DATABASE UPDATES
═══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│  Database Operations (using service role key - bypasses RLS)               │
│                                                                              │
│  A. Update transaction record:                                              │
│     ┌────────────────────────────────────────────┐                         │
│     │ UPDATE transactions                        │                         │
│     │ SET                                         │                         │
│     │   status = 'completed',                    │                         │
│     │   completed_at = NOW(),                    │                         │
│     │   metadata = {                             │                         │
│     │     ...existing_metadata,                  │                         │
│     │     verification: {                        │                         │
│     │       paystack_response: {...},            │                         │
│     │       verified_at: NOW()                   │                         │
│     │     }                                       │                         │
│     │   }                                         │                         │
│     │ WHERE reference = 'AJO-...'                │                         │
│     └────────────────────────────────────────────┘                         │
│     console.log('Transaction record updated')                              │
│                                                                              │
│  B. Activate membership:                                                    │
│     ┌────────────────────────────────────────────┐                         │
│     │ INSERT INTO group_members                  │                         │
│     │   (group_id, user_id, rotation_position,   │                         │
│     │    status, payment_status)                 │                         │
│     │ VALUES                                      │                         │
│     │   ('group-uuid', 'user-uuid', 1,           │                         │
│     │    'active', 'paid')                       │                         │
│     │ ON CONFLICT (group_id, user_id)            │                         │
│     │ DO UPDATE SET                               │                         │
│     │   status = 'active',                       │                         │
│     │   payment_status = 'paid'                  │                         │
│     └────────────────────────────────────────────┘                         │
│     console.log('Group member added/updated')                              │
│                                                                              │
│  C. Check if group is full:                                                │
│     ┌────────────────────────────────────────────┐                         │
│     │ SELECT total_members, current_members      │                         │
│     │ FROM groups                                 │                         │
│     │ WHERE id = 'group-uuid'                    │                         │
│     └────────────────────────────────────────────┘                         │
│                                                                              │
│     If current_members >= total_members:                                   │
│     ┌────────────────────────────────────────────┐                         │
│     │ UPDATE groups                              │                         │
│     │ SET status = 'active'                      │                         │
│     │ WHERE id = 'group-uuid'                    │                         │
│     │   AND status = 'forming'                   │                         │
│     └────────────────────────────────────────────┘                         │
│     console.log('Group activated')                                         │
│                                                                              │
│  D. Return success:                                                         │
│     {                                                                       │
│       "success": true,                                                      │
│       "verified": true,                                                     │
│       "data": {                                                             │
│         "reference": "AJO-...",                                             │
│         "amount": 52500,                                                    │
│         "status": "success",                                                │
│         "paidAt": "2026-02-05T...",                                         │
│         "paymentType": "group_creation",                                    │
│         "groupId": "group-uuid",                                            │
│         "userId": "user-uuid"                                               │
│       }                                                                     │
│     }                                                                       │
│     console.log('Payment verification completed')                          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼

STEP 7: SUCCESS RESPONSE TO FRONTEND
═══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│  PaymentSuccessPage.tsx                                                     │
│                                                                              │
│  1. Receives success response                                               │
│     result = { success: true, verified: true }                             │
│                                                                              │
│  2. Update UI state:                                                        │
│     setVerified(true)                                                       │
│     setVerifying(false)                                                     │
│                                                                              │
│  3. Show success toast:                                                     │
│     toast.success('Payment verified! Membership activated.')               │
│                                                                              │
│  4. Display success screen:                                                │
│     ┌────────────────────────────────────────┐                             │
│     │           ✓                            │                             │
│     │                                         │                             │
│     │   Payment Successful!                  │                             │
│     │                                         │                             │
│     │   Your membership has been activated   │                             │
│     │                                         │                             │
│     │   ┌──────────────────────────────┐    │                             │
│     │   │  Go to Group        →        │    │                             │
│     │   └──────────────────────────────┘    │                             │
│     └────────────────────────────────────────┘                             │
│                                                                              │
│  5. User clicks "Go to Group"                                               │
│     window.location.href = `/groups/${groupId}`                            │
│     (Full page reload to fetch fresh data)                                 │
└─────────────────────────────────────────────────────────────────────────────┘


ERROR HANDLING FLOW
═══════════════════════════════════════════════════════════════════════════════

If verification fails:
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Check error type                                                        │
│                                                                              │
│     Is it a transient error?                                                │
│     - "Session not available"                                               │
│     - "network"                                                             │
│     - "timeout"                                                             │
│                                                                              │
│     ┌─────────────┐                                                        │
│     │     YES     │                                                        │
│     └──────┬──────┘                                                        │
│            │                                                                 │
│            ▼                                                                 │
│     Auto-retry after 2 seconds                                              │
│     (max 1 retry)                                                           │
│            │                                                                 │
│            ▼                                                                 │
│     Still fails?                                                            │
│            │                                                                 │
│            ▼                                                                 │
│     ┌─────────────────────────────────┐                                    │
│     │         ✗                       │                                    │
│     │                                  │                                    │
│     │ Payment Verification Failed     │                                    │
│     │                                  │                                    │
│     │ [Error message]                 │                                    │
│     │                                  │                                    │
│     │ ┌─────────────────────────┐    │                                    │
│     │ │  ↻ Retry Verification   │    │                                    │
│     │ └─────────────────────────┘    │                                    │
│     │ ┌─────────────────────────┐    │                                    │
│     │ │  Return to Dashboard    │    │                                    │
│     │ └─────────────────────────┘    │                                    │
│     └─────────────────────────────────┘                                    │
│                                                                              │
│  2. User can:                                                               │
│     - Click "Retry Verification" to try again                               │
│     - Click "Return to Dashboard" to go back                                │
│     - Refresh page to restart verification                                  │
└─────────────────────────────────────────────────────────────────────────────┘


KEY IMPROVEMENTS IN THIS IMPLEMENTATION
═══════════════════════════════════════════════════════════════════════════════

1. ✅ FULL PAGE RELOAD
   - Use window.location.href instead of navigate()
   - Ensures auth session is properly restored
   - Clears any stale state
   - Guarantees fresh data

2. ✅ AUTO-RETRY LOGIC
   - Automatically retries once for transient errors
   - 2-second delay between retries
   - Covers network and session issues

3. ✅ MANUAL RETRY BUTTON
   - User can manually trigger retry
   - Clear error messages
   - Actionable feedback

4. ✅ ENHANCED LOGGING
   - Comprehensive logs at each step
   - Easy debugging via Supabase dashboard
   - Track entire payment flow

5. ✅ BETTER UX
   - Success toast notifications
   - Loading states with spinners
   - Clear error messages
   - Progress indicators

═══════════════════════════════════════════════════════════════════════════════
                            END OF FLOW DIAGRAM
═══════════════════════════════════════════════════════════════════════════════
