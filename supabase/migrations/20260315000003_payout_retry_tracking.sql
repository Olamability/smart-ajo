-- Migration: Payout Retry Tracking
-- Date: 2026-03-15
-- Description:
--   Adds structured retry tracking to the payouts table so that the
--   payout-process edge function can:
--     1. Know how many times a payout has been attempted
--     2. Respect a configurable maximum retry limit
--     3. Record the reason for each failure
--     4. Permanently mark payouts that exceed the retry limit
--
--   This completes the payout failure recovery architecture:
--     pending → processing → (completed | failed)
--     failed  → pending (retry, up to max_retries)
--     failed  → failed  (terminal, when retry_count >= max_retries)

-- ============================================================================
-- 1. ADD RETRY COLUMNS TO PAYOUTS TABLE
-- ============================================================================

ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS retry_count    INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries    INTEGER     NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_retry_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- Index for efficient querying of payouts that are eligible for retry
CREATE INDEX IF NOT EXISTS idx_payouts_retry
  ON payouts(status, retry_count, max_retries)
  WHERE status IN ('pending', 'failed');

COMMENT ON COLUMN payouts.retry_count    IS 'Number of payout transfer attempts made so far';
COMMENT ON COLUMN payouts.max_retries    IS 'Maximum number of transfer attempts before permanently marking as failed';
COMMENT ON COLUMN payouts.last_retry_at  IS 'Timestamp of the most recent retry attempt';
COMMENT ON COLUMN payouts.failure_reason IS 'Human-readable reason for the most recent failure';

-- ============================================================================
-- 2. FUNCTION: increment_payout_retry
--    Atomically increments retry_count and records the failure reason.
--    Returns whether further retries are allowed (retry_count < max_retries).
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_payout_retry(
  p_payout_id      UUID,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_retry_count INTEGER;
  v_max_retries INTEGER;
  v_can_retry   BOOLEAN;
BEGIN
  UPDATE payouts
  SET    retry_count    = retry_count + 1,
         last_retry_at  = now(),
         failure_reason = COALESCE(p_failure_reason, failure_reason)
  WHERE  id             = p_payout_id
  RETURNING retry_count, max_retries
  INTO v_retry_count, v_max_retries;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Payout not found');
  END IF;

  v_can_retry := v_retry_count < v_max_retries;

  RETURN json_build_object(
    'success',      true,
    'retry_count',  v_retry_count,
    'max_retries',  v_max_retries,
    'can_retry',    v_can_retry
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. GRANT EXECUTE
-- ============================================================================

GRANT EXECUTE ON FUNCTION increment_payout_retry(UUID, TEXT) TO authenticated;
