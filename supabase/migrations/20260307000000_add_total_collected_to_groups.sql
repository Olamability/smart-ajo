-- Add total_collected field to groups table for tracking group balance
-- This field tracks the total amount of contributions collected from members across all cycles

ALTER TABLE groups ADD COLUMN IF NOT EXISTS total_collected DECIMAL(15, 2) DEFAULT 0.00 NOT NULL;

COMMENT ON COLUMN groups.total_collected IS 'Total amount of contributions collected from members across all cycles';

-- RPC function to atomically increment total_collected on a group
-- Used by the verify-contribution edge function to update group balance
CREATE OR REPLACE FUNCTION increment_group_total_collected(
  p_group_id UUID,
  p_amount DECIMAL
)
RETURNS VOID AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be a positive value, got %', p_amount;
  END IF;

  UPDATE groups
  SET total_collected = total_collected + p_amount
  WHERE id = p_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
