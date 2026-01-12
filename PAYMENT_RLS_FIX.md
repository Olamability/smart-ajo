# Payment RLS Policy Fix

## Problem
Users were unable to create groups because payment record creation failed with error:
```
Error: new row violates row-level security policy for table "payments"
```

Additionally, groups were being created even when payment failed, violating the payment-first membership model.

## Root Cause
1. **Missing INSERT policy**: The `payments` table had RLS enabled but lacked an INSERT policy for users. The fix was in a separate migration file (`fix_payments_insert_policy.sql`) that may not have been applied to production.

2. **Auto-add trigger conflict**: The `auto_add_group_creator_trigger` was automatically adding creators as members immediately on group creation, conflicting with the payment-based membership system that requires payment before membership.

## Solution

### 1. Added Payments Table to Main Schema
- Added the complete `payments` table definition to `schema.sql`
- Included proper INSERT policy allowing users to create pending payments
- Policy: Users can insert payments for themselves with `status='pending'` and `verified=false`

### 2. Disabled Auto-Add Creator Trigger
- Commented out `auto_add_group_creator_trigger` in `schema.sql`
- Creator is now added only after successful payment via `process_group_creation_payment()`
- This ensures payment-first membership model

### 3. Added Payment Processing Function
- Added `process_group_creation_payment()` to `functions.sql`
- Function validates payment and adds creator as member with selected slot
- Handles security deposit, first contribution, and transaction records

## Changes Made

### Files Modified
1. `supabase/schema.sql`
   - Added `payments` table definition (lines 1084-1184)
   - Added RLS policies for payments including INSERT policy
   - Disabled `auto_add_group_creator_trigger` (lines 565-598)

2. `supabase/functions.sql`
   - Added `process_group_creation_payment()` function
   - Function processes verified payments and adds creator as member

## Deployment Instructions

### For Existing Databases
If you already have a database with the payments table but missing the INSERT policy:

```sql
-- Run this to add the missing INSERT policy
CREATE POLICY payments_insert_own ON payments
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id 
    AND status = 'pending'
    AND verified = false
  );

-- Drop the auto-add creator trigger to prevent immediate membership
DROP TRIGGER IF EXISTS auto_add_group_creator_trigger ON groups;
```

### For New Databases
Simply run the updated files in order:
1. `schema.sql` (includes payments table and correct policies)
2. `functions.sql` (includes payment processing function)
3. `admin_functions.sql`
4. `verify-setup.sql`

## Testing
After applying the fix, test the following flow:
1. Create a new group
2. Select a payout slot
3. Initiate payment
4. Complete payment with Paystack
5. Verify creator is added as member after payment
6. Check that group has 1 member (not 0 or 2)

## Migration Notes
- The separate migration files (`add_payments_table.sql`, `fix_payments_insert_policy.sql`) are now obsolete
- All necessary code is in the main `schema.sql` and `functions.sql`
- Payment-based membership is now the standard behavior
