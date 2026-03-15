/**
 * payout-process Edge Function
 *
 * Triggers automatic payouts for pending payout records when contribution
 * cycles are complete. Uses the Paystack Transfers API to send funds to
 * recipients' bank accounts.
 *
 * Invocation scenarios:
 * 1. Triggered by an admin after approving a payout via approve_payout() RPC
 * 2. Triggered manually by an admin for retry/recovery
 * 3. Called by a scheduled job (Supabase cron / external scheduler)
 *
 * NOTE: Only payouts with approval_status = 'approved' are eligible for
 * processing.  Payouts with approval_status = 'ready' must first be approved
 * by an admin (via the approve_payout RPC or the admin dashboard) before
 * this function will pick them up.
 *
 * Request body (all fields optional):
 * {
 *   payoutId?: string;  // Process a single payout by ID
 *   groupId?: string;   // Process all pending payouts for a group
 * }
 * If neither is provided, all pending payouts in the system are processed.
 *
 * Response:
 * {
 *   success: boolean;
 *   processed: number;
 *   initiated: number;
 *   failed: number;
 *   results: Array<{ payoutId: string; status: string; error?: string }>;
 * }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { createMonitor } from '../_shared/monitoring.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Paystack Transfers API types
// ---------------------------------------------------------------------------

interface PaystackTransferRecipientResponse {
  status: boolean;
  message: string;
  data: {
    recipient_code: string;
    details: {
      account_number: string;
      account_name: string | null;
      bank_code: string;
      bank_name: string;
    };
  };
}

interface PaystackInitiateTransferResponse {
  status: boolean;
  message: string;
  data: {
    transfer_code: string;
    reference: string;
    status: string;
    amount: number;
    currency: string;
  };
}

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
    // Audit log failures must never interrupt the payout flow
    console.error('[payout-process] Failed to write audit log:', err);
  }
}

// ---------------------------------------------------------------------------
// Payout processing logic
// ---------------------------------------------------------------------------

async function processSinglePayout(
  supabase: SupabaseClient,
  paystackSecretKey: string,
  payout: {
    id: string;
    related_group_id: string;
    recipient_id: string;
    cycle_number: number;
    amount: number;
    retry_count: number;
    max_retries: number;
    users: {
      id: string;
      email: string | null;
      full_name: string;
      account_number: string | null;
      account_name: string | null;
      bank_code: string | null;
      bank_name: string | null;
    } | null;
  },
): Promise<{ payoutId: string; status: string; error?: string }> {
  const user = payout.users;

  if (!user) {
    console.error(`[payout-process] User not found for payout ${payout.id}`);
    return { payoutId: payout.id, status: 'failed', error: 'Recipient not found' };
  }

  // Validate bank account details before attempting transfer
  if (!user.account_number || !user.bank_code) {
    console.error(`[payout-process] Recipient ${user.id} has no bank account details`);

    await supabase
      .from('payouts')
      .update({
        status: 'failed',
        notes: 'Recipient has no bank account details on file',
      })
      .eq('id', payout.id);

    // Notify recipient that payout failed due to missing bank details
    await supabase.rpc('send_payment_notification', {
      p_user_id: user.id,
      p_type: 'payout_processed',
      p_title: 'Payout failed — bank details missing',
      p_message:
        'Your payout could not be processed because your bank account details are missing. ' +
        'Please update your profile and contact support.',
      p_metadata: {
        payout_id: payout.id,
        cycle_number: payout.cycle_number,
        group_id: payout.related_group_id,
      },
    });

    await logAuditEvent(supabase, 'payout_failed', 'payout', payout.id, {
      reason: 'missing_bank_details',
      recipient_id: user.id,
      group_id: payout.related_group_id,
      cycle_number: payout.cycle_number,
    }, user.id);

    return { payoutId: payout.id, status: 'failed', error: 'Missing bank account details' };
  }

  const amountInKobo = Math.round(payout.amount * 100);
  const transferReference = `ajo_payout_${payout.id}_${Date.now()}`;

  try {
    // Step 1: Create a Paystack transfer recipient for the bank account
    const recipientResponse = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'nuban',
        name: user.account_name ?? user.full_name,
        account_number: user.account_number,
        bank_code: user.bank_code,
        currency: 'NGN',
      }),
    });

    if (!recipientResponse.ok) {
      const recipientError = await recipientResponse.json();
      throw new Error(
        `Failed to create transfer recipient: ${JSON.stringify(recipientError)}`,
      );
    }

    const recipientData: PaystackTransferRecipientResponse = await recipientResponse.json();
    if (!recipientData.status) {
      throw new Error(`Paystack recipient creation failed: ${recipientData.message}`);
    }

    const recipientCode = recipientData.data.recipient_code;
    console.log(`[payout-process] Transfer recipient created: ${recipientCode}`);

    // Step 2: Mark payout as processing while transfer is in flight
    await supabase
      .from('payouts')
      .update({
        status: 'processing',
        payment_reference: transferReference,
        notes: `Paystack recipient code: ${recipientCode}`,
      })
      .eq('id', payout.id);

    // Step 3: Initiate the Paystack transfer
    const transferResponse = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: amountInKobo,
        recipient: recipientCode,
        reason: `Smart Ajo payout — cycle ${payout.cycle_number}`,
        reference: transferReference,
        currency: 'NGN',
      }),
    });

    const transferData: PaystackInitiateTransferResponse = await transferResponse.json();

    if (!transferResponse.ok || !transferData.status) {
      throw new Error(`Transfer initiation failed: ${transferData.message}`);
    }

    console.log(
      `[payout-process] Transfer initiated: ${transferData.data.transfer_code}`,
    );

    // Steps 4+5 (atomic): update payout with the Paystack transfer_code and
    // insert the corresponding transaction record — both in a single RPC call.
    const { data: initiationResult, error: initiationError } = await supabase.rpc(
      'record_payout_initiation',
      {
        p_payout_id:          payout.id,
        p_user_id:            user.id,
        p_group_id:           payout.related_group_id,
        p_cycle_number:       payout.cycle_number,
        p_amount_kobo:        amountInKobo,
        p_transfer_code:      transferData.data.transfer_code,
        p_transfer_reference: transferReference,
      }
    );

    if (initiationError || !initiationResult?.success) {
      throw new Error(
        initiationResult?.error ?? initiationError?.message ?? 'Failed to record payout initiation'
      );
    }

    // Step 6: Audit log the successful transfer initiation
    await logAuditEvent(supabase, 'payout_initiated', 'payout', payout.id, {
      recipient_id: user.id,
      group_id: payout.related_group_id,
      cycle_number: payout.cycle_number,
      amount_naira: payout.amount,
      amount_kobo: amountInKobo,
      transfer_code: transferData.data.transfer_code,
      transfer_reference: transferReference,
      recipient_code: recipientCode,
    }, user.id);

    return { payoutId: payout.id, status: 'processing' };
  } catch (transferError) {
    const errorMessage =
      transferError instanceof Error ? transferError.message : String(transferError);
    console.error(
      `[payout-process] Transfer error for payout ${payout.id}:`,
      transferError,
    );

    // Increment retry counter and decide whether to re-queue or permanently fail
    const { data: retryResult } = await supabase.rpc('increment_payout_retry', {
      p_payout_id:      payout.id,
      p_failure_reason: errorMessage,
    });

    const canRetry: boolean = retryResult?.can_retry ?? false;
    const retryCount: number = retryResult?.retry_count ?? payout.retry_count + 1;
    const maxRetries: number = retryResult?.max_retries ?? payout.max_retries;

    if (canRetry) {
      // Return payout to pending so the next scheduled run can retry it
      await supabase
        .from('payouts')
        .update({
          status: 'pending',
          notes: `Transfer error (attempt ${retryCount}/${maxRetries}): ${errorMessage}`,
        })
        .eq('id', payout.id);

      console.warn(
        `[payout-process] Payout ${payout.id} failed (attempt ${retryCount}/${maxRetries}); re-queued for retry.`,
      );
    } else {
      // Exceeded max retries — permanently mark as failed
      await supabase
        .from('payouts')
        .update({
          status: 'failed',
          notes: `Permanently failed after ${retryCount} attempts. Last error: ${errorMessage}`,
        })
        .eq('id', payout.id);

      // Notify recipient that payout permanently failed
      await supabase.rpc('send_payment_notification', {
        p_user_id: user.id,
        p_type: 'payout_processed',
        p_title: 'Payout permanently failed',
        p_message:
          `Your payout for cycle ${payout.cycle_number} could not be processed after ` +
          `${retryCount} attempts. Please contact support.`,
        p_metadata: {
          payout_id: payout.id,
          cycle_number: payout.cycle_number,
          group_id: payout.related_group_id,
          retry_count: retryCount,
        },
      });

      console.error(
        `[payout-process] Payout ${payout.id} permanently failed after ${retryCount}/${maxRetries} attempts.`,
      );
    }

    await logAuditEvent(supabase, 'payout_transfer_error', 'payout', payout.id, {
      recipient_id: user.id,
      group_id: payout.related_group_id,
      cycle_number: payout.cycle_number,
      error: errorMessage,
      retry_count: retryCount,
      max_retries: maxRetries,
      can_retry: canRetry,
    }, user.id);

    return { payoutId: payout.id, status: canRetry ? 'error' : 'failed', error: errorMessage };
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const mon = createMonitor('payout-process');

  try {
    const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecretKey) {
      throw new Error('PAYSTACK_SECRET_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse optional body — all fields optional
    let payoutId: string | undefined;
    let groupId: string | undefined;
    try {
      if (req.method !== 'GET') {
        const body = await req.json();
        payoutId = body?.payoutId;
        groupId = body?.groupId;
      }
    } catch {
      // Empty or non-JSON body is fine — process all pending payouts
    }

    // Build query for pending payouts, joining user bank account details.
    // Exclude payouts that have already reached their retry limit to avoid
    // attempting transfers that are permanently failed but not yet transitioned.
    type PendingPayout = {
      id: string;
      related_group_id: string;
      recipient_id: string;
      cycle_number: number;
      amount: number;
      retry_count: number;
      max_retries: number;
      users: {
        id: string;
        email: string | null;
        full_name: string;
        account_number: string | null;
        account_name: string | null;
        bank_code: string | null;
        bank_name: string | null;
      } | null;
    };

    // Only process payouts that have been explicitly approved by an admin.
    // Payouts with approval_status = 'ready' are waiting for admin approval
    // and must not be dispatched automatically.
    let query = supabase
      .from('payouts')
      .select(
        `id,
         related_group_id,
         recipient_id,
         cycle_number,
         amount,
         retry_count,
         max_retries,
         users!recipient_id (
           id,
           email,
           full_name,
           account_number,
           account_name,
           bank_code,
           bank_name
         )`,
      )
      .eq('status', 'pending')
      .eq('approval_status', 'approved');

    if (payoutId) {
      query = query.eq('id', payoutId);
    } else if (groupId) {
      query = query.eq('related_group_id', groupId);
    }

    const { data: pendingPayouts, error: fetchError } = await query;

    if (fetchError) {
      console.error('[payout-process] Failed to fetch pending payouts:', fetchError);
      throw new Error('Failed to fetch pending payouts');
    }

    // Filter in application code: skip payouts that have exhausted their retry limit.
    // (PostgREST cannot compare two columns directly in a filter expression.)
    const eligiblePayouts = (pendingPayouts ?? []).filter(
      (p) => (p as PendingPayout).retry_count < (p as PendingPayout).max_retries,
    ) as PendingPayout[];

    if (eligiblePayouts.length === 0) {
      console.log('[payout-process] No pending payouts found');
      return new Response(
        JSON.stringify({ success: true, processed: 0, initiated: 0, failed: 0, message: 'No pending payouts' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[payout-process] Processing ${eligiblePayouts.length} pending payout(s)`);

    const results: Array<{ payoutId: string; status: string; error?: string }> = [];

    for (const payout of eligiblePayouts) {
      const result = await processSinglePayout(supabase, paystackSecretKey, payout);
      results.push(result);
    }

    const initiatedCount = results.filter((r) => r.status === 'processing').length;
    const failedCount = results.filter(
      (r) => r.status === 'failed' || r.status === 'error',
    ).length;

    console.log(
      `[payout-process] Done. ${initiatedCount} initiated, ${failedCount} failed.`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        processed: pendingPayouts.length,
        initiated: initiatedCount,
        failed: failedCount,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    await mon.error('Unexpected error in payout-process handler', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
