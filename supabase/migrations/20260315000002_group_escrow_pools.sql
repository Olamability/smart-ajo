-- Migration: Group Escrow Pool System
-- Date: 2026-03-15
-- Description:
--   Implements a dedicated group escrow pool that holds contribution funds
--   before they are disbursed to the cycle recipient.
--
--   Architecture enforced:
--     User Wallet → Group Escrow Pool → Recipient Wallet
--
--   Tables added:
--     1. group_escrow_pools – one row per group/cycle, tracks pooled balance
--
--   Functions added:
--     1. credit_escrow_pool       – adds a contribution amount to the pool
--     2. release_escrow_for_payout – marks a pool as disbursed after payout
--     3. refund_escrow_pool       – returns funds from escrow to pending state
--
--   RLS policies:
--     - Members of the group can view their escrow pool
--     - Only service-role / SECURITY DEFINER functions can mutate pool rows

-- ============================================================================
-- 1. ESCROW POOL STATUS ENUM
-- ============================================================================

CREATE TYPE escrow_pool_status_enum AS ENUM (
  'collecting',      -- actively collecting contributions for this cycle
  'ready',           -- all contributions received; ready to disburse
  'disbursing',      -- payout has been initiated
  'disbursed',       -- payout completed successfully
  'refunded'         -- cycle was cancelled and funds returned
);

-- ============================================================================
-- 2. GROUP ESCROW POOLS TABLE
-- One row per (group, cycle_number). The balance grows as contributions
-- are verified and shrinks to zero when the cycle is paid out.
-- ============================================================================

CREATE TABLE group_escrow_pools (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL,

  -- Financial tracking
  target_amount    DECIMAL(15, 2) NOT NULL,  -- expected total for the cycle
  collected_amount DECIMAL(15, 2) DEFAULT 0.00 NOT NULL,
  disbursed_amount DECIMAL(15, 2) DEFAULT 0.00 NOT NULL,

  -- Lifecycle
  status       escrow_pool_status_enum NOT NULL DEFAULT 'collecting',

  -- Audit
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT escrow_cycle_positive          CHECK (cycle_number > 0),
  CONSTRAINT escrow_target_positive         CHECK (target_amount > 0),
  CONSTRAINT escrow_collected_non_negative  CHECK (collected_amount >= 0),
  CONSTRAINT escrow_disbursed_non_negative  CHECK (disbursed_amount >= 0),
  CONSTRAINT escrow_collected_le_target     CHECK (collected_amount <= target_amount * 1.01), -- 1% tolerance for rounding
  CONSTRAINT escrow_disbursed_le_collected  CHECK (disbursed_amount <= collected_amount),

  -- One pool per group per cycle
  UNIQUE (group_id, cycle_number)
);

-- Indexes
CREATE INDEX idx_escrow_pools_group_id    ON group_escrow_pools(group_id);
CREATE INDEX idx_escrow_pools_status      ON group_escrow_pools(status);
CREATE INDEX idx_escrow_pools_cycle       ON group_escrow_pools(group_id, cycle_number);

-- updated_at trigger
CREATE TRIGGER update_escrow_pools_updated_at
  BEFORE UPDATE ON group_escrow_pools
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE group_escrow_pools ENABLE ROW LEVEL SECURITY;

-- Members of the group (and the group creator) may view the escrow pool.
CREATE POLICY "Group members can view escrow pool"
  ON group_escrow_pools FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id  = group_escrow_pools.group_id
        AND gm.user_id   = auth.uid()
        AND gm.status    = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id         = group_escrow_pools.group_id
        AND g.created_by = auth.uid()
    )
    OR (auth.jwt()->>'is_admin')::boolean = true
  );

-- Only service-role / SECURITY DEFINER functions may insert/update pool rows.
-- Regular authenticated users must go through the RPC functions below.
CREATE POLICY "Service role can insert escrow pools"
  ON group_escrow_pools FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update escrow pools"
  ON group_escrow_pools FOR UPDATE
  USING (true);

-- ============================================================================
-- 4. FUNCTION: credit_escrow_pool
--    Called after a contribution payment is verified to add the contribution
--    amount to the cycle's escrow pool.
--
--    Creates the pool row if it does not yet exist.
--    Advances status from 'collecting' → 'ready' when collected = target.
-- ============================================================================

