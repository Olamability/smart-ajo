/**
 * useContributions Hook
 *
 * Fetches contribution cycles for a group (or the current user) via
 * React Query, and subscribes to Supabase real-time changes so the
 * contribution list updates automatically after a payment is verified.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getGroupContributions, getUserContributions } from '@/api';
import { logApiError } from '@/api/audit';
import { createClient } from '@/lib/client/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Contribution } from '@/types';

export function contributionQueryKey(groupId?: string) {
  return groupId ? ['contributions', 'group', groupId] : ['contributions', 'user'];
}

interface UseContributionsOptions {
  /** When provided, fetches contributions for this group only. */
  groupId?: string;
  /** Filter to show only the current user's contributions (default: true). */
  currentUserOnly?: boolean;
}

export function useContributions({
  groupId,
  currentUserOnly = true,
}: UseContributionsOptions = {}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = contributionQueryKey(groupId);

  const {
    data: contributions = [],
    isLoading,
    error,
    refetch,
  } = useQuery<Contribution[], Error>({
    queryKey,
    queryFn: async () => {
      let result;
      if (groupId) {
        result = await getGroupContributions(groupId);
      } else {
        result = await getUserContributions();
      }

      if (!result.success) {
        const errMsg = result.error ?? 'Failed to fetch contributions';
        await logApiError('getContributions', errMsg, { groupId });
        throw new Error(errMsg);
      }

      const all = result.contributions ?? [];
      // Optionally restrict to the current user's rows
      return currentUserOnly && user
        ? all.filter((c) => c.userId === user.id)
        : all;
    },
    enabled: !!user,
  });

  // ── Supabase real-time subscription ──────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const supabase = createClient();

    const filter = groupId
      ? `group_id=eq.${groupId}`
      : `user_id=eq.${user.id}`;

    const channel = supabase
      .channel(`contributions:${groupId ?? user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contributions',
          filter,
        },
        () => {
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, groupId, queryClient]);  // eslint-disable-line react-hooks/exhaustive-deps

  const upcoming = contributions.filter((c) => c.status === 'pending');
  const paid = contributions.filter((c) => c.status === 'paid');
  const overdue = contributions.filter((c) => c.status === 'overdue' || c.isOverdue);

  return {
    contributions,
    upcoming,
    paid,
    overdue,
    isLoading,
    error,
    refetch,
  };
}
