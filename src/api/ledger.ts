/**
 * Ledger API Service
 *
 * Provides typed access to the double-entry ledger layer:
 *   - post_ledger_transaction  – create a balanced debit/credit pair atomically
 *   - get_account_balance      – compute balance from posted ledger entries
 *   - getUserLedgerAccount     – fetch the user_wallet account for a user
 *   - getGroupPoolAccount      – fetch (or create) the ajo_pool account for a group
 *   - getLedgerTransactions    – paginated ledger history for the current user
 *   - syncWalletFromLedger     – reconcile wallet balance against ledger
 */

import { createClient } from '../lib/client/supabase';
import type {
  Account,
  LedgerTransaction,
  LedgerEntry,
  LedgerEntryInput,
} from '../types';

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the user_wallet Account row for the given user (defaults to current
 * authenticated user when userId is omitted).
 */
export async function getUserLedgerAccount(
  userId?: string
): Promise<Account | null> {
  const supabase = createClient();

  let uid = userId;
  if (!uid) {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Not authenticated');
    uid = user.id;
  }

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', uid)
    .eq('type', 'user_wallet')
    .single();

  if (error) {
    console.error('Error fetching ledger account:', error);
    return null;
  }

  return mapAccount(data);
}

/**
 * Fetch (or create) the ajo_pool Account for a group.
 * Delegates creation to the get_or_create_group_pool_account RPC.
 */
export async function getGroupPoolAccount(
  groupId: string
): Promise<string | null> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc(
    'get_or_create_group_pool_account',
    { p_group_id: groupId }
  );

  if (error) {
    console.error('Error fetching group pool account:', error);
    return null;
  }

  return data as string;
}

/**
 * Compute the ledger balance for an account from posted entries.
 */
export async function getAccountBalance(
  accountId: string
): Promise<number> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc('get_account_balance', {
    p_account_id: accountId,
  });

  if (error) {
    console.error('Error fetching account balance:', error);
    throw error;
  }

  return Number(data ?? 0);
}

/**
 * Paginated list of LedgerTransaction rows that touch the current user's
 * wallet account (joined through ledger_entries → accounts).
 */
export async function getLedgerTransactions(
  limit = 50,
  offset = 0
): Promise<LedgerTransaction[]> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) throw new Error('Not authenticated');

  // Fetch the user's account id
  const account = await getUserLedgerAccount(user.id);
  if (!account) return [];

  // Fetch ledger_transactions that have entries for this account
  const { data, error } = await supabase
    .from('ledger_transactions')
    .select(
      `
      *,
      ledger_entries!inner (
        account_id
      )
    `
    )
    .eq('ledger_entries.account_id', account.id)
    .eq('status', 'posted')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('Error fetching ledger transactions:', error);
    throw error;
  }

  return (data ?? []).map(mapLedgerTransaction);
}

/**
 * Fetch the individual LedgerEntry rows for a ledger transaction.
 */
export async function getLedgerEntries(
  ledgerTransactionId: string
): Promise<LedgerEntry[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('ledger_transaction_id', ledgerTransactionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching ledger entries:', error);
    throw error;
  }

  return (data ?? []).map(mapLedgerEntry);
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Atomically post a balanced ledger transaction.
 *
 * The entries array MUST have equal sums of debits and credits.
 * Returns the created ledger_transaction_id on success.
 */
export async function postLedgerTransaction(params: {
  description: string;
  entries: LedgerEntryInput[];
  transactionId?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; ledgerTransactionId?: string; error?: string }> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase.rpc('post_ledger_transaction', {
    p_description: params.description,
    p_entries: params.entries,
    p_transaction_id: params.transactionId ?? null,
    p_created_by: user.id,
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    console.error('Error posting ledger transaction:', error);
    return { success: false, error: error.message };
  }

  const result = data as { success: boolean; ledger_transaction_id?: string; error?: string };
  return {
    success: result.success,
    ledgerTransactionId: result.ledger_transaction_id,
    error: result.error,
  };
}

/**
 * Reconcile a wallet's balance against the ledger.
 * Should only be called by admins during audits or after data repairs.
 */
export async function syncWalletFromLedger(
  walletId: string
): Promise<{ success: boolean; ledgerBalance?: number; error?: string }> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc('sync_wallet_balance_from_ledger', {
    p_wallet_id: walletId,
  });

  if (error) {
    console.error('Error syncing wallet from ledger:', error);
    return { success: false, error: error.message };
  }

  const result = data as { success: boolean; ledger_balance?: number; error?: string };
  return {
    success: result.success,
    ledgerBalance: result.ledger_balance,
    error: result.error,
  };
}

// ---------------------------------------------------------------------------
// Field-name mappers (snake_case DB → camelCase TS)
// ---------------------------------------------------------------------------

function mapAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as Account['type'],
    userId: row.user_id as string | undefined,
    walletId: row.wallet_id as string | undefined,
    groupId: row.group_id as string | undefined,
    isSystem: row.is_system as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapLedgerTransaction(row: Record<string, unknown>): LedgerTransaction {
  return {
    id: row.id as string,
    transactionId: row.transaction_id as string | undefined,
    description: row.description as string,
    status: row.status as LedgerTransaction['status'],
    createdBy: row.created_by as string | undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    postedAt: row.posted_at as string | undefined,
  };
}

function mapLedgerEntry(row: Record<string, unknown>): LedgerEntry {
  return {
    id: row.id as string,
    ledgerTransactionId: row.ledger_transaction_id as string,
    accountId: row.account_id as string,
    entryType: row.entry_type as LedgerEntry['entryType'],
    amount: Number(row.amount),
    currency: row.currency as string,
    createdAt: row.created_at as string,
  };
}
