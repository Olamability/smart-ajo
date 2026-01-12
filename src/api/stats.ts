/**
 * Statistics API Service
 * 
 * Handles fetching user statistics and analytics
 */

import { createClient } from '@/lib/client/supabase';
import { getErrorMessage } from '@/lib/utils';

export interface UserStats {
  totalGroups: number;
  activeGroups: number;
  completedGroups: number;
  totalContributions: number;
  totalPayouts: number;
  pendingContributions: number;
  overdueContributions: number;
  upcomingPayouts: number;
}

/**
 * Get user statistics dashboard data
 */
export const getUserStats = async (): Promise<{
  success: boolean;
  stats?: UserStats;
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

    // Get groups count
    const { data: groupsData } = await supabase
      .from('group_members')
      .select('group_id, groups(status)')
      .eq('user_id', user.id);

    const totalGroups = groupsData?.length || 0;
    const activeGroups = groupsData?.filter((gm: any) => gm.groups?.status === 'active').length || 0;
    const completedGroups = groupsData?.filter((gm: any) => gm.groups?.status === 'completed').length || 0;

    // Get contributions stats
    const { data: contributionsData } = await supabase
      .from('contributions')
      .select('status, amount, due_date')
      .eq('user_id', user.id);

    const totalContributions = contributionsData?.filter(c => c.status === 'paid').length || 0;
    const pendingContributions = contributionsData?.filter(c => c.status === 'pending' && new Date(c.due_date) >= new Date()).length || 0;
    const overdueContributions = contributionsData?.filter(c => c.status === 'pending' && new Date(c.due_date) < new Date()).length || 0;

    // Get payouts stats
    const { data: payoutsData } = await supabase
      .from('payouts')
      .select('amount, status')
      .eq('recipient_id', user.id);

    const totalPayouts = payoutsData?.filter(p => p.status === 'completed').length || 0;
    const upcomingPayouts = payoutsData?.filter(p => p.status === 'pending').length || 0;

    const stats: UserStats = {
      totalGroups,
      activeGroups,
      completedGroups,
      totalContributions,
      totalPayouts,
      pendingContributions,
      overdueContributions,
      upcomingPayouts,
    };

    return { success: true, stats };
  } catch (error) {
    console.error('Get user stats error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch statistics'),
    };
  }
};
