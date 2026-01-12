# Test Plan: Payment RLS Fix

## Overview
This test plan verifies that the RLS policy fix for the payments table allows users to create payment records and enforces payment-first membership for group creation.

## Prerequisites
- Apply updated `schema.sql` and `functions.sql` to the database
- Ensure `payments` table exists with proper RLS policies
- Ensure `auto_add_group_creator_trigger` is disabled
- Ensure `process_group_creation_payment()` function is available

## Test Cases

### Test 1: Payment Record Creation
**Objective**: Verify users can create pending payment records

**Steps**:
1. Log in as a regular user
2. Navigate to Create Group page
3. Fill in group details:
   - Name: "Test Group"
   - Contribution: ₦5000
   - Frequency: Monthly
   - Members: 5
   - Security Deposit: 20%
4. Click "Create Group"
5. Select a payout slot in the payment dialog
6. Click "Pay" button

**Expected Result**:
- Payment record is created successfully
- No "row-level security policy" error
- Paystack payment interface opens

**Actual Result**:
- [ ] Pass
- [ ] Fail (describe error):

---

### Test 2: Group Creation Without Payment
**Objective**: Verify group is created but creator is NOT added until payment

**Steps**:
1. Create a group (follow Test 1 steps 1-4)
2. Check the database for the created group
3. Query `group_members` table for the group

**Expected Result**:
- Group exists in `groups` table with `status = 'forming'`
- Group has `current_members = 0`
- No entry in `group_members` table for the creator
- Creator is NOT automatically added

**Actual Result**:
- [ ] Pass
- [ ] Fail (describe error):

---

### Test 3: Payment Verification and Member Addition
**Objective**: Verify creator is added as member after successful payment

**Steps**:
1. Create a group and initiate payment (Test 1 steps 1-6)
2. Complete payment with Paystack (use test card: 4084 0840 8408 4081)
3. Wait for payment verification
4. Check group membership

**Expected Result**:
- Payment is verified (`verified = true` in `payments` table)
- Creator is added to `group_members` with:
  - `status = 'active'`
  - `has_paid_security_deposit = true`
  - `is_creator = true`
  - `position = selected_slot`
- Group `current_members = 1`
- First contribution record created with `status = 'paid'`
- Transaction records created for security deposit and first contribution

**Actual Result**:
- [ ] Pass
- [ ] Fail (describe error):

---

### Test 4: Payment Cancellation
**Objective**: Verify group remains empty if payment is cancelled

**Steps**:
1. Create a group and initiate payment
2. Close Paystack payment modal without completing payment
3. Check group membership

**Expected Result**:
- Group exists with `status = 'forming'`
- Group has `current_members = 0`
- Payment record exists with `status = 'pending'`, `verified = false`
- No member entry for creator

**Actual Result**:
- [ ] Pass
- [ ] Fail (describe error):

---

### Test 5: RLS Policy Enforcement
**Objective**: Verify RLS policies are enforced correctly

**Steps**:
1. As User A, create a payment record for a group
2. As User B, try to view User A's payment record
3. As User A, try to update the `verified` field directly

**Expected Result**:
- User A can insert payment with `status = 'pending'` and `verified = false`
- User A can view their own payment
- User B cannot view User A's payment
- User A cannot update `verified` field (only service role can)

**Actual Result**:
- [ ] Pass
- [ ] Fail (describe error):

---

### Test 6: Concurrent Group Creation
**Objective**: Verify no race conditions in slot assignment

**Steps**:
1. Create a group with 5 slots
2. Have 3 users simultaneously create payments and select slot 2
3. Complete payments for all 3 users

**Expected Result**:
- Only first successful payment gets slot 2
- Other users either get error or are assigned different slots
- No duplicate slot assignments

**Actual Result**:
- [ ] Pass
- [ ] Fail (describe error):

---

## Security Validation

### SQL Injection Test
**Objective**: Verify function is safe from SQL injection

**Test**: Try to inject SQL in payment reference:
```
'; DROP TABLE payments; --
```

**Expected**: Function sanitizes input, no SQL injection occurs

**Result**:
- [ ] Pass
- [ ] Fail

### Privilege Escalation Test
**Objective**: Verify users cannot bypass payment

**Test**: Try to call `process_group_creation_payment` with unverified payment

**Expected**: Function checks `verified = true`, rejects unverified payments

**Result**:
- [ ] Pass
- [ ] Fail

---

## Performance Testing

### Load Test
**Objective**: Verify system handles multiple concurrent group creations

**Test**: Simulate 10 concurrent group creations with payments

**Expected**: All groups created successfully, no deadlocks or race conditions

**Result**:
- [ ] Pass
- [ ] Fail

---

## Rollback Plan

If tests fail, rollback by:
1. Applying previous version of `schema.sql`
2. Applying previous version of `functions.sql`
3. Running migration `fix_payments_insert_policy.sql` manually if needed
4. Re-enabling `auto_add_group_creator_trigger` if required

---

## Sign-off

- [ ] All critical tests passed
- [ ] Security validation completed
- [ ] Performance acceptable
- [ ] Documentation updated

**Tester**: _______________
**Date**: _______________
**Environment**: _______________
