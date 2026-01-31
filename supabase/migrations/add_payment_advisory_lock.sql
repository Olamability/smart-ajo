-- ============================================================================
-- PAYMENT ADVISORY LOCK FUNCTION
-- ============================================================================
-- This migration adds a PostgreSQL advisory lock function to prevent race
-- conditions when processing payments concurrently from verify-payment and
-- paystack-webhook Edge Functions.
--
-- WHY THIS IS NEEDED:
-- When a user completes payment, two things happen nearly simultaneously:
-- 1. Frontend calls verify-payment Edge Function (synchronous)
-- 2. Paystack sends webhook notification (asynchronous)
--
-- Both functions try to process the same payment and add the user to the group.
-- Without a lock, this can cause:
-- - Inconsistent slot assignments
-- - Race conditions in member addition
-- - Database constraint violations
--
-- SOLUTION:
-- PostgreSQL advisory locks are lightweight, session-based locks that:
-- - Don't require table modifications
-- - Are automatically released when transaction ends
-- - Are fast (no disk I/O)
-- - Perfect for preventing concurrent processing
--
-- USAGE:
-- SELECT acquire_payment_lock('payment_reference');
-- Returns: true if lock acquired, false if another process has it
-- ============================================================================

-- Create function to acquire advisory lock for payment processing
CREATE OR REPLACE FUNCTION acquire_payment_lock(payment_ref TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  lock_id BIGINT;
  lock_acquired BOOLEAN;
BEGIN
  -- Generate consistent lock ID from payment reference using hashtext
  -- hashtext() produces same hash for same input, ensuring all processes
  -- trying to lock the same payment reference use the same lock ID
  lock_id := hashtext(payment_ref);
  
  -- Try to acquire advisory lock (non-blocking)
  -- pg_try_advisory_xact_lock returns immediately:
  -- - true: lock acquired, you can process payment
  -- - false: another process has lock, don't process
  -- 
  -- _xact variant: Lock automatically released at transaction end
  lock_acquired := pg_try_advisory_xact_lock(lock_id);
  
  -- Log lock status
  RAISE NOTICE 'Payment lock for "%" (ID: %): %', 
    payment_ref, 
    lock_id, 
    CASE WHEN lock_acquired THEN 'ACQUIRED' ELSE 'BUSY' END;
  
  RETURN lock_acquired;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION acquire_payment_lock(TEXT) TO authenticated, service_role;

-- Add comment for documentation
COMMENT ON FUNCTION acquire_payment_lock(TEXT) IS 
'Acquires an advisory lock for payment processing to prevent race conditions. '
'Returns true if lock acquired, false if payment is already being processed by another request. '
'Lock is automatically released when transaction ends.';

-- ============================================================================
-- TESTING THE LOCK FUNCTION
-- ============================================================================
-- To test the lock function, run these queries in separate transactions:
--
-- Session 1:
-- BEGIN;
-- SELECT acquire_payment_lock('TEST_PAYMENT_123'); -- Returns: true
-- -- Transaction keeps lock until COMMIT or ROLLBACK
-- SELECT pg_sleep(10); -- Hold lock for 10 seconds
-- COMMIT;
--
-- Session 2 (run while Session 1 is still holding lock):
-- SELECT acquire_payment_lock('TEST_PAYMENT_123'); -- Returns: false
--
-- Session 2 (run after Session 1 commits):
-- SELECT acquire_payment_lock('TEST_PAYMENT_123'); -- Returns: true
-- ============================================================================
