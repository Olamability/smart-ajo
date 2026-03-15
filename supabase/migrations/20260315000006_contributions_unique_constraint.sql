-- Migration: Add unique constraint on contributions (group_id, user_id, cycle_number)
-- This prevents duplicate contribution records for the same member and cycle.

ALTER TABLE contributions
  ADD CONSTRAINT unique_contribution_per_cycle
  UNIQUE (group_id, user_id, cycle_number);
