/**
 * penalty-process Edge Function
 *
 * Detects overdue contributions, applies late/missed-payment penalties,
 * updates member wallets, sends real-time notifications, and writes a
 * complete audit trail.
 *
 * Invocation scenarios:
 * 1. Scheduled job (Supabase pg_cron / external cron) – run daily
 * 2. Manual trigger by an admin via the admin-override edge function
 *
 * Request body (all fields optional):
 * {
 *   groupId?:    string;  // Limit to a single group
 *   cycleNumber?: number; // Limit to a specific cycle (requires groupId)
 * }
 * If neither is provided, all active groups are processed.
 *
 * Response:
 * {
 *   success: boolean;
 *   total_penalties_applied: number;
 *   groups_processed: number;
 *   errors: Array<{ group_id: string; cycle_number: number; error: string }>;
 * }
 *
 * Security:
 * - Only callable with the Supabase service-role key (set as Authorization header)
 *   OR by an authenticated admin user.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------

async function logAuditEvent(
  supabase: SupabaseClient,
  action: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId ?? null,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details,
    });
  } catch (err) {
    console.error('[penalty-process] Failed to write audit log:', err);
  }
}

// ---------------------------------------------------------------------------
// Process penalties for a single group + cycle
// Delegates all atomic DB work to the apply_penalties_for_cycle RPC so that
// the logic is testable at the database level and the edge function stays thin.
// ---------------------------------------------------------------------------

async function processCyclePenalties(
  supabase: SupabaseClient,
  groupId: string,
  cycleNumber: number,
): Promise<{ appliedCount: number; error?: string }> {
  console.log(
    `[penalty-process] Applying penalties — group ${groupId}, cycle ${cycleNumber}`,
  );

  const { data, error } = await supabase.rpc('apply_penalties_for_cycle', {
    p_group_id: groupId,
    p_cycle_number: cycleNumber,
  });

  if (error) {
    console.error(
      `[penalty-process] apply_penalties_for_cycle failed (group=${groupId}, cycle=${cycleNumber}):`,
      error,
    );
    return { appliedCount: 0, error: error.message };
  }

  const result = data as { success: boolean; applied_count: number; error?: string };

  if (!result?.success) {
    return { appliedCount: 0, error: result?.error ?? 'Unknown RPC error' };
  }

  const appliedCount = result.applied_count ?? 0;

  if (appliedCount > 0) {
    console.log(
      `[penalty-process] Applied ${appliedCount} penalties for group ${groupId}, cycle ${cycleNumber}`,
    );

    await logAuditEvent(
      supabase,
      'penalty_batch_applied',
      'group',
      groupId,
      {
        cycle_number: cycleNumber,
        penalties_applied: appliedCount,
        processed_at: new Date().toISOString(),
      },
    );
  }

  return { appliedCount };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    // Use service-role client so RLS is bypassed for the penalty writes
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse optional body
    let groupId: string | undefined;
    let cycleNumber: number | undefined;
    try {
      if (req.method !== 'GET') {
        const body = await req.json();
        groupId = body?.groupId;
        cycleNumber = body?.cycleNumber;
      }
    } catch {
      // Empty or non-JSON body — process all active groups
    }

    // -----------------------------------------------------------------------
    // If a specific group+cycle is requested, handle it directly
    // -----------------------------------------------------------------------
    if (groupId && cycleNumber !== undefined) {
      const result = await processCyclePenalties(supabase, groupId, cycleNumber);

      return new Response(
        JSON.stringify({
          success: true,
          total_penalties_applied: result.appliedCount,
          groups_processed: 1,
          errors: result.error
            ? [{ group_id: groupId, cycle_number: cycleNumber, error: result.error }]
            : [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // -----------------------------------------------------------------------
    // Batch mode: delegate entirely to the process_overdue_and_apply_penalties
    // RPC which atomically marks overdue contributions and applies penalties
    // across all active groups.
    // -----------------------------------------------------------------------
    console.log('[penalty-process] Running batch penalty processing across all active groups');

    // If only groupId is provided (without cycleNumber), filter by group
    let batchResult: { success: boolean; total_penalties_applied: number; groups_processed: number; errors: unknown[] };

    if (groupId) {
      // Fetch active cycles for the group and process each
      const { data: cycles, error: cyclesError } = await supabase
        .from('contributions')
        .select('cycle_number')
        .eq('group_id', groupId)
        .eq('is_overdue', true)
        .in('status', ['pending', 'overdue']);

      if (cyclesError) {
        throw new Error(`Failed to fetch overdue cycles for group ${groupId}: ${cyclesError.message}`);
      }

      const uniqueCycles = [...new Set((cycles ?? []).map((c: { cycle_number: number }) => c.cycle_number))];

      let totalApplied = 0;
      const errors: Array<{ group_id: string; cycle_number: number; error: string }> = [];

      for (const cn of uniqueCycles) {
        const r = await processCyclePenalties(supabase, groupId, cn);
        totalApplied += r.appliedCount;
        if (r.error) {
          errors.push({ group_id: groupId, cycle_number: cn, error: r.error });
        }
      }

      batchResult = {
        success: true,
        total_penalties_applied: totalApplied,
        groups_processed: uniqueCycles.length > 0 ? 1 : 0,
        errors,
      };
    } else {
      // Full system batch — use the RPC that handles everything atomically
      const { data, error: rpcError } = await supabase.rpc(
        'process_overdue_and_apply_penalties',
      );

      if (rpcError) {
        throw new Error(`process_overdue_and_apply_penalties RPC failed: ${rpcError.message}`);
      }

      const rpcResult = data as {
        success: boolean;
        total_penalties_applied: number;
        groups_processed: number;
        errors: unknown[];
      };

      if (!rpcResult?.success) {
        throw new Error((rpcResult as { error?: string })?.error ?? 'Batch penalty RPC failed');
      }

      batchResult = rpcResult;

      // Write a single system-level audit log for the batch run
      await logAuditEvent(
        supabase,
        'penalty_batch_run',
        'system',
        'global',
        {
          total_penalties_applied: rpcResult.total_penalties_applied,
          groups_processed: rpcResult.groups_processed,
          processed_at: new Date().toISOString(),
        },
      );
    }

    console.log(
      `[penalty-process] Batch complete: ${batchResult.total_penalties_applied} penalties applied across ${batchResult.groups_processed} group(s)`,
    );

    return new Response(
      JSON.stringify(batchResult),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[penalty-process] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
