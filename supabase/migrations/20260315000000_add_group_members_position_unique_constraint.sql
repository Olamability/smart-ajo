-- Migration: Add explicit UNIQUE constraint on (group_id, position) in group_members
--
-- Slot Allocation Protection (Section 3)
-- Prevents two members from being assigned the same payout slot within a group.
--
-- The schema previously relied on a standalone UNIQUE INDEX
-- (idx_group_members_position_unique).  This migration promotes that index into
-- a named table-level UNIQUE CONSTRAINT so that the protection is:
--   1. Semantically explicit and discoverable via information_schema / pg_constraint
--   2. Enforced at the constraint level (not only the index level)
--
-- If the unique index does not yet exist on this database (fresh deploy running
-- only migrations), we fall back to creating the constraint directly.

DO $$
BEGIN
  -- Check whether the standalone unique index exists (legacy schema path)
  IF EXISTS (
    SELECT 1
    FROM   pg_indexes
    WHERE  tablename  = 'group_members'
    AND    indexname  = 'idx_group_members_position_unique'
  ) THEN
    -- Promote the existing unique index into a named constraint
    ALTER TABLE group_members
      ADD CONSTRAINT unique_group_member_position
      UNIQUE USING INDEX idx_group_members_position_unique;

  ELSIF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conrelid = 'group_members'::regclass
    AND    conname  = 'unique_group_member_position'
  ) THEN
    -- Fresh database: add the constraint directly
    ALTER TABLE group_members
      ADD CONSTRAINT unique_group_member_position
      UNIQUE (group_id, position);
  END IF;
END;
$$;
