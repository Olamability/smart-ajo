/**
 * useNotifications Hook
 *
 * Fetches notifications via React Query and subscribes to real-time
 * updates from the Supabase `notifications` channel so the UI updates
 * instantly whenever a new notification arrives or one is marked read.
 */

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationsCount,
} from '@/api';
import { logApiError } from '@/api/audit';
import { createClient } from '@/lib/client/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Notification } from '@/types';

export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const;
export const UNREAD_COUNT_QUERY_KEY = ['notifications', 'unreadCount'] as const;

export function useNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ── Fetch notifications ──────────────────────────────────────────────────
  const {
    data: notifications = [],
    isLoading,
    error,
  } = useQuery<Notification[], Error>({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: async () => {
      const result = await getUserNotifications();
      if (!result.success) {
        const errMsg = result.error ?? 'Failed to fetch notifications';
        await logApiError('getUserNotifications', errMsg);
        throw new Error(errMsg);
      }
      return result.notifications ?? [];
    },
    enabled: !!user,
  });

  // ── Unread count ─────────────────────────────────────────────────────────
  const { data: unreadCount = 0 } = useQuery<number, Error>({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    queryFn: async () => {
      const result = await getUnreadNotificationsCount();
      if (!result.success) return 0;
      return result.count ?? 0;
    },
    enabled: !!user,
  });

  // ── Mark single notification read ────────────────────────────────────────
  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const result = await markNotificationAsRead(notificationId);
      if (!result.success) throw new Error(result.error ?? 'Failed to mark as read');
    },
    onSuccess: (_data, notificationId) => {
      queryClient.setQueryData<Notification[]>(NOTIFICATIONS_QUERY_KEY, (prev = []) =>
        prev.map((n) =>
          n.id === notificationId
            ? { ...n, isRead: true, readAt: new Date().toISOString() }
            : n
        )
      );
      queryClient.setQueryData<number>(
        UNREAD_COUNT_QUERY_KEY,
        (prev = 0) => Math.max(0, prev - 1)
      );
    },
    onError: async (err: Error) => {
      await logApiError('markNotificationAsRead', err);
      toast.error('Failed to mark notification as read');
    },
  });

  // ── Mark all notifications read ───────────────────────────────────────────
  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const result = await markAllNotificationsAsRead();
      if (!result.success) throw new Error(result.error ?? 'Failed to mark all as read');
    },
    onSuccess: () => {
      queryClient.setQueryData<Notification[]>(NOTIFICATIONS_QUERY_KEY, (prev = []) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
      );
      queryClient.setQueryData<number>(UNREAD_COUNT_QUERY_KEY, 0);
      toast.success('All notifications marked as read');
    },
    onError: async (err: Error) => {
      await logApiError('markAllNotificationsAsRead', err);
      toast.error('Failed to mark all notifications as read');
    },
  });

  // ── Supabase real-time subscription ──────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Refetch both lists when anything changes
          queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    markAsRead: (id: string) => markReadMutation.mutate(id),
    markAllAsRead: () => markAllReadMutation.mutate(),
    isMarkingRead: markReadMutation.isPending,
    isMarkingAllRead: markAllReadMutation.isPending,
  };
}
