/**
 * Transactions API Service
 * 
 * Handles all transaction-related operations using Supabase client.
 * All database operations are protected by Row Level Security (RLS) policies.
 */

import { createClient } from '@/lib/client/supabase';
import { Transaction } from '@/types';
import { getErrorMessage } from '@/lib/utils';

/**
 * Get all transactions for the current user
 */
export const getUserTransactions = async (): Promise<{
  success: boolean;
  transactions?: Transaction[];
  error?: string;
}> => {
  try {
    const supabase = createClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching transactions:', error);
      return { success: false, error: error.message };
    }

    const transactions: Transaction[] = (data || []).map((txn) => ({
      id: txn.id,
      userId: txn.user_id,
      groupId: txn.group_id,
      type: txn.type,
      amount: txn.amount,
      status: txn.status,
      date: txn.created_at,
      description: txn.description || '',
      reference: txn.reference || '',
    }));

    return { success: true, transactions };
  } catch (error) {
    console.error('Get transactions error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch transactions'),
    };
  }
};

/**
 * Get transactions for a specific group
 */
export const getGroupTransactions = async (
  groupId: string
): Promise<{ success: boolean; transactions?: Transaction[]; error?: string }> => {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching group transactions:', error);
      return { success: false, error: error.message };
    }

    const transactions: Transaction[] = (data || []).map((txn) => ({
      id: txn.id,
      userId: txn.user_id,
      groupId: txn.group_id,
      type: txn.type,
      amount: txn.amount,
      status: txn.status,
      date: txn.created_at,
      description: txn.description || '',
      reference: txn.reference || '',
    }));

    return { success: true, transactions };
  } catch (error) {
    console.error('Get group transactions error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch transactions'),
    };
  }
};

/**
 * Create a new transaction record
 * Note: Most transactions are created automatically by database triggers
 * This function is for manual transaction creation when needed
 */
export const createTransaction = async (
  transaction: Omit<Transaction, 'id' | 'date'>
): Promise<{ success: boolean; transaction?: Transaction; error?: string }> => {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('transactions')
      .insert({
        user_id: transaction.userId,
        group_id: transaction.groupId,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        description: transaction.description,
        reference: transaction.reference,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating transaction:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      transaction: {
        id: data.id,
        userId: data.user_id,
        groupId: data.group_id,
        type: data.type,
        amount: data.amount,
        status: data.status,
        date: data.created_at,
        description: data.description || '',
        reference: data.reference || '',
      },
    };
  } catch (error) {
    console.error('Create transaction error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to create transaction'),
    };
  }
};
