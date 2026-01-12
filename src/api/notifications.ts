/**
 * Notifications API Service
 * 
 * Handles all notification-related operations using Supabase client.
 * All database operations are protected by Row Level Security (RLS) policies.
 */

import { createClient } from '@/lib/client/supabase';
import { Notification } from '@/types';
import { getErrorMessage } from '@/lib/utils';

/**
 * Get all notifications for the current user
 */
export const getUserNotifications = async (): Promise<{
  success: boolean;
  notifications?: Notification[];
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
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching notifications:', error);
      return { success: false, error: error.message };
    }

    const notifications: Notification[] = (data || []).map((notif) => ({
      id: notif.id,
      userId: notif.user_id,
      type: notif.type,
      title: notif.title,
      message: notif.message,
      isRead: notif.is_read,
      readAt: notif.read_at,
      createdAt: notif.created_at,
      relatedGroupId: notif.related_group_id,
      relatedTransactionId: notif.related_transaction_id,
    }));

    return { success: true, notifications };
  } catch (error) {
    console.error('Get notifications error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch notifications'),
    };
  }
};

/**
 * Get unread notifications count
 */
export const getUnreadNotificationsCount = async (): Promise<{
  success: boolean;
  count?: number;
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

    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false);

    if (error) {
      console.error('Error counting notifications:', error);
      return { success: false, error: error.message };
    }

    return { success: true, count: count || 0 };
  } catch (error) {
    console.error('Count notifications error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to count notifications'),
    };
  }
};

/**
 * Mark a notification as read
 */
export const markNotificationAsRead = async (
  notificationId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const supabase = createClient();

    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId);

    if (error) {
      console.error('Error marking notification as read:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Mark notification error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to mark notification as read'),
    };
  }
};

/**
 * Mark all notifications as read
 */
export const markAllNotificationsAsRead = async (): Promise<{
  success: boolean;
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

    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('is_read', false);

    if (error) {
      console.error('Error marking all notifications as read:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Mark all notifications error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to mark all notifications as read'),
    };
  }
};

/**
 * Delete a notification
 */
export const deleteNotification = async (
  notificationId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const supabase = createClient();

    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId);

    if (error) {
      console.error('Error deleting notification:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Delete notification error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to delete notification'),
    };
  }
};
