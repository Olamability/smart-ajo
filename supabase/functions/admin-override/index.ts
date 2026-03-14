/**
 * admin-override Edge Function
 *
 * Provides admin-only controls for manual payment confirmation,
 * forced payout dispatch, and penalty management.
 *
 * All actions require an authenticated admin user (is_admin = true) and are
 * fully logged to audit_logs for compliance.
 *
 * Request body:
 * {
 *   action: 'manual_payment' | 'trigger_payout' | 'trigger_penalty_run' | 'waive_penalty';
 *
 *   // For action = 'manual_payment':
 *   contributionId: string;
 *   adminNote?: string;
 *
 *   // For action = 'trigger_payout':
 *   payoutId: string;
 *   adminNote?: string;
 *
 *   // For action = 'trigger_penalty_run':
 *   groupId?: string;   // omit to run across all active groups
 *   cycleNumber?: number;
 *
 *   // For action = 'waive_penalty':
 *   penaltyId: string;
 *   adminNote?: string;
 * }
 *
 * Response:
 * { success: boolean; data?: unknown; error?: string }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Verify that the bearer token belongs to an admin user
// Returns the admin's user ID, or throws if unauthorized.
// ---------------------------------------------------------------------------

async function requireAdmin(
  supabase: SupabaseClient,
  authHeader: string | null,
): Promise<string> {
  if (!authHeader) {
    throw new Error('Authorization header is required');
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');

  // Resolve the caller's user ID from the JWT
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    throw new Error('Invalid or expired token');
  }

  // Check is_admin flag in the users table
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('User profile not found');
  }

  if (!profile.is_admin) {
    throw new Error('Admin privileges required');
  }

  return user.id;
}

// ---------------------------------------------------------------------------
// Action: manual_payment
// ---------------------------------------------------------------------------

async function handleManualPayment(
  supabase: SupabaseClient,
  contributionId: string,
  adminNote: string | undefined,
): Promise<unknown> {
  const { data, error } = await supabase.rpc('admin_manual_payment', {
    p_contribution_id: contributionId,
    p_admin_note: adminNote ?? null,
  });

  if (error) {
    throw new Error(`admin_manual_payment RPC failed: ${error.message}`);
  }

  const result = data as { success: boolean; error?: string };
  if (!result?.success) {
    throw new Error(result?.error ?? 'Manual payment failed');
  }

  // If the cycle just completed, trigger payout-process automatically
  const cycleCheck = (result as { cycle_check?: { cycle_complete?: boolean; payout_created?: boolean } })?.cycle_check;
  if (cycleCheck?.cycle_complete && cycleCheck?.payout_created) {
    console.log('[admin-override] Cycle complete after manual payment — triggering payout-process');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && supabaseServiceKey) {
      // Fire-and-forget: call the payout-process function asynchronously
      fetch(`${supabaseUrl}/functions/v1/payout-process`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }).catch((err) => {
        console.error('[admin-override] Failed to invoke payout-process:', err);
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Action: trigger_payout
// ---------------------------------------------------------------------------

async function handleTriggerPayout(
  supabase: SupabaseClient,
  payoutId: string,
  adminNote: string | undefined,
): Promise<unknown> {
  // 1. Reset the payout to pending via the RPC
  const { data, error } = await supabase.rpc('admin_trigger_payout', {
    p_payout_id: payoutId,
    p_admin_note: adminNote ?? null,
  });

  if (error) {
    throw new Error(`admin_trigger_payout RPC failed: ${error.message}`);
  }

  const rpcResult = data as { success: boolean; error?: string };
  if (!rpcResult?.success) {
    throw new Error(rpcResult?.error ?? 'Trigger payout failed');
  }

  // 2. Immediately invoke payout-process to dispatch the transfer
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase credentials not configured for payout-process invocation');
  }

  const payoutResponse = await fetch(`${supabaseUrl}/functions/v1/payout-process`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ payoutId }),
  });

  let payoutResult: unknown;
  try {
    payoutResult = await payoutResponse.json();
  } catch {
    payoutResult = { status: payoutResponse.status };
  }

  return {
    ...rpcResult,
    payout_process_result: payoutResult,
  };
}

// ---------------------------------------------------------------------------
// Action: trigger_penalty_run
// ---------------------------------------------------------------------------

async function handleTriggerPenaltyRun(
  supabase: SupabaseClient,
  adminId: string,
  groupId: string | undefined,
  cycleNumber: number | undefined,
): Promise<unknown> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase credentials not configured for penalty-process invocation');
  }

  // Audit the manual trigger before calling the edge function
  await supabase.from('audit_logs').insert({
    user_id: adminId,
    action: 'admin_trigger_penalty_run',
    resource_type: groupId ? 'group' : 'system',
    resource_id: groupId ?? 'global',
    details: {
      group_id: groupId ?? null,
      cycle_number: cycleNumber ?? null,
      triggered_at: new Date().toISOString(),
    },
  });

  const penaltyResponse = await fetch(`${supabaseUrl}/functions/v1/penalty-process`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ groupId, cycleNumber }),
  });

  if (!penaltyResponse.ok) {
    const errText = await penaltyResponse.text();
    throw new Error(`penalty-process invocation failed (${penaltyResponse.status}): ${errText}`);
  }

  return await penaltyResponse.json();
}

// ---------------------------------------------------------------------------
// Action: waive_penalty
// ---------------------------------------------------------------------------

async function handleWaivePenalty(
  supabase: SupabaseClient,
  penaltyId: string,
  adminNote: string | undefined,
): Promise<unknown> {
  const { data, error } = await supabase.rpc('admin_waive_penalty', {
    p_penalty_id: penaltyId,
    p_admin_note: adminNote ?? null,
  });

  if (error) {
    throw new Error(`admin_waive_penalty RPC failed: ${error.message}`);
  }

  const result = data as { success: boolean; error?: string };
  if (!result?.success) {
    throw new Error(result?.error ?? 'Waive penalty failed');
  }

  return result;
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate: must be an admin
    const authHeader = req.headers.get('authorization');
    const adminId = await requireAdmin(supabase, authHeader);

    console.log(`[admin-override] Request from admin ${adminId}`);

    // Parse body
    const body = await req.json();
    const {
      action,
      contributionId,
      payoutId,
      penaltyId,
      groupId,
      cycleNumber,
      adminNote,
    } = body as {
      action: string;
      contributionId?: string;
      payoutId?: string;
      penaltyId?: string;
      groupId?: string;
      cycleNumber?: number;
      adminNote?: string;
    };

    if (!action) {
      return new Response(
        JSON.stringify({ success: false, error: 'action is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let result: unknown;

    switch (action) {
      case 'manual_payment': {
        if (!contributionId) {
          return new Response(
            JSON.stringify({ success: false, error: 'contributionId is required for manual_payment' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        result = await handleManualPayment(supabase, contributionId, adminNote);
        break;
      }

      case 'trigger_payout': {
        if (!payoutId) {
          return new Response(
            JSON.stringify({ success: false, error: 'payoutId is required for trigger_payout' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        result = await handleTriggerPayout(supabase, payoutId, adminNote);
        break;
      }

      case 'trigger_penalty_run': {
        result = await handleTriggerPenaltyRun(supabase, adminId, groupId, cycleNumber);
        break;
      }

      case 'waive_penalty': {
        if (!penaltyId) {
          return new Response(
            JSON.stringify({ success: false, error: 'penaltyId is required for waive_penalty' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        result = await handleWaivePenalty(supabase, penaltyId, adminNote);
        break;
      }

      default:
        return new Response(
          JSON.stringify({
            success: false,
            error: `Unknown action "${action}". Valid actions: manual_payment, trigger_payout, trigger_penalty_run, waive_penalty`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[admin-override] Error:', message);

    const status =
      message.includes('Admin privileges required') ||
      message.includes('Authorization header') ||
      message.includes('Invalid or expired token')
        ? 403
        : 500;

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
