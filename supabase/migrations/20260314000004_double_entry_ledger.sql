-- Migration: Double-Entry Ledger System
-- Date: 2026-03-14
-- Description:
--   Implements a proper double-entry accounting ledger for Smart Ajo.
--   Every financial movement is recorded as a pair of balanced entries
--   (at least one debit and one credit), ensuring full auditability and
--   mathematical integrity across all wallet operations.
--
--   Tables added:
--     1. accounts         – named accounts (user wallets, pools, fees, gateway)
--     2. ledger_transactions – groups related debit/credit entries
--     3. ledger_entries   – individual debit or credit against one account
--
--   Rules enforced:
--     • Each ledger_transaction must have SUM(debits) = SUM(credits)
--     • Wallet balances are kept in sync via a trigger on ledger_entries
--     • No direct balance mutations bypass the ledger layer

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

-- Account types for the chart of accounts
CREATE TYPE account_type_enum AS ENUM (
  'user_wallet',     -- per-user spendable wallet
  'ajo_pool',        -- per-group pooled contributions
  'platform_fees',   -- platform revenue account
  'penalty_pool',    -- collected penalty funds
  'paystack_gateway' -- external Paystack settlement account
);

-- Ledger entry direction
CREATE TYPE ledger_entry_type_enum AS ENUM ('debit', 'credit');

-- Ledger transaction status
CREATE TYPE ledger_tx_status_enum AS ENUM ('pending', 'posted', 'voided');

-- ============================================================================
-- 2. ACCOUNTS TABLE
-- Named accounts forming the chart of accounts.
-- System accounts (is_system = true) have no user_id.
-- Each user gets one user_wallet account (linked to their wallets row).
-- Each group gets one ajo_pool account.
-- ============================================================================

CREATE TABLE accounts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  type         account_type_enum NOT NULL,

  -- Optional links to application entities
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  wallet_id    UUID REFERENCES wallets(id) ON DELETE SET NULL,
  group_id     UUID REFERENCES groups(id) ON DELETE CASCADE,

  is_system    BOOLEAN NOT NULL DEFAULT false,

  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),

  -- A user may have exactly one user_wallet account
  CONSTRAINT one_wallet_account_per_user
    UNIQUE (user_id, type),

  -- A group may have exactly one ajo_pool account
  CONSTRAINT one_pool_per_group
    UNIQUE (group_id, type),

  -- System accounts must not be linked to a user
  CONSTRAINT system_accounts_have_no_user
    CHECK (is_system = false OR user_id IS NULL),

  -- user_wallet accounts must have a user_id
  CONSTRAINT user_wallet_requires_user
    CHECK (type != 'user_wallet' OR user_id IS NOT NULL),

  -- ajo_pool accounts must have a group_id
  CONSTRAINT pool_requires_group
    CHECK (type != 'ajo_pool' OR group_id IS NOT NULL)
);

CREATE INDEX idx_accounts_user_id  ON accounts(user_id);
CREATE INDEX idx_accounts_group_id ON accounts(group_id);
CREATE INDEX idx_accounts_type     ON accounts(type);

-- ============================================================================
-- 3. LEDGER_TRANSACTIONS TABLE
-- A ledger transaction groups one or more debit/credit entry pairs.
-- Debits must equal credits (enforced by trigger on status → 'posted').
-- ============================================================================

CREATE TABLE ledger_transactions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Optional back-link to the high-level transactions table
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,

  description    TEXT NOT NULL,
  status         ledger_tx_status_enum NOT NULL DEFAULT 'pending',

  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at     TIMESTAMPTZ DEFAULT now(),
  posted_at      TIMESTAMPTZ
);

CREATE INDEX idx_ledger_transactions_transaction_id ON ledger_transactions(transaction_id);
CREATE INDEX idx_ledger_transactions_status         ON ledger_transactions(status);
CREATE INDEX idx_ledger_transactions_created_at     ON ledger_transactions(created_at DESC);

-- ============================================================================
-- 4. LEDGER_ENTRIES TABLE
-- Each row is one side of a double-entry pair:
--   debit  = value flowing OUT of an account
--   credit = value flowing INTO an account
-- ============================================================================

CREATE TABLE ledger_entries (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ledger_transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,

  entry_type            ledger_entry_type_enum NOT NULL,
  amount                DECIMAL(15, 2) NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'NGN',

  created_at            TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT ledger_entry_amount_positive CHECK (amount > 0)
);

CREATE INDEX idx_ledger_entries_transaction ON ledger_entries(ledger_transaction_id);
CREATE INDEX idx_ledger_entries_account     ON ledger_entries(account_id);
CREATE INDEX idx_ledger_entries_type        ON ledger_entries(entry_type);

