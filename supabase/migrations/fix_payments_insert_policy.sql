-- ============================================================================
-- FIX PAYMENTS TABLE RLS INSERT POLICY
-- ============================================================================
-- This migration adds an INSERT policy to allow users to create pending
-- payment records when they initiate payments.
--
-- Issue: Users cannot insert into payments table due to missing RLS policy
-- Solution: Allow users to insert their own pending payment records
-- ============================================================================

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can insert their own pending payments" ON payments;

-- Policy: Users can insert their own pending payment records
-- Users can only insert payments for themselves with status 'pending'
CREATE POLICY "Users can insert their own pending payments"
  ON payments
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id 
    AND status = 'pending'
    AND verified = false
  );

-- Add comment for documentation
COMMENT ON POLICY "Users can insert their own pending payments" ON payments IS 
  'Allows authenticated users to create pending payment records for themselves. Only pending, unverified payments can be created by users. Backend (service role) handles verification and status updates.';