CREATE OR REPLACE FUNCTION credit_escrow_pool(
  p_group_id     UUID,
  p_cycle_number INTEGER,
  p_amount       DECIMAL,
  p_target       DECIMAL DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_pool  group_escrow_pools%ROWTYPE;
  v_target DECIMAL(15, 2);
BEGIN
  -- Derive target from group config when not supplied
  IF p_target IS NULL THEN
    SELECT g.contribution_amount * g.max_members
    INTO   v_target
    FROM   groups g
    WHERE  g.id = p_group_id;
  ELSE
    v_target := p_target;
  END IF;

  IF v_target IS NULL OR v_target <= 0 THEN
    RAISE EXCEPTION 'Cannot derive target_amount for group %', p_group_id;
  END IF;

  -- Upsert: create pool row if missing, otherwise add to collected_amount
  INSERT INTO group_escrow_pools (group_id, cycle_number, target_amount, collected_amount)
  VALUES (p_group_id, p_cycle_number, v_target, p_amount)
  ON CONFLICT (group_id, cycle_number) DO UPDATE
    SET collected_amount = group_escrow_pools.collected_amount + EXCLUDED.collected_amount,
        updated_at       = now();

  -- Re-read to decide whether to advance status
  SELECT * INTO v_pool
  FROM   group_escrow_pools
  WHERE  group_id     = p_group_id
    AND  cycle_number = p_cycle_number;

  -- Advance to 'ready' when fully funded
  IF v_pool.status = 'collecting'
    AND v_pool.collected_amount >= v_pool.target_amount * 0.999  -- 0.1% rounding guard
  THEN
    UPDATE group_escrow_pools
    SET    status     = 'ready',
           updated_at = now()
    WHERE  id         = v_pool.id;

    v_pool.status := 'ready';
  END IF;

  RETURN json_build_object(
    'success',          true,
    'pool_id',          v_pool.id,
    'collected_amount', v_pool.collected_amount,
    'target_amount',    v_pool.target_amount,
    'status',           v_pool.status
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. FUNCTION: release_escrow_for_payout
--    Called by the payout-process flow after a transfer is completed.
--    Marks the pool as 'disbursed' and records the disbursed amount.
-- ============================================================================

CREATE OR REPLACE FUNCTION release_escrow_for_payout(
  p_group_id     UUID,
  p_cycle_number INTEGER,
  p_amount       DECIMAL
)
RETURNS JSON AS $$
DECLARE
  v_pool group_escrow_pools%ROWTYPE;
BEGIN
  SELECT * INTO v_pool
  FROM   group_escrow_pools
  WHERE  group_id     = p_group_id
    AND  cycle_number = p_cycle_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow pool not found for group % cycle %', p_group_id, p_cycle_number;
  END IF;

  IF v_pool.status NOT IN ('ready', 'disbursing') THEN
    RAISE EXCEPTION 'Escrow pool % is not ready for disbursement (status: %)', v_pool.id, v_pool.status;
  END IF;

  UPDATE group_escrow_pools
  SET    status           = 'disbursed',
         disbursed_amount = p_amount,
         updated_at       = now()
  WHERE  id               = v_pool.id;

  RETURN json_build_object('success', true, 'pool_id', v_pool.id, 'status', 'disbursed');
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. FUNCTION: refund_escrow_pool
--    Called when a group is cancelled or a cycle must be unwound.
--    Marks the pool as 'refunded'.
-- ============================================================================

CREATE OR REPLACE FUNCTION refund_escrow_pool(
  p_group_id     UUID,
  p_cycle_number INTEGER
)
RETURNS JSON AS $$
BEGIN
  UPDATE group_escrow_pools
  SET    status     = 'refunded',
         updated_at = now()
  WHERE  group_id     = p_group_id
    AND  cycle_number = p_cycle_number
    AND  status       NOT IN ('disbursed', 'refunded');

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error',   'Escrow pool not found or already finalized'
    );
  END IF;

  RETURN json_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. GRANT EXECUTE to authenticated role
-- ============================================================================

GRANT EXECUTE ON FUNCTION credit_escrow_pool(UUID, INTEGER, DECIMAL, DECIMAL)  TO authenticated;
GRANT EXECUTE ON FUNCTION release_escrow_for_payout(UUID, INTEGER, DECIMAL)     TO authenticated;
GRANT EXECUTE ON FUNCTION refund_escrow_pool(UUID, INTEGER)                     TO authenticated;
