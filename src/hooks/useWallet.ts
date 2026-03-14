/**
 * useWallet Hook
 *
 * Fetches the current user's wallet (balance, locked balance) via React
 * Query and subscribes to real-time Supabase updates so the UI reflects
 * balance changes immediately after a contribution or payout.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getUserWallet, getWalletTransactions } from '@/api/wallets';
import { logApiError } from '@/api/audit';
import { createClient } from '@/lib/client/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Wallet, WalletTransaction } from '@/api/wallets';

export const WALLET_QUERY_KEY = ['wallet'] as const;
export const WALLET_TXN_QUERY_KEY = ['wallet', 'transactions'] as const;

export function useWallet() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ── Wallet data ────────────────────────────────────────────────────────
  const {
    data: wallet,
    isLoading,
    error,
  } = useQuery<Wallet | null, Error>({
    queryKey: WALLET_QUERY_KEY,
    queryFn: async () => {
      try {
        return await getUserWallet();
      } catch (err) {
        await logApiError('getUserWallet', err);
        throw err;
      }
    },
    enabled: !!user,
  });

  // ── Recent wallet transactions ─────────────────────────────────────────
  const { data: transactions = [] } = useQuery<WalletTransaction[], Error>({
    queryKey: WALLET_TXN_QUERY_KEY,
    queryFn: async () => {
      try {
        return await getWalletTransactions(10);
      } catch (err) {
        await logApiError('getWalletTransactions', err);
        return [];
      }
    },
    enabled: !!user,
  });

  // ── Supabase real-time subscription ───────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`wallet:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'wallets',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: WALLET_QUERY_KEY });
          queryClient.invalidateQueries({ queryKey: WALLET_TXN_QUERY_KEY });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  const available = wallet?.balance ?? 0;
  const locked = wallet?.locked_balance ?? 0;
  const total = available + locked;

  // Derive pending contributions from recent outbound wallet transactions
  const pendingAmount = transactions
    .filter((t) => t.transaction_type === 'deposit')
    .reduce((sum, t) => sum + t.amount, 0);

  return {
    wallet,
    available,
    locked,
    total,
    pendingAmount,
    transactions,
    isLoading,
    error,
  };
}
