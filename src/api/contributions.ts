/**
 * Contributions API Service
 * 
 * Handles all contribution-related operations using Supabase client.
 * All database operations are protected by Row Level Security (RLS) policies.
 */

import { createClient } from '@/lib/client/supabase';
import { Contribution } from '@/types';
import { getErrorMessage } from '@/lib/utils';

export interface ContributionCycleSummary {
  id: string;
  cycleNumber: number;
  amount: number;
  serviceFee: number;
  status: 'pending' | 'paid' | 'overdue' | 'waived';
  dueDate: string;
  paidDate?: string;
  transactionRef?: string;
  isOverdue: boolean;
}

export interface GroupContributionSummary {
  groupId: string;
  groupName: string;
  contributionAmount: number;
  serviceFeePercentage: number;
  securityDepositAmount: number;
  securityDepositPaid: boolean;
  securityDepositPaidAt?: string;
  totalContributionsPaid: number;
  totalServiceFeesPaid: number;
  totalCyclesPaid: number;
  cycles: ContributionCycleSummary[];
}

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
 * Get a per-group contribution summary for the current user.
 *
 * Returns, for every group the user belongs to:
 *  - Security deposit status (paid / amount)
 *  - Cycle-by-cycle breakdown (only *paid* cycles count toward totals)
 *  - Total paid contribution amount and service fees
 *
 * Pending or failed payments are intentionally excluded from totals.
 */
export const getUserContributionSummary = async (): Promise<{
  success: boolean;
  summaries?: GroupContributionSummary[];
  error?: string;
}> => {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Fetch contributions with group info and the user's membership record in one query
    const { data: contribData, error: contribError } = await supabase
      .from('contributions')
      .select(`
        id, group_id, amount, cycle_number, status, due_date,
        paid_date, service_fee, is_overdue, transaction_ref,
        groups (
          id, name, contribution_amount, service_fee_percentage,
          security_deposit_amount
        )
      `)
      .eq('user_id', user.id)
      .order('cycle_number', { ascending: true });

    if (contribError) {
      console.error('Error fetching contribution summary:', contribError);
      return { success: false, error: contribError.message };
    }

    if (!contribData || contribData.length === 0) {
      return { success: true, summaries: [] };
    }

    // Fetch the user's group_members records for security deposit status
    const groupIds = [...new Set(contribData.map((c) => c.group_id))];

    interface MemberRow {
      group_id: string;
      has_paid_security_deposit: boolean;
      security_deposit_amount: number;
      security_deposit_paid_at: string | null;
    }

    const { data: memberData, error: memberError } = await supabase
      .from('group_members')
      .select('group_id, has_paid_security_deposit, security_deposit_amount, security_deposit_paid_at')
      .eq('user_id', user.id)
      .in('group_id', groupIds);

    if (memberError) {
      // Log but continue – security deposit info is supplemental
      console.warn('Could not fetch group membership data:', memberError.message);
    }

    const memberByGroup = new Map<string, MemberRow>(
      ((memberData || []) as MemberRow[]).map((m) => [m.group_id, m])
    );

    // Group contributions by group_id
    const summaryMap = new Map<string, GroupContributionSummary>();

    for (const contrib of contribData) {
      try {
        const groupRaw = Array.isArray(contrib.groups)
          ? contrib.groups[0]
          : contrib.groups;

        if (!groupRaw) {
          // Skip rows with missing group data – data inconsistency, log and continue
          console.warn('Contribution missing group data, skipping:', contrib.id);
          continue;
        }

        const groupId = contrib.group_id as string;
        const member = memberByGroup.get(groupId);

        if (!summaryMap.has(groupId)) {
          summaryMap.set(groupId, {
            groupId,
            groupName: (groupRaw as { name: string }).name,
            contributionAmount: (groupRaw as { contribution_amount: number }).contribution_amount,
            serviceFeePercentage: (groupRaw as { service_fee_percentage: number }).service_fee_percentage ?? 2,
            securityDepositAmount: member?.security_deposit_amount
              ?? (groupRaw as { security_deposit_amount: number }).security_deposit_amount
              ?? 0,
            securityDepositPaid: member?.has_paid_security_deposit ?? false,
            securityDepositPaidAt: member?.security_deposit_paid_at ?? undefined,
            totalContributionsPaid: 0,
            totalServiceFeesPaid: 0,
            totalCyclesPaid: 0,
            cycles: [],
          });
        }

        const summary = summaryMap.get(groupId)!;
        const isPaid = contrib.status === 'paid';
        const isOverdueFlag =
          contrib.is_overdue === true ||
          contrib.status === 'overdue';

        const cycleServiceFee = contrib.service_fee != null
          ? (contrib.service_fee as number)
          : (contrib.amount * summary.serviceFeePercentage) / 100;

        summary.cycles.push({
          id: contrib.id as string,
          cycleNumber: contrib.cycle_number as number,
          amount: contrib.amount as number,
          serviceFee: cycleServiceFee,
          status: contrib.status as ContributionCycleSummary['status'],
          dueDate: contrib.due_date as string,
          paidDate: contrib.paid_date ?? undefined,
          transactionRef: contrib.transaction_ref ?? undefined,
          isOverdue: isOverdueFlag,
        });

        // Only count paid contributions toward totals
        if (isPaid) {
          summary.totalContributionsPaid += contrib.amount as number;
          summary.totalServiceFeesPaid += contrib.service_fee ?? 0;
          summary.totalCyclesPaid += 1;
        }
      } catch (rowError) {
        // Log and skip individual row errors to avoid crashing the whole summary
        console.error('Error processing contribution row:', contrib.id, rowError);
      }
    }

    return { success: true, summaries: Array.from(summaryMap.values()) };
  } catch (error) {
    console.error('Get user contribution summary error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch contribution summary'),
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


