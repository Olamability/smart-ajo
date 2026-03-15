import { createClient } from '@/lib/client/supabase';
import { getErrorMessage } from '@/lib/utils';

export interface AdminPayoutQueueItem {
    payout_id: string;
    group_id: string;
    group_name: string;
    recipient_id: string;
    recipient_name: string;
    recipient_email: string;
    amount: number;
    cycle_number: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    approval_status: 'pending' | 'ready' | 'approved' | 'processing' | 'completed' | 'failed';
    created_at: string;
    approved_at: string | null;
    approved_by_name: string | null;
}

/**
 * Get the admin payout queue filtered by approval status.
 */
export const getAdminPayoutQueue = async (
    status: 'ready' | 'approved' | 'processing' | 'completed' | 'failed' = 'ready'
): Promise<{ success: boolean; data?: AdminPayoutQueueItem[]; error?: string }> => {
    const supabase = createClient();
    try {
        const { data, error } = await supabase.rpc('get_admin_payout_queue', {
            p_approval_status: status
        });

        if (error) throw error;
        return { success: true, data: data as AdminPayoutQueueItem[] };
    } catch (error) {
        console.error('getAdminPayoutQueue error:', error);
        return { success: false, error: getErrorMessage(error, 'Failed to load payout queue') };
    }
};

/**
 * Approve a payout, moving it from 'ready' to 'approved'.
 */
export const approvePayout = async (
    payoutId: string
): Promise<{ success: boolean; error?: string }> => {
    const supabase = createClient();
    try {
        const { data, error } = await supabase.rpc('approve_payout', {
            p_payout_id: payoutId
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Approval failed');

        return { success: true };
    } catch (error) {
        console.error('approvePayout error:', error);
        return { success: false, error: getErrorMessage(error, 'Failed to approve payout') };
    }
};

/**
 * Release a payout, invoking the edge function to process payment via Paystack.
 */
export const releasePayout = async (
    payoutId: string
): Promise<{ success: boolean; error?: string }> => {
    const supabase = createClient();
    try {
        const { data, error } = await supabase.functions.invoke('process-admin-approved-payout', {
            body: { payoutId }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Payout release failed');

        return { success: true };
    } catch (error) {
        console.error('releasePayout error:', error);
        return { success: false, error: getErrorMessage(error, 'Failed to release payout') };
    }
};
