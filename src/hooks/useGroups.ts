/**
 * useGroups Hook
 *
 * Fetches the current user's groups via React Query.
 * Provides a single, cached data source so multiple components don't
 * make redundant network calls.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getUserGroups, getGroupById, getGroupMembers } from '@/api';
import { logApiError } from '@/api/audit';
import { useAuth } from '@/contexts/AuthContext';
import type { Group, GroupMember } from '@/types';

export const GROUPS_QUERY_KEY = ['groups'] as const;

export function groupQueryKey(groupId: string) {
  return ['groups', groupId] as const;
}

export function groupMembersQueryKey(groupId: string) {
  return ['groups', groupId, 'members'] as const;
}

/** Hook that returns the current user's groups list */
export function useGroups() {
  const { user } = useAuth();

  return useQuery<Group[], Error>({
    queryKey: GROUPS_QUERY_KEY,
    queryFn: async () => {
      const result = await getUserGroups();
      if (!result.success) {
        const errMsg = result.error ?? 'Failed to fetch groups';
        await logApiError('getUserGroups', errMsg);
        throw new Error(errMsg);
      }
      return result.groups ?? [];
    },
    enabled: !!user,
  });
}

/** Hook that returns a single group by ID */
export function useGroup(groupId: string | undefined) {
  const { user } = useAuth();

  return useQuery<Group | null, Error>({
    queryKey: groupId ? groupQueryKey(groupId) : ['groups', 'undefined'],
    queryFn: async () => {
      if (!groupId) return null;
      const result = await getGroupById(groupId);
      if (!result.success) {
        const errMsg = result.error ?? 'Failed to fetch group';
        await logApiError('getGroupById', errMsg, { groupId });
        throw new Error(errMsg);
      }
      return result.group ?? null;
    },
    enabled: !!user && !!groupId,
  });
}

/** Hook that returns members of a specific group */
export function useGroupMembers(groupId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<GroupMember[], Error>({
    queryKey: groupId ? groupMembersQueryKey(groupId) : ['groups', 'undefined', 'members'],
    queryFn: async () => {
      if (!groupId) return [];
      const result = await getGroupMembers(groupId);
      if (!result.success) {
        const errMsg = result.error ?? 'Failed to fetch group members';
        await logApiError('getGroupMembers', errMsg, { groupId });
        throw new Error(errMsg);
      }
      return result.members ?? [];
    },
    enabled: !!user && !!groupId,
  });

  const invalidate = () => {
    if (groupId) {
      queryClient.invalidateQueries({ queryKey: groupMembersQueryKey(groupId) });
    }
  };

  return { ...query, invalidate };
}
