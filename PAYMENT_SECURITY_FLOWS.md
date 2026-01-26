# Payment Security Flow Diagrams

## 1. Payment Initialization & Verification Flow

```
┌─────────────┐
│   FRONTEND  │
└─────┬───────┘
      │
      │ 1. User initiates payment
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  initializeGroupCreationPayment()                   │
│  - Creates PENDING payment record in database       │
│  - Reference: "GRP_CREATE_xxx"                      │
│  - Status: 'pending', Verified: false               │
└─────┬───────────────────────────────────────────────┘
      │
      │ 2. Open Paystack popup
      │
      ▼
┌─────────────┐
│  PAYSTACK   │  User completes payment
└─────┬───────┘
      │
      │ 3. Redirect to callback URL
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  PaymentSuccessPage (Frontend)                      │
│  - Receives reference from URL params               │
│  - Calls verifyPayment(reference)                   │
└─────┬───────────────────────────────────────────────┘
      │
      │ 4. POST /verify-payment (Edge Function)
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  VERIFY-PAYMENT EDGE FUNCTION (Backend)             │
├─────────────────────────────────────────────────────┤
│  Step 1: Authenticate User                          │
│  - Verify JWT token                                 │
│  - Get authenticated user                           │
├─────────────────────────────────────────────────────┤
│  Step 2: Verify with Paystack API                   │
│  - GET /transaction/verify/{reference}              │
│  - Uses PAYSTACK_SECRET_KEY (server-side only)      │
│  - Confirms payment status                          │
├─────────────────────────────────────────────────────┤
│  Step 3: Store/Update Payment Record                │
│  - Update status: 'success'                         │
│  - Update verified: true                            │
│  - Store Paystack response data                     │
├─────────────────────────────────────────────────────┤
│  Step 4: Execute Business Logic                     │
│  - Add user to group (processGroupCreationPayment)  │
│  - Create contribution records                      │
│  - Activate membership                              │
└─────┬───────────────────────────────────────────────┘
      │
      │ 5. Return verification result
      │
      ▼
┌─────────────┐
│   FRONTEND  │  Display success/error message
└─────────────┘
```

## 2. Webhook Signature Verification Flow

```
┌─────────────┐
│  PAYSTACK   │
└─────┬───────┘
      │
      │ Sends webhook event
      │ Headers: x-paystack-signature
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  PAYSTACK-WEBHOOK EDGE FUNCTION (Backend)           │
├─────────────────────────────────────────────────────┤
│  Step 1: Get Raw Request Body                       │
│  - const rawBody = await req.text()                 │
│  - MUST be raw before any parsing                   │
├─────────────────────────────────────────────────────┤
│  Step 2: Extract Signature Header                   │
│  - const signature = req.headers.get(               │
│      'x-paystack-signature'                         │
│    )                                                 │
│  - Reject if missing (400 Bad Request)              │
├─────────────────────────────────────────────────────┤
│  Step 3: Verify Signature (HMAC-SHA512)             │
│  ┌───────────────────────────────────────────────┐  │
│  │ verifySignature(rawBody, signature, secret)   │  │
│  │                                                │  │
│  │ 1. Create HMAC key from secret                │  │
│  │    crypto.subtle.importKey(...)               │  │
│  │                                                │  │
│  │ 2. Generate signature from raw body           │  │
│  │    crypto.subtle.sign('HMAC', key, rawBody)   │  │
│  │                                                │  │
│  │ 3. Convert to hex string                      │  │
│  │                                                │  │
│  │ 4. Compare with Paystack signature            │  │
│  │    return computed === signature              │  │
│  └───────────────────────────────────────────────┘  │
│  - Reject if invalid (401 Unauthorized)             │
├─────────────────────────────────────────────────────┤
│  Step 4: Parse and Process Event                    │
│  - const event = JSON.parse(rawBody)                │
│  - Process only after successful verification       │
├─────────────────────────────────────────────────────┤
│  Step 5: Store Payment Record                       │
│  - Update database with payment data                │
│  - Idempotent (safe for duplicate webhooks)         │
├─────────────────────────────────────────────────────┤
│  Step 6: Execute Business Logic                     │
│  - Same as verify-payment (backup/fallback)         │
│  - Handles cases where user closed browser          │
└─────────────────────────────────────────────────────┘
```

## 3. Security Controls Summary

