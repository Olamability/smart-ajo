/**
 * Audit Log API Service
 *
 * Logs user actions and API errors to the audit_logs table.
 * Called throughout the app to maintain a complete audit trail.
 */

import { createClient } from '@/lib/client/supabase';

export type AuditAction =
  | 'api_error'
  | 'payment_initiated'
  | 'payment_verified'
  | 'payment_failed'
  | 'contribution_paid'
  | 'contribution_overdue'
  | 'payout_requested'
  | 'payout_completed'
  | 'group_created'
  | 'group_joined'
  | 'group_left'
  | 'profile_updated'
  | 'notification_read';

export interface AuditLogEntry {
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
}

/**
 * Write an entry to the audit_logs table.
 * Failures are swallowed so they never disrupt the caller's flow.
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from('audit_logs').insert({
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      details: entry.details ?? {},
    });
  } catch (err) {
    // Never let audit logging failures bubble up to callers
    console.warn('[audit] Failed to write audit log:', err);
  }
}

/**
 * Convenience helper – log an API error with structured context.
 */
export async function logApiError(
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';

  await logAuditEvent({
    action: 'api_error',
    resourceType: 'api',
    resourceId: operation,
    details: { message, ...context },
  });
}
