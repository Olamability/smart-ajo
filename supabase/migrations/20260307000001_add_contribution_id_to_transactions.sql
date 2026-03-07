-- Add contribution_id column to transactions table
-- Links a transaction to the specific contribution it was made for

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS contribution_id UUID REFERENCES contributions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_contribution_id ON transactions(contribution_id);

COMMENT ON COLUMN transactions.contribution_id IS 'References the contribution record this transaction was made for, if applicable';
