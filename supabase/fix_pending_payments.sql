/**
 * Fix Pending Payments Script
 * 
 * This script manually processes payments that are stuck in 'pending' status
 * even though they were successfully paid via Paystack.
 * 
 * USAGE:
 * 1. First, verify these payments are actually successful in Paystack dashboard
 * 2. Run this script to:
 *    - Update payment status to 'success'
 *    - Set verified to true
 *    - Execute business logic (activate membership)
 * 
 * WARNING: Only run this for payments that are confirmed successful in Paystack!
 */

-- Step 1: Check current state of pending GRP_CREATE payments
SELECT 
  id,
  reference,
  user_id,
  amount,
  status,
  verified,
  created_at,
  updated_at,
  metadata
FROM payments
WHERE reference LIKE 'GRP_CREATE%'
  AND status = 'pending'
  AND verified = false
ORDER BY created_at DESC;

-- Step 2: For each pending payment, check if the user is already a member
-- This query shows if the membership was partially created
SELECT 
  p.reference,
  p.status AS payment_status,
  p.verified AS payment_verified,
  p.metadata->>'group_id' AS group_id,
  p.metadata->>'user_id' AS user_id,
  gm.id AS member_record_id,
  gm.has_paid_security_deposit,
  gm.status AS member_status,
  gm.position
FROM payments p
LEFT JOIN group_members gm 
  ON gm.user_id = (p.metadata->>'user_id')::uuid 
  AND gm.group_id = (p.metadata->>'group_id')::uuid
WHERE p.reference LIKE 'GRP_CREATE%'
  AND p.status = 'pending'
  AND p.verified = false
ORDER BY p.created_at DESC;

-- Step 3: Manual fix for specific payment references
-- Replace 'GRP_CREATE_xxx' with the actual reference from the problem statement
-- DO NOT run this without verifying payment success in Paystack dashboard first!

/*
-- Example fix for payment GRP_CREATE_8b370128_ebde35a2
-- Uncomment and modify as needed:

BEGIN;

-- 1. Update payment status
UPDATE payments 
SET 
  status = 'success',
  verified = true,
  updated_at = NOW()
WHERE reference = 'GRP_CREATE_8b370128_ebde35a2';

-- 2. Get payment metadata
DO $$
DECLARE
  v_group_id UUID;
  v_user_id UUID;
  v_preferred_slot INTEGER;
  v_member_exists BOOLEAN;
BEGIN
  -- Get metadata from payment
  SELECT 
    (metadata->>'group_id')::UUID,
    (metadata->>'user_id')::UUID,
    COALESCE((metadata->>'preferred_slot')::INTEGER, 1)
  INTO v_group_id, v_user_id, v_preferred_slot
  FROM payments
  WHERE reference = 'GRP_CREATE_8b370128_ebde35a2';

  -- Check if member already exists
  SELECT EXISTS(
    SELECT 1 FROM group_members 
    WHERE group_id = v_group_id AND user_id = v_user_id
  ) INTO v_member_exists;

  IF NOT v_member_exists THEN
    -- Add member using the stored function
    PERFORM add_member_to_group(
      p_group_id := v_group_id,
      p_user_id := v_user_id,
      p_is_creator := true,
      p_preferred_slot := v_preferred_slot
    );
  END IF;

  -- Update member payment status
  UPDATE group_members
  SET 
    has_paid_security_deposit = true,
    security_deposit_paid_at = NOW(),
    status = 'active',
    updated_at = NOW()
  WHERE group_id = v_group_id 
    AND user_id = v_user_id;

  -- Create first contribution record
  INSERT INTO contributions (
    group_id,
    user_id,
    amount,
    cycle_number,
    status,
    due_date,
    paid_date,
    transaction_ref,
    created_at,
    updated_at
  )
  SELECT 
    v_group_id,
    v_user_id,
    g.contribution_amount,
    1,
    'paid',
    NOW(),
    NOW(),
    'GRP_CREATE_8b370128_ebde35a2',
    NOW(),
    NOW()
  FROM groups g
  WHERE g.id = v_group_id
  ON CONFLICT (group_id, user_id, cycle_number) DO UPDATE
  SET 
    status = 'paid',
    paid_date = NOW(),
    updated_at = NOW();

  -- Create transaction records
  INSERT INTO transactions (
    user_id,
    group_id,
    type,
    amount,
    status,
    reference,
    description,
    completed_at,
    created_at
  )
  SELECT 
    v_user_id,
    v_group_id,
    'security_deposit',
    g.security_deposit_amount,
    'completed',
    'GRP_CREATE_8b370128_ebde35a2_SD',
    'Security deposit for group creation',
    NOW(),
    NOW()
  FROM groups g
  WHERE g.id = v_group_id
  ON CONFLICT (reference) DO NOTHING;

  INSERT INTO transactions (
    user_id,
    group_id,
    type,
    amount,
    status,
    reference,
    description,
    completed_at,
    created_at
  )
  SELECT 
    v_user_id,
    v_group_id,
    'contribution',
    g.contribution_amount,
    'completed',
    'GRP_CREATE_8b370128_ebde35a2_C1',
    'First contribution payment',
    NOW(),
    NOW()
  FROM groups g
  WHERE g.id = v_group_id
  ON CONFLICT (reference) DO NOTHING;

  RAISE NOTICE 'Payment processed successfully for reference: GRP_CREATE_8b370128_ebde35a2';
END $$;

COMMIT;
*/

-- Step 4: Verify the fix
/*
SELECT 
  p.reference,
  p.status AS payment_status,
  p.verified AS payment_verified,
  gm.has_paid_security_deposit,
  gm.status AS member_status,
  gm.position,
  c.status AS contribution_status
FROM payments p
LEFT JOIN group_members gm 
  ON gm.user_id = (p.metadata->>'user_id')::uuid 
  AND gm.group_id = (p.metadata->>'group_id')::uuid
LEFT JOIN contributions c
  ON c.user_id = (p.metadata->>'user_id')::uuid 
  AND c.group_id = (p.metadata->>'group_id')::uuid
  AND c.cycle_number = 1
WHERE p.reference = 'GRP_CREATE_8b370128_ebde35a2';
*/
