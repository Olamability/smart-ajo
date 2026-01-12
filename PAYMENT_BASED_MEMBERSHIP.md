# Payment-Based Membership Implementation Guide

## Overview

This document describes the payment-based membership system for SmartAjo groups. The system ensures that all group members are committed by requiring payment, with admin approval for joining members.

## Core Principles

1. **Group Creator = Admin** - The user who creates a group is automatically the admin
2. **Creator Pays Immediately** - Creator must pay to create and join their group
3. **Members Need Approval** - Admin must approve join requests before payment
4. **Payment Validates Membership** - After approval, payment confirms membership

## Payment Flows

### 1. Group Creation Flow (Creator Becomes Admin)

When a user creates a group:

1. **Create Group** - Group is created with `current_members: 0` and `status: 'forming'`
2. **Calculate Total** - Total = Security Deposit + First Contribution
3. **Initialize Payment** - Call `initializeGroupCreationPayment(groupId, totalAmount)`
4. **Show Payment Dialog** - Open Paystack payment popup
5. **User Pays** - Creator completes payment via Paystack
6. **Verify Payment** - Call backend `verifyPayment(reference)`
7. **Process Payment** - Call `processGroupCreationPayment(reference, groupId)`
8. **Creator Added** - Creator is added as first member AND becomes group admin
9. **Redirect** - Take creator to group detail page

### 2. Join Group Flow (Admin Approval → Payment → Membership)

When a user wants to join an existing group:

#### Step 1: Request to Join
1. **View Group** - User sees available group on Groups page
2. **Click Join** - User clicks "Request to Join" button
3. **Create Request** - Call `joinGroup(groupId, message?)` - creates join request with status='pending'
4. **Show Confirmation** - "Your request has been sent to the group admin"

#### Step 2: Admin Approval
1. **Admin Views Requests** - Group admin sees pending join requests
2. **Admin Approves** - Admin clicks "Approve" on the request
3. **Request Updated** - Join request status changes to 'approved'
4. **User Notified** - User receives notification that they can now pay

#### Step 3: Payment & Membership
1. **User Views Notification** - User sees they've been approved
2. **Calculate Total** - Total = Security Deposit + First Contribution  
3. **Initialize Payment** - Call `initializeGroupJoinPayment(groupId, totalAmount)`
4. **Show Payment Dialog** - Open Paystack payment popup
5. **User Pays** - User completes payment via Paystack
6. **Verify Payment** - Call backend `verifyPayment(reference)`
7. **Process Payment** - Call `processApprovedJoinPayment(reference, groupId)`
8. **Member Added** - User is added as active member with next available position
9. **Request Completed** - Join request status changes to 'completed'
10. **Group Status Update** - If group is now full, status changes to 'active'
11. **Redirect** - Take user to group detail page

## API Functions

### Frontend (src/api/payments.ts)

```typescript
// Initialize payment for group creation
initializeGroupCreationPayment(groupId: string, amount: number)
  → Returns: { success, reference, error? }

// Initialize payment for joining group (after admin approval)
initializeGroupJoinPayment(groupId: string, amount: number)
  → Returns: { success, reference, error? }

// Verify payment with backend (existing)
verifyPayment(reference: string)
  → Returns: { success, verified, amount, message, data?, error? }

// Process group creation payment after verification
processGroupCreationPayment(reference: string, groupId: string)
  → Returns: { success, error? }

// Process approved join request payment after verification
processApprovedJoinPayment(reference: string, groupId: string)
  → Returns: { success, position?, error? }
```

### Frontend (src/api/groups.ts)

```typescript
// Request to join a group (creates pending join request)
joinGroup(groupId: string, message?: string)
  → Returns: { success, error? }

// Approve a join request (admin only)
approveJoinRequest(requestId: string)
  → Returns: { success, error? }

// Reject a join request (admin only)
rejectJoinRequest(requestId: string, reason?: string)
  → Returns: { success, error? }
```

### Backend (supabase/migrations/)

```sql
-- Process verified payment for group creation
process_group_creation_payment(
  p_payment_reference VARCHAR(255),
  p_group_id UUID,
  p_user_id UUID
)
→ Returns: TABLE(success BOOLEAN, error_message TEXT)

-- Approve join request (marks as approved, doesn't add member)
approve_join_request(
  p_request_id UUID,
  p_reviewer_id UUID
)
→ Returns: TABLE(success BOOLEAN, error_message TEXT)

-- Process approved join request payment
process_approved_join_payment(
  p_payment_reference VARCHAR(255),
  p_group_id UUID,
  p_user_id UUID
)
→ Returns: TABLE(success BOOLEAN, error_message TEXT, position INTEGER)
```

## Database Changes

### Trigger: update_group_member_count

- Automatically increments/decrements `current_members` when members are added/removed
- Ensures `current_members` is always in sync with actual member count

### Group Creation Changes

- Groups now start with `current_members: 0` (not 1)
- Creator is NOT automatically added as member
- Creator is added only after payment is processed

### Automatic Group Activation

- When last member pays and joins, group status changes from 'forming' to 'active'
- This happens automatically in `process_group_join_payment()`

## UI Integration

### CreateGroupPage Component

**After group is created successfully:**

