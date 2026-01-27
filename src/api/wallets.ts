/**
 * Wallet API Service
 * 
 * Handles wallet operations including:
 * - Fetching user wallet information
 * - Checking wallet balances
 * - Recording wallet transactions
 */

import { createClient } from '../lib/client/supabase';

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  locked_balance: number;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  from_wallet_id: string | null;
  to_wallet_id: string | null;
  amount: number;
  transaction_type: 'deposit' | 'withdrawal' | 'payout' | 'fee' | 'penalty' | 'refund';
  reference: string;
  metadata: Record<string, any>;
  created_at: string;
}

/**
 * Get current user's wallet
 */
export async function getUserWallet(): Promise<Wallet | null> {
  const supabase = createClient();
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    throw new Error('Not authenticated');
  }
  
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', user.id)
    .single();
  
  if (error) {
    console.error('Error fetching wallet:', error);
    throw error;
  }
  
  return data;
}

/**
 * Get wallet by user ID (for admin purposes)
 */
export async function getWalletByUserId(userId: string): Promise<Wallet | null> {
  const supabase = createClient();
  
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (error) {
    console.error('Error fetching wallet:', error);
    return null;
  }
  
  return data;
}

/**
 * Get wallet transaction history
 */
export async function getWalletTransactions(
  limit = 50,
  offset = 0
): Promise<WalletTransaction[]> {
  const supabase = createClient();
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    throw new Error('Not authenticated');
  }
  
  // Get user's wallet first
  const wallet = await getUserWallet();
  
  if (!wallet) {
    return [];
  }
  
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .or(`from_wallet_id.eq.${wallet.id},to_wallet_id.eq.${wallet.id}`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  
  if (error) {
    console.error('Error fetching wallet transactions:', error);
    throw error;
  }
  
  return data || [];
}

/**
 * Get wallet balance summary
 */
export async function getWalletBalance(): Promise<{
  total: number;
  available: number;
  locked: number;
}> {
  const wallet = await getUserWallet();
  
  if (!wallet) {
    return {
      total: 0,
      available: 0,
      locked: 0,
    };
  }
  
  return {
    total: wallet.balance + wallet.locked_balance,
    available: wallet.balance,
    locked: wallet.locked_balance,
  };
}

/**
 * Check if user has sufficient balance for a transaction
 */
export async function hasSufficientBalance(amount: number): Promise<boolean> {
  const wallet = await getUserWallet();
  
  if (!wallet) {
    return false;
  }
  
  return wallet.balance >= amount;
}
