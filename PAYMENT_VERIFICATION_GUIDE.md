# Payment Verification + Activation Flow Guide

## Overview

This guide documents the complete payment verification and membership activation flow for the Smart Ajo platform. The implementation follows industry best practices for secure payment processing using Paystack.

## Architecture

### Flow Summary

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│   User      │────▶│   Frontend   │────▶│    Paystack     │────▶│   Backend    │
│   Action    │     │   (React)    │     │   Payment API   │     │  (Supabase)  │
└─────────────┘     └──────────────┘     └─────────────────┘     └──────────────┘
      │                    │                       │                      │
      │                    │                       │                      │
      ▼                    ▼                       ▼                      ▼
  Click Pay          Initialize           Process Payment         Verify & Activate
                     Payment Record       Show Modal              Update Database
                                         Complete Payment         Activate Membership
```

### Step-by-Step Flow

#### Step 1: Payment Initiation (Frontend)

1. **User Action**: User clicks "Pay Security Deposit" or "Pay Contribution"
2. **Initialize Payment Record**: 
   - Frontend calls `initializeGroupCreationPayment()` or `initializeGroupJoinPayment()`
   - Creates a pending transaction record in the database
   - Returns a unique payment reference (e.g., `AJO-1234567890-123456`)

3. **Open Paystack Modal**:
   - Frontend calls `paystackService.initializePayment()`
   - Paystack popup modal opens
   - User enters card details and completes payment

#### Step 2: Payment Completion (Paystack)

1. **Paystack Processing**: 
   - User completes payment in Paystack modal
   - Paystack validates card and processes transaction
   - Payment status: `success`, `failed`, or `abandoned`

2. **Callback Handling**:
   - On success: `onSuccess` callback fires
   - Frontend navigates to `/payment/success?reference=XYZ&group=ABC`
   - Uses `window.location.href` for full page reload (ensures session restoration)

#### Step 3: Backend Verification (Edge Function)

1. **Frontend Request**:
   - `PaymentSuccessPage` loads
   - Waits for authentication context to be ready
   - Calls `verifyPaymentAndActivateMembership(reference)`
   - This invokes the `verify-payment` Supabase Edge Function

2. **Paystack Verification**:
   ```typescript
   // Backend makes server-to-server call
   GET https://api.paystack.co/transaction/verify/{reference}
   Headers: Authorization: Bearer {PAYSTACK_SECRET_KEY}
   ```

3. **Validation Checks**:
   - ✅ Payment status is `success`
   - ✅ Amount matches expected amount
   - ✅ Currency is NGN
   - ✅ Metadata contains userId, groupId, paymentType

#### Step 4: Database Updates (Backend)

1. **Update Transaction Record**:
   ```sql
   UPDATE transactions 
   SET status = 'completed', 
       completed_at = NOW(),
       metadata = {...verification_data}
   WHERE reference = 'XYZ'
   ```

2. **Activate Membership** (for group_creation/group_join):
   ```sql
   INSERT INTO group_members (group_id, user_id, rotation_position, status, payment_status)
   VALUES (groupId, userId, slotNumber, 'active', 'paid')
   ON CONFLICT (group_id, user_id) 
   DO UPDATE SET status = 'active', payment_status = 'paid'
   ```

3. **Update Group Status** (if all slots filled):
   ```sql
   UPDATE groups 
   SET status = 'active' 
   WHERE id = groupId 
     AND current_members >= total_members
     AND status = 'forming'
   ```

4. **Record Contribution** (for contribution payments):
   ```sql
   UPDATE contributions 
   SET status = 'paid', 
       paid_date = NOW(),
       transaction_ref = reference
   WHERE id = contributionId
   ```

#### Step 5: Frontend Response

1. **Success Response**:
   - Edge Function returns `{ success: true, verified: true }`
   - Frontend shows success message with green checkmark
   - "Payment Successful! Your membership has been activated"
   - Button: "Go to Group" (redirects to group page)

2. **Failure Response**:
   - Edge Function returns `{ success: false, error: "message" }`
   - Frontend shows error message with red X
   - Automatic retry once for transient errors
   - Manual "Retry Verification" button available
   - Button: "Return to Dashboard"

## Key Features

### 1. Reliable Navigation

**Problem**: Using React Router's `navigate()` after Paystack callback can cause timing issues with session restoration.

**Solution**: Use `window.location.href` for full page reload:

```typescript
onSuccess: (response) => {
  window.location.href = `/payment/success?reference=${reference}&group=${groupId}`;
}
```

### 2. Auto-Retry Logic

Automatically retries verification once for transient errors:

- Session not available (auth context still loading)
- Network errors
- Timeout errors

```typescript
if (retryCount < 1 && isTransientError(result.error)) {
  setTimeout(() => setRetryCount(prev => prev + 1), 2000);
}
```

### 3. Manual Retry Button

Allows users to manually retry verification if auto-retry fails:

```typescript
<Button onClick={handleRetry} variant="secondary">
  <RefreshCw className="mr-2 h-4 w-4" />
  Retry Verification