-- ============================================================================
-- 5. TRIGGER: Keep updated_at current on accounts
-- ============================================================================

CREATE TRIGGER update_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. FUNCTION & TRIGGER: Validate balanced entries when posting
-- Fires BEFORE UPDATE on ledger_transactions.
-- Raises an exception if the transaction is being posted and its entries
-- are not balanced (sum of debits ≠ sum of credits).
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_ledger_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_debit_sum  DECIMAL(15, 2);
  v_credit_sum DECIMAL(15, 2);
BEGIN
  -- Only enforce balance when transitioning to 'posted'
  IF NEW.status = 'posted' AND OLD.status != 'posted' THEN

    SELECT COALESCE(SUM(amount), 0)
    INTO v_debit_sum
    FROM ledger_entries
    WHERE ledger_transaction_id = NEW.id
      AND entry_type = 'debit';

    SELECT COALESCE(SUM(amount), 0)
    INTO v_credit_sum
    FROM ledger_entries
    WHERE ledger_transaction_id = NEW.id
      AND entry_type = 'credit';

    IF v_debit_sum = 0 OR v_credit_sum = 0 THEN
      RAISE EXCEPTION
        'Ledger transaction % must have at least one debit and one credit entry',
        NEW.id;
    END IF;

    IF v_debit_sum != v_credit_sum THEN
      RAISE EXCEPTION
        'Ledger transaction % is not balanced: debits=% credits=%',
        NEW.id, v_debit_sum, v_credit_sum;
    END IF;

    -- Stamp the posting time
    NEW.posted_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_ledger_balance
  BEFORE UPDATE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION validate_ledger_balance();

-- ============================================================================
-- 7. FUNCTION & TRIGGER: Sync wallet balance from ledger entries
-- Fires AFTER INSERT on ledger_entries.
-- When a user_wallet account receives a credit, the linked wallet balance
-- increases; a debit decreases it.  Only fires once the parent ledger
-- transaction has been posted.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_wallet_balance_on_ledger_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_account_type  account_type_enum;
  v_wallet_id     UUID;
  v_lt_status     ledger_tx_status_enum;
BEGIN
  -- Only act on user_wallet accounts
  SELECT a.type, a.wallet_id
  INTO v_account_type, v_wallet_id
  FROM accounts a
  WHERE a.id = NEW.account_id;

  IF v_account_type != 'user_wallet' OR v_wallet_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only apply when the parent transaction is already posted
  SELECT status INTO v_lt_status
  FROM ledger_transactions
  WHERE id = NEW.ledger_transaction_id;

  IF v_lt_status != 'posted' THEN
    RETURN NEW;
  END IF;

  -- Apply the balance delta
  IF NEW.entry_type = 'credit' THEN
    UPDATE wallets
    SET balance = balance + NEW.amount,
        updated_at = now()
    WHERE id = v_wallet_id;
  ELSIF NEW.entry_type = 'debit' THEN
    UPDATE wallets
    SET balance = balance - NEW.amount,
        updated_at = now()
    WHERE id = v_wallet_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER sync_wallet_on_ledger_entry
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION sync_wallet_balance_on_ledger_entry();

-- ============================================================================
-- 8. FUNCTION & TRIGGER: Sync wallet balance when a ledger_transaction
--    transitions from pending → posted (entries inserted before posting)
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_wallet_balance_on_post()
RETURNS TRIGGER AS $$
DECLARE
  v_entry RECORD;
BEGIN
  -- Only fire when status transitions to 'posted'
  IF NEW.status = 'posted' AND OLD.status != 'posted' THEN
    FOR v_entry IN
      SELECT le.entry_type, le.amount, a.wallet_id
      FROM ledger_entries le
      JOIN accounts a ON a.id = le.account_id
      WHERE le.ledger_transaction_id = NEW.id
        AND a.type = 'user_wallet'
        AND a.wallet_id IS NOT NULL
    LOOP
      IF v_entry.entry_type = 'credit' THEN
        UPDATE wallets
        SET balance = balance + v_entry.amount,
            updated_at = now()
        WHERE id = v_entry.wallet_id;
      ELSIF v_entry.entry_type = 'debit' THEN
        UPDATE wallets
        SET balance = balance - v_entry.amount,
            updated_at = now()
        WHERE id = v_entry.wallet_id;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER sync_wallet_on_post
  AFTER UPDATE OF status ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION sync_wallet_balance_on_post();