```typescript
// 1. Calculate total payment amount
const securityDeposit = (contributionAmount * securityDepositPercentage) / 100;
const totalAmount = securityDeposit + contributionAmount;

// 2. Initialize payment
const { success, reference, error } = await initializeGroupCreationPayment(
  createdGroup.id,
  totalAmount
);

// 3. Show Paystack payment popup
// Use PaystackButton or PaystackConsumer component
// Pass the reference and amount

// 4. On payment success callback:
const verifyResult = await verifyPayment(reference);
if (verifyResult.verified) {
  const processResult = await processGroupCreationPayment(reference, createdGroup.id);
  if (processResult.success) {
    toast.success('Group created and you are now the admin!');
    navigate(`/groups/${createdGroup.id}`);
  }
}
```

### GroupsPage / AvailableGroupsSection Component

**When user clicks "Request to Join":**

```typescript
// 1. Create join request
const result = await joinGroup(group.id, 'I would like to join this group');

if (result.success) {
  toast.success('Join request sent! Waiting for admin approval.');
} else {
  toast.error(result.error || 'Failed to send join request');
}
```

### GroupDetailPage - Join Requests Section (For Admin)

**When admin clicks "Approve" on a join request:**

```typescript
// 1. Approve the request
const result = await approveJoinRequest(requestId);

if (result.success) {
  toast.success('Request approved! User can now pay to join.');
  // Refresh join requests list
} else {
  toast.error(result.error || 'Failed to approve request');
}
```

### GroupDetailPage or Notifications - After Approval (For User)

**When user sees they've been approved and clicks "Pay to Join":**

```typescript
// 1. Calculate total payment amount
const securityDeposit = group.securityDepositAmount;
const contributionAmount = group.contributionAmount;
const totalAmount = securityDeposit + contributionAmount;

// 2. Initialize payment
const { success, reference, error } = await initializeGroupJoinPayment(
  group.id,
  totalAmount
);

// 3. Show Paystack payment popup
// Use PaystackButton or PaystackConsumer component

// 4. On payment success callback:
const verifyResult = await verifyPayment(reference);
if (verifyResult.verified) {
  const processResult = await processApprovedJoinPayment(reference, group.id);
  if (processResult.success) {
    toast.success(`Successfully joined group! Position: ${processResult.position}`);
    navigate(`/groups/${group.id}`);
  }
}
```

## Payment Amounts

### Security Deposit
- Calculated as percentage of contribution amount
- Example: If contribution is ₦10,000 and security deposit is 20%, then security deposit = ₦2,000

### First Contribution
- Equal to the group's contribution amount
- Paid immediately upon joining/creating

### Total Payment
```
Total = Security Deposit + First Contribution
Example: ₦2,000 + ₦10,000 = ₦12,000
```

## Database Records Created

### After Successful Payment

1. **Payment Record** (payments table)
   - Status: 'success'
   - Verified: true
   - Metadata: Contains group_id, user_id, type (group_creation or group_join)

2. **Group Member Record** (group_members table)
   - Status: 'active' (immediately active)
   - has_paid_security_deposit: true
   - Position: Next available position

3. **Contribution Record** (contributions table)
   - Cycle: 1 (first cycle)
   - Status: 'paid'
   - Amount: Contribution amount
   - Reference: Payment reference

4. **Transaction Records** (transactions table)
   - 2 records created:
     - Security deposit transaction
     - First contribution transaction

## Error Handling

### Payment Initialization Errors
- Database connection issues
- Invalid group ID
- User not authenticated

### Payment Verification Errors
- Payment not found
- Payment not verified
- Backend verification failed

### Payment Processing Errors
- Payment amount mismatch
- Group already full
- User already a member
- Group not accepting members (not in 'forming' status)

## Migration Steps

### To Deploy This Feature:

1. **Run Database Migrations**
   ```bash
   # Run in SQL editor or via Supabase CLI
   supabase/migrations/fix_group_member_count.sql
   supabase/migrations/payment_based_membership.sql
   ```

2. **Update Supabase Functions**
   - Ensure `verify-payment` Edge Function is deployed
   - Test payment verification flow

3. **Update Frontend Code**
   - Integrate payment flows in CreateGroupPage
   - Integrate payment flows in GroupsPage/AvailableGroupsSection
   - Add Paystack components if not already present

4. **Test End-to-End**
   - Create group with payment
   - Join group with payment
   - Verify member count updates correctly
   - Verify group activates when full

## Backward Compatibility

### Old Join Request Flow
The old flow (request → admin approval → member) is still available but deprecated. Groups can still use admin approval if they prefer, but the recommended flow is payment-based.

### Existing Groups
- Existing groups with members already added will continue to work
- The migration fixes any `current_members` count mismatches
- No data loss or breaking changes

## Testing Checklist

- [ ] Create group with payment (test mode)
- [ ] Verify creator is added as member after payment
- [ ] Verify current_members increments to 1
- [ ] Join group with payment (test mode)
- [ ] Verify member is added automatically
- [ ] Verify current_members increments correctly
- [ ] Fill group to capacity and verify it activates
- [ ] Test payment failure scenarios
- [ ] Test payment amount validation
- [ ] Test with multiple users simultaneously

## Security Considerations

1. **Payment Verification**: Always verify payments on backend before granting membership
2. **Amount Validation**: Backend validates payment amount matches expected total
3. **RLS Policies**: Database RLS policies prevent unauthorized member additions
4. **Idempotency**: Functions handle duplicate payment processing gracefully
5. **Transaction Safety**: Database functions use exception handling and rollback

## Support

For issues or questions about the payment-based membership system:
1. Check Supabase logs for backend errors
2. Check browser console for frontend errors
3. Verify Paystack configuration (public key, secret key)
4. Test in Paystack test mode before going live