</Button>
```

### 4. Enhanced Logging

Edge Function includes comprehensive logging for debugging:

```typescript
console.log('Payment verification request received');
console.log(`Verifying payment with reference: ${reference}`);
console.log(`Processing ${paymentType} payment for slot ${slotNumber}`);
console.log('Payment verification completed successfully');
```

### 5. Full Page Reload After Verification

After successful verification, use full page reload to ensure fresh data:

```typescript
const handleContinue = () => {
  window.location.href = `/groups/${groupId}`;
};
```

## Payment Types

### 1. Group Creation Payment

**When**: Creator pays to create and join a new group

**Components**:
- Security deposit
- First contribution
- Service fee

**Process**:
1. User creates group
2. Selects payout slot (1-N)
3. Pays total amount
4. Becomes first group member
5. Group status remains `forming`

**Metadata**:
```json
{
  "userId": "uuid",
  "groupId": "uuid",
  "paymentType": "group_creation",
  "slotNumber": 1
}
```

### 2. Group Join Payment

**When**: Member pays to join after admin approval

**Components**:
- Security deposit
- First contribution
- Service fee

**Process**:
1. User requests to join group
2. Admin approves request
3. User pays total amount
4. Becomes active group member
5. Join request status updated to `paid`
6. Group activates if all slots filled

**Metadata**:
```json
{
  "userId": "uuid",
  "groupId": "uuid",
  "paymentType": "group_join",
  "slotNumber": 3
}
```

### 3. Contribution Payment

**When**: Member pays their cycle contribution

**Components**:
- Contribution amount only

**Process**:
1. User views pending contribution
2. Pays contribution amount
3. Contribution marked as `paid`
4. If all members paid, cycle completes
5. Payout triggered for slot holder

**Metadata**:
```json
{
  "userId": "uuid",
  "groupId": "uuid",
  "paymentType": "contribution",
  "contributionId": "uuid",
  "cycleNumber": 2
}
```

## Error Handling

### Frontend Errors

| Error | Cause | Solution |
|-------|-------|----------|
| No payment reference | Missing query param | Show error message, return to dashboard |
| Session not available | Auth context loading | Wait with retry logic |
| Not authenticated | User logged out | Prompt to log in, enable retry |
| Verification failed | Backend error | Show error message, enable retry |
| Network error | Connectivity issue | Auto-retry once, then manual retry |

### Backend Errors

| Error | Cause | Solution |
|-------|-------|----------|
| PAYSTACK_SECRET_KEY not configured | Missing env var | Set in Supabase secrets |
| Payment verification failed | Paystack API error | Check API key, network |
| Payment not successful | User cancelled/failed | Return appropriate status |
| Invalid metadata | Missing userId/groupId | Validate metadata before payment |
| Transaction update failed | Database error | Check RLS policies, logs |
| Membership activation failed | Database error | Check constraints, RLS |

## Testing

### Test Flow

1. **Setup Test Data**:
   - Create test user account
   - Create test group or browse existing

2. **Test Group Creation Payment**:
   ```
   1. Create new group
   2. Select slot #1
   3. Click "Pay Security Deposit"
   4. Use Paystack test card: 4084084084084081
   5. CVV: 123, PIN: 1234, OTP: 123456
   6. Verify redirect to /payment/success
   7. Verify "Payment Successful!" message
   8. Verify membership status is active
   9. Click "Go to Group"
   10. Verify user is shown as active member
   ```

3. **Test Group Join Payment**:
   ```
   1. Browse available groups
   2. Submit join request
   3. Admin approves request (use different account)
   4. Pay security deposit
   5. Use Paystack test card
   6. Verify verification succeeds
   7. Verify membership is active
   ```

4. **Test Contribution Payment**:
   ```
   1. Join active group
   2. View contribution schedule
   3. Click "Pay Contribution"
   4. Use Paystack test card
   5. Verify verification succeeds
   6. Verify contribution marked as paid
   ```

5. **Test Error Scenarios**:
   ```
   1. Test with insufficient funds card: 4084084084084099
   2. Close payment modal without paying
   3. Test with invalid reference
   4. Test with expired session (log out during payment)
   5. Verify error messages shown correctly
   6. Verify retry button works
   ```

## Configuration

### Environment Variables

**Frontend (.env)**:
```bash
VITE_PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxx
VITE_APP_URL=https://smart-ajo.vercel.app
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxxxxxxxxxxx
```

**Backend (Supabase Secrets)**:
```bash
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxx
SUPABASE_SERVICE_ROLE_KEY=xxxxxxxxxxxxx
```

### Paystack Configuration

1. **Dashboard Settings**:
   - Set callback URL: `https://smart-ajo.vercel.app/payment/success`
   - Note: This is informational only for popup mode
   - Enable test mode for development

