/**
 * Contributions API Service
 * 
 * Handles all contribution-related operations using Supabase client.
 * All database operations are protected by Row Level Security (RLS) policies.
 */

import { createClient } from '@/lib/client/supabase';
import { Contribution } from '@/types';
import { getErrorMessage } from '@/lib/utils';

/**
 * Get contributions for a specific group
 */
export const getGroupContributions = async (
  groupId: string
): Promise<{ success: boolean; contributions?: Contribution[]; error?: string }> => {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('contributions')
      .select('*')
      .eq('group_id', groupId)
      .order('due_date', { ascending: false });

    if (error) {
      console.error('Error fetching contributions:', error);
      return { success: false, error: error.message };
    }

    const contributions: Contribution[] = (data || []).map((contrib) => ({
      id: contrib.id,
      groupId: contrib.group_id,
      userId: contrib.user_id,
      amount: contrib.amount,
      cycleNumber: contrib.cycle_number,
      status: contrib.status,
      dueDate: contrib.due_date,
      paidDate: contrib.paid_date,
      penalty: 0, // Penalties are tracked separately in penalties table
      serviceFee: contrib.service_fee || 0,
      isOverdue: contrib.is_overdue,
      transactionRef: contrib.transaction_ref,
      createdAt: contrib.created_at,
      updatedAt: contrib.updated_at,
    }));

    return { success: true, contributions };
  } catch (error) {
    console.error('Get contributions error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch contributions'),
    };
  }
};

/**
 * Get user's contributions across all groups
 */
export const getUserContributions = async (): Promise<{
  success: boolean;
  contributions?: Contribution[];
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
      .from('contributions')
      .select('*')
      .eq('user_id', user.id)
      .order('due_date', { ascending: false });

    if (error) {
      console.error('Error fetching user contributions:', error);
      return { success: false, error: error.message };
    }

    const contributions: Contribution[] = (data || []).map((contrib) => ({
      id: contrib.id,
      groupId: contrib.group_id,
      userId: contrib.user_id,
      amount: contrib.amount,
      cycleNumber: contrib.cycle_number,
      status: contrib.status,
      dueDate: contrib.due_date,
      paidDate: contrib.paid_date,
      penalty: 0, // Penalties are tracked separately in penalties table
      serviceFee: contrib.service_fee || 0,
      isOverdue: contrib.is_overdue,
      transactionRef: contrib.transaction_ref,
      createdAt: contrib.created_at,
      updatedAt: contrib.updated_at,
    }));

    return { success: true, contributions };
  } catch (error) {
    console.error('Get user contributions error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch contributions'),
    };
  }
};

/**
 * Record a contribution payment
 * Note: In production, this would be triggered automatically by database triggers
 * after payment verification from Paystack webhook (handled by database functions or triggers)
 */
export const recordContributionPayment = async (
  contributionId: string,
  transactionRef: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const supabase = createClient();

    const { error } = await supabase
      .from('contributions')
      .update({
        status: 'paid',
        paid_date: new Date().toISOString(),
        transaction_ref: transactionRef,
      })
      .eq('id', contributionId);

    if (error) {
      console.error('Error recording payment:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Record payment error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to record payment'),
    };
  }
};