-- ============================================================================
-- 9. RPC: post_ledger_transaction
-- Atomically creates a ledger_transaction + its entries and marks it posted.
-- Raises an exception if entries are not balanced.
--
-- p_entries is a JSONB array of objects:
--   { "account_id": "uuid", "entry_type": "debit"|"credit", "amount": 100.00 }
-- ============================================================================

CREATE OR REPLACE FUNCTION post_ledger_transaction(
  p_description    TEXT,
  p_entries        JSONB,
  p_transaction_id UUID    DEFAULT NULL,
  p_created_by     UUID    DEFAULT NULL,
  p_metadata       JSONB   DEFAULT '{}'::jsonb
)
RETURNS JSON AS $$
DECLARE
  v_lt_id       UUID;
  v_entry       JSONB;
  v_debit_sum   DECIMAL(15, 2) := 0;
  v_credit_sum  DECIMAL(15, 2) := 0;
  v_amount      DECIMAL(15, 2);
  v_entry_type  TEXT;
  v_account_id  UUID;
BEGIN
  -- Validate at least two entries
  IF jsonb_array_length(p_entries) < 2 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'A ledger transaction requires at least one debit and one credit entry'
    );
  END IF;

  -- Pre-validate balance before touching the DB
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    v_entry_type := v_entry->>'entry_type';
    v_amount     := (v_entry->>'amount')::DECIMAL(15, 2);

    IF v_entry_type = 'debit' THEN
      v_debit_sum  := v_debit_sum  + v_amount;
    ELSIF v_entry_type = 'credit' THEN
      v_credit_sum := v_credit_sum + v_amount;
    ELSE
      RETURN json_build_object(
        'success', false,
        'error', 'entry_type must be ''debit'' or ''credit'''
      );
    END IF;
  END LOOP;

  IF v_debit_sum != v_credit_sum THEN
    RETURN json_build_object(
      'success', false,
      'error', format(
        'Entries are not balanced: debits=%s credits=%s',
        v_debit_sum, v_credit_sum
      )
    );
  END IF;

  -- Create the ledger transaction in pending state
  INSERT INTO ledger_transactions (
    transaction_id, description, status, created_by, metadata
  ) VALUES (
    p_transaction_id, p_description, 'pending', p_created_by, p_metadata
  )
  RETURNING id INTO v_lt_id;

  -- Insert all entries
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    v_account_id := (v_entry->>'account_id')::UUID;
    v_entry_type := v_entry->>'entry_type';
    v_amount     := (v_entry->>'amount')::DECIMAL(15, 2);

    INSERT INTO ledger_entries (
      ledger_transaction_id, account_id, entry_type, amount,
      currency
    ) VALUES (
      v_lt_id,
      v_account_id,
      v_entry_type::ledger_entry_type_enum,
      v_amount,
      COALESCE(v_entry->>'currency', 'NGN')
    );
  END LOOP;

  -- Post the transaction (triggers balance validation + wallet sync)
  UPDATE ledger_transactions
  SET status = 'posted'
  WHERE id = v_lt_id;

  RETURN json_build_object(
    'success', true,
    'ledger_transaction_id', v_lt_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 10. RPC: get_account_balance
-- Returns the current balance of an account derived from posted ledger entries.
-- Credits increase balance; debits decrease balance.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_account_balance(p_account_id UUID)
RETURNS DECIMAL(15, 2) AS $$
DECLARE
  v_balance DECIMAL(15, 2);
BEGIN
  SELECT
    COALESCE(SUM(
      CASE WHEN le.entry_type = 'credit' THEN  le.amount
           WHEN le.entry_type = 'debit'  THEN -le.amount
      END
    ), 0)
  INTO v_balance
  FROM ledger_entries le
  JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
  WHERE le.account_id = p_account_id
    AND lt.status = 'posted';

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- 11. RPC: sync_wallet_balance_from_ledger
-- Recalculates a wallet's balance from the ledger and updates the wallets row.
-- Use this to reconcile discrepancies.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_wallet_balance_from_ledger(p_wallet_id UUID)
RETURNS JSON AS $$
DECLARE
  v_account_id UUID;
  v_ledger_balance DECIMAL(15, 2);
BEGIN
  -- Find the accounts row for this wallet
  SELECT id INTO v_account_id
  FROM accounts
  WHERE wallet_id = p_wallet_id AND type = 'user_wallet'
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No user_wallet account found for this wallet'
    );
  END IF;

  v_ledger_balance := get_account_balance(v_account_id);

  UPDATE wallets
  SET balance    = v_ledger_balance,
      updated_at = now()
  WHERE id = p_wallet_id;

  RETURN json_build_object(
    'success', true,
    'wallet_id', p_wallet_id,
    'ledger_balance', v_ledger_balance
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 12. RPC: get_or_create_group_pool_account
-- Returns the ajo_pool account for a group, creating it if absent.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_or_create_group_pool_account(p_group_id UUID)
RETURNS UUID AS $$
DECLARE
  v_account_id UUID;
  v_group_name TEXT;
BEGIN
  -- Try existing account first
  SELECT id INTO v_account_id
  FROM accounts
  WHERE group_id = p_group_id AND type = 'ajo_pool'
  LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    RETURN v_account_id;
  END IF;

  -- Create a new pool account for this group
  SELECT name INTO v_group_name FROM groups WHERE id = p_group_id;

  INSERT INTO accounts (name, type, group_id, is_system)
  VALUES (
    COALESCE(v_group_name, 'Group') || ' Pool',
    'ajo_pool',
    p_group_id,
    false
  )
  RETURNING id INTO v_account_id;

  RETURN v_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 13. FUNCTION & TRIGGER: Auto-create user_wallet account on user sign-up
-- Fires after a new row is inserted into the wallets table (which is itself
-- created by the existing create_wallet_for_new_user trigger).
-- ============================================================================

CREATE OR REPLACE FUNCTION create_ledger_account_for_wallet()
RETURNS TRIGGER AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  -- Get user name for a human-readable account name
  SELECT full_name INTO v_full_name
  FROM users WHERE id = NEW.user_id;

  INSERT INTO accounts (name, type, user_id, wallet_id, is_system)
  VALUES (
    COALESCE(v_full_name, 'User') || ' Wallet',
    'user_wallet',
    NEW.user_id,
    NEW.id,
    false
  )
  ON CONFLICT (user_id, type) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_account_on_wallet_creation
  AFTER INSERT ON wallets
  FOR EACH ROW EXECUTE FUNCTION create_ledger_account_for_wallet();

-- ============================================================================
-- 14. SEED: System accounts
-- One-time insert of the platform-level accounts.
-- ============================================================================

INSERT INTO accounts (name, type, is_system) VALUES
  ('Paystack Gateway',    'paystack_gateway', true),
  ('Platform Fees',       'platform_fees',    true),
  ('Penalty Pool',        'penalty_pool',     true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 15. BACK-FILL: Create user_wallet accounts for existing wallets
-- ============================================================================

INSERT INTO accounts (name, type, user_id, wallet_id, is_system)
SELECT
  COALESCE(u.full_name, 'User') || ' Wallet',
  'user_wallet',
  w.user_id,
  w.id,
  false
FROM wallets w
JOIN users u ON u.id = w.user_id
ON CONFLICT (user_id, type) DO NOTHING;

-- ============================================================================
-- 16. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries     ENABLE ROW LEVEL SECURITY;

-- accounts: users see their own wallet account and system accounts;
-- admins see everything.  A single policy covers both cases.
CREATE POLICY "Users and admins can view accounts"
  ON accounts FOR SELECT
  USING (
    auth.uid() = user_id OR
    is_system = true OR
    (auth.jwt()->>'is_admin')::boolean = true
  );

-- Write access is intentionally restricted to the service role.
-- All mutations go through SECURITY DEFINER RPC functions which bypass
-- RLS entirely, so authenticated clients cannot write directly.
CREATE POLICY "Service role can manage accounts"
  ON accounts FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ledger_transactions: users see transactions touching their accounts;
-- admins see all.
CREATE POLICY "Users and admins can view ledger transactions"
  ON ledger_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM ledger_entries le
      JOIN accounts a ON a.id = le.account_id
      WHERE le.ledger_transaction_id = ledger_transactions.id
        AND a.user_id = auth.uid()
    ) OR
    (auth.jwt()->>'is_admin')::boolean = true
  );

CREATE POLICY "Service role can manage ledger transactions"
  ON ledger_transactions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ledger_entries: users see entries on their accounts; admins see all.
CREATE POLICY "Users and admins can view ledger entries"
  ON ledger_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM accounts a
      WHERE a.id = ledger_entries.account_id
        AND a.user_id = auth.uid()
    ) OR
    (auth.jwt()->>'is_admin')::boolean = true
  );

CREATE POLICY "Service role can manage ledger entries"
  ON ledger_entries FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 17. GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION post_ledger_transaction(TEXT, JSONB, UUID, UUID, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION get_account_balance(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION sync_wallet_balance_from_ledger(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_group_pool_account(UUID)
  TO authenticated;