```
┌────────────────────────────────────────────────────────┐
│                  SECURITY LAYERS                       │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Layer 1: Server-Side Only Verification                │
│  ────────────────────────────────────────              │
│  ✅ All verification in Edge Functions                 │
│  ✅ Frontend cannot update payment status              │
│  ✅ Secret keys never exposed to frontend              │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Layer 2: Correct Storage Order                       │
│  ─────────────────────────────                        │
│  ✅ Pending payment created first                      │
│  ✅ Verification before activation                     │
│  ✅ No race conditions                                 │
│  ✅ Idempotent processing                              │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Layer 3: Webhook Signature Verification              │
│  ──────────────────────────────────────               │
│  ✅ x-paystack-signature header required               │
│  ✅ Raw body used for verification                     │
│  ✅ HMAC-SHA512 algorithm                              │
│  ✅ Rejects invalid signatures                         │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Layer 4: Additional Protections                      │
│  ──────────────────────────────                       │
│  ✅ User authentication (JWT)                          │
│  ✅ Database Row Level Security (RLS)                  │
│  ✅ Environment variable protection                    │
│  ✅ CORS properly configured                           │
│  ✅ Error handling & logging                           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

## 4. Payment Record Lifecycle

```
┌──────────────────────────────────────────────────────────┐
│                   PAYMENT RECORD STATE                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  PHASE 1: Initialization (Frontend)                     │
│  ───────────────────────────────────                    │
│  Status: 'pending'                                       │
│  Verified: false                                         │
│  User_id: <user_id>                                      │
│  Reference: 'GRP_CREATE_xxx' or 'GRP_JOIN_xxx'          │
│  Metadata: { type, group_id, preferred_slot }           │
│                                                          │
│         │                                                │
│         │ User completes payment on Paystack            │
│         ▼                                                │
│                                                          │
│  PHASE 2: Verification (Backend - verify-payment)       │
│  ─────────────────────────────────────────────          │
│  1. Paystack API called                                 │
│  2. Payment record updated:                             │
│     Status: 'success' (or 'failed')                     │
│     Verified: true                                       │
│     Paid_at: <timestamp>                                │
│     Gateway_response: <response>                        │
│     Authorization_code: <code>                          │
│                                                          │
│         │                                                │
│         │ If status === 'success'                       │
│         ▼                                                │
│                                                          │
│  PHASE 3: Activation (Backend - business logic)         │
│  ───────────────────────────────────────────            │
│  - User added to group_members                          │
│  - Contribution record created                          │
│  - Transaction records created                          │
│  - Member status set to 'active'                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## 5. Race Condition Prevention

```
❌ INCORRECT FLOW (Race Condition Possible)
───────────────────────────────────────────

1. Verify payment
2. Activate user  ← User activated before payment stored
3. Store payment  ← If this fails, user is active with no payment record

✅ CORRECT FLOW (Current Implementation)
─────────────────────────────────────────

1. Create pending payment record  ← Payment reference exists from start
2. Verify payment with Paystack
3. Store/Update payment record    ← Payment verified and stored
4. Activate user                  ← Only activate after payment confirmed

Benefits:
- Payment always stored before activation
- If activation fails, payment is still recorded
- Idempotent: Can safely retry activation
- Audit trail is complete
```

## 6. Signature Verification Algorithm

```
┌─────────────────────────────────────────────────────┐
│  HMAC-SHA512 Signature Verification                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Input:                                             │
│  - rawBody: "{"event":"charge.success",...}"        │
│  - signature: "abc123..." (from header)             │
│  - secret: PAYSTACK_SECRET_KEY                      │
│                                                     │
│  Algorithm:                                         │
│  1. Import HMAC key from secret                     │
│     key = crypto.subtle.importKey(                  │
│       'raw',                                        │
│       secret,                                       │
│       { name: 'HMAC', hash: 'SHA-512' }             │
│     )                                               │
│                                                     │
│  2. Sign the raw body                               │
│     signatureBuffer = crypto.subtle.sign(           │
│       'HMAC',                                       │
│       key,                                          │
│       rawBody                                       │
│     )                                               │
│                                                     │
│  3. Convert to hex string                           │
│     computed = buffer                               │
│       .map(b => b.toString(16).padStart(2, '0'))    │
│       .join('')                                     │
│                                                     │
│  4. Compare signatures                              │
│     return computed === signature                   │
│                                                     │
│  Result: true if valid, false if invalid            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Key Takeaways

1. **All verification is server-side** - Frontend cannot manipulate payment status
2. **Payment stored before activation** - No race conditions possible
3. **Webhooks are verified** - Using HMAC-SHA512 signature verification
4. **Idempotent processing** - Safe to retry or receive duplicate webhooks
5. **Complete audit trail** - Every payment is recorded with full details
6. **Production-ready** - Follows all security best practices

---

For detailed implementation, see:
- `PAYMENT_SECURITY_AUDIT.md` - Complete technical audit
- `PAYMENT_SECURITY_SUMMARY.md` - Executive summary