2. **API Keys**:
   - Use test keys for development: `pk_test_*` and `sk_test_*`
   - Use live keys for production: `pk_live_*` and `sk_live_*`

## Deployment

### Edge Function Deployment

```bash
# Deploy verify-payment function
supabase functions deploy verify-payment

# Set secrets
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxxxx
```

### Frontend Deployment

```bash
# Build and deploy to Vercel
npm run build
vercel --prod
```

## Monitoring

### Logs to Monitor

1. **Frontend Console**:
   ```
   PaymentSuccessPage: Waiting for auth context to be ready...
   PaymentSuccessPage: Verifying payment with reference: AJO-xxx
   Payment verified successfully! Membership activated.
   ```

2. **Edge Function Logs** (via Supabase Dashboard):
   ```
   Payment verification request received
   Verifying payment with reference: AJO-xxx
   Paystack verification response - status: success
   Processing group_creation payment for slot 1
   Updating transaction record to completed
   Transaction record updated successfully
   Group member added/updated successfully
   Payment verification completed successfully
   ```

3. **Database Changes**:
   - Check `transactions` table for completed status
   - Check `group_members` table for active members
   - Check `groups` table for status updates

## Troubleshooting

### "Payment verification failed"

1. Check Edge Function logs
2. Verify PAYSTACK_SECRET_KEY is set
3. Verify payment reference is valid
4. Check Paystack dashboard for transaction status

### "Session not available"

1. Ensure user is logged in
2. Wait for auth context to load
3. Use retry button
4. Clear browser cache if persists

### "Membership not activated"

1. Check Edge Function logs
2. Verify transaction was marked complete
3. Check database RLS policies
4. Verify metadata includes all required fields

### "Payment modal stuck/hanging"

1. Check browser console for errors
2. Verify Paystack public key is correct
3. Disable browser ad blockers
4. Try different browser

## Security Considerations

### ✅ Best Practices Implemented

1. **Secret Key Protection**: Paystack secret key only on backend
2. **Server-Side Verification**: All verification via Edge Function
3. **Idempotent Operations**: Can safely retry verification
4. **RLS Policies**: Database access controlled by RLS
5. **Metadata Validation**: Backend validates all metadata
6. **Amount Verification**: Backend checks payment amount matches expected

### ⚠️ Important Notes

- Never expose Paystack secret key in frontend code
- Always verify payments on backend, never trust frontend
- Use Supabase service role key only in Edge Functions
- Implement rate limiting for verification endpoint
- Log all payment attempts for audit trail

## Migration Notes

### Changes from Previous Implementation

1. **Navigation**: Changed from `navigate()` to `window.location.href`
2. **Retry Logic**: Added automatic and manual retry capabilities
3. **Logging**: Enhanced logging in Edge Function for debugging
4. **Error Handling**: Improved error messages and user feedback
5. **Session Handling**: Better handling of auth context after redirect

### Breaking Changes

None. The changes are backwards compatible.

## Future Enhancements

1. **Webhook Integration**: Add Paystack webhook for real-time updates
2. **Payment History**: Enhanced payment history page with filters
3. **Refund Support**: Implement automated refund process
4. **Multiple Payment Methods**: Support bank transfer, USSD
5. **Payment Reminders**: Email/SMS reminders for pending payments
6. **Fraud Detection**: Additional validation and fraud checks
7. **Analytics Dashboard**: Payment metrics and success rates

## Support

For issues or questions:

1. Check Edge Function logs in Supabase Dashboard
2. Review browser console for frontend errors
3. Verify environment variables are set correctly
4. Check Paystack dashboard for transaction status
5. Review this guide for common issues

## References

- [Paystack API Documentation](https://paystack.com/docs/api/)
- [Paystack Inline JS Guide](https://paystack.com/docs/payments/accept-payments/)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase RLS Policies](https://supabase.com/docs/guides/auth/row-level-security)

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-05  
**Status**: Production Ready
