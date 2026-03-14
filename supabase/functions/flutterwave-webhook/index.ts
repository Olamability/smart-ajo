/**
 * flutterwave-webhook Edge Function
 *
 * Handles real-time webhook notifications from Flutterwave.
 *
 * Webhook Events Handled:
 * - charge.completed  – Payment completed successfully
 * - charge.failed     – Payment failed (Flutterwave may not send this explicitly)
 * - transfer.completed – Payout transfer completed
 * - transfer.failed   – Payout transfer failed
 *
 * Security:
 * - Verifies the x-flutterwave-signature header using the secret hash configured
 *   in the Flutterwave dashboard (plain string equality, as per FLW docs).
 * - Uses service role key for all DB updates (bypasses RLS safely).
 *
 * Environment variables required:
 * - FLUTTERWAVE_SECRET_HASH  – the "Secret Hash" set in the FLW dashboard
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, verif-hash',
};

interface FlutterwaveWebhookEvent {
  event: string;
  data: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    device_fingerprint: string;
    amount: number;
    currency: string;
    charged_amount: number;
    app_fee: number;
    merchant_fee: number;
    processor_response: string;
    auth_model: string;
    ip: string;
    narration: string;
    status: string; // 'successful' | 'failed'
    payment_type: string;
    created_at: string;
    account_id: number;
    customer: {
      id: number;
      name: string;
      phone_number: string;
      email: string;
      created_at: string;
    };
    meta?: {
      userId?: string;
      groupId?: string;
      paymentType?: string;
      slotNumber?: number;
      contributionId?: string;
      cycleNumber?: number;
      [key: string]: unknown;
    };
  };
}

/**
 * Process a successful Flutterwave charge event.
 * Mirrors the logic in the Paystack webhook for consistency.
 */
async function processChargeCompleted(
  supabase: SupabaseClient,
  data: FlutterwaveWebhookEvent['data']
): Promise<Record<string, unknown>> {
  const { tx_ref: reference, amount, meta = {}, status } = data;

  if (status !== 'successful') {
    console.log(`[flutterwave-webhook] Charge ${reference} not successful, status: ${status}`);
    return { success: false, error: 'Payment not successful' };
  }

  const userId = meta.userId;
  const groupId = meta.groupId;
  const paymentType = meta.paymentType;
  const slotNumber = meta.slotNumber;
  const contributionId = meta.contributionId;

  if (!userId || !groupId) {
    console.error('[flutterwave-webhook] Missing userId or groupId in metadata:', meta);
    return { success: false, error: 'Invalid payment metadata' };
  }

  // Idempotency: skip if already completed
  const { data: existing } = await supabase
    .from('transactions')
    .select('status')
    .eq('reference', reference)
    .single();

  if (existing?.status === 'completed') {
    console.log(`[flutterwave-webhook] ${reference} already processed – skipping`);
    return { success: true, reference, status: 'already_processed' };
  }

  // Mark transaction completed
  const { error: txError } = await supabase
    .from('transactions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      metadata: {
        ...meta,
        webhook_received: true,
        webhook_source: 'flutterwave',
        webhook_timestamp: new Date().toISOString(),
      },
    })
    .eq('reference', reference);

  if (txError) {
    console.error('[flutterwave-webhook] Failed to update transaction:', txError);
    return { success: false, error: 'Failed to update transaction record' };
  }

  if (paymentType === 'group_creation' || paymentType === 'group_join') {
    // Upsert group membership
    const { error: memberError } = await supabase
      .from('group_members')
      .upsert(
        {
          group_id: groupId,
          user_id: userId,
          position: slotNumber,
          status: 'active',
          has_paid_security_deposit: true,
          security_deposit_paid_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,group_id', ignoreDuplicates: false }
      );

    if (memberError) {
      console.error('[flutterwave-webhook] Failed to upsert group_member:', memberError);
      return { success: false, error: 'Failed to activate membership' };
    }

    // Activate group if full
    const { data: groupData } = await supabase
      .from('groups')
      .select('total_members, current_members')
      .eq('id', groupId)
      .single();

    if (groupData && groupData.current_members >= groupData.total_members) {
      await supabase
        .from('groups')
        .update({ status: 'active' })
        .eq('id', groupId)
        .eq('status', 'forming');
    }

    // Mark join request as paid
    if (paymentType === 'group_join') {
      await supabase
        .from('group_join_requests')
        .update({
          status: 'paid',
          payment_completed_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('group_id', groupId)
        .eq('status', 'approved');
    }

    // Notify user
    await supabase.rpc('send_payment_notification', {
      p_user_id: userId,
      p_type: 'payment_received',
      p_title: paymentType === 'group_creation' ? 'Group created!' : 'You joined the group!',
      p_message: paymentType === 'group_creation'
        ? 'Your security deposit was received and your group is now forming.'
        : 'Your security deposit was received. Welcome to the group!',
      p_metadata: { groupId, paymentType, reference },
    });
  } else if (paymentType === 'contribution') {
    if (!contributionId) {
      return { success: false, error: 'Contribution ID required for contribution payment' };
    }

    // Mark contribution paid
    const { error: contribError } = await supabase
      .from('contributions')
      .update({
        status: 'paid',
        paid_date: new Date().toISOString(),
        transaction_ref: reference,
      })
      .eq('id', contributionId)
      .eq('user_id', userId);

    if (contribError) {
      console.error('[flutterwave-webhook] Failed to update contribution:', contribError);
      return { success: false, error: 'Failed to record contribution' };
    }

    // Increment group total_collected (Flutterwave amounts are in naira)
    const { error: balanceError } = await supabase.rpc('increment_group_total_collected', {
      p_group_id: groupId,
      p_amount: amount,
    });

    if (balanceError) {
      console.error('[flutterwave-webhook] Failed to update group balance:', balanceError);
      return { success: false, error: 'Failed to update group balance' };
    }

    // Check cycle readiness and prepare payout
    const { data: contribData } = await supabase
      .from('contributions')
      .select('cycle_number')
      .eq('id', contributionId)
      .single();

    if (contribData) {
      const { data: cycleResult, error: cycleError } = await supabase.rpc(
        'check_cycle_and_prepare_payout',
        { p_group_id: groupId, p_cycle_number: contribData.cycle_number }
      );

      if (cycleError) {
        console.error('[flutterwave-webhook] Cycle check error:', cycleError);
      } else if (cycleResult?.cycle_complete && cycleResult?.payout_created) {
        await supabase.rpc('send_payout_ready_notifications', {
          p_group_id: groupId,
          p_cycle_number: contribData.cycle_number,
          p_recipient_id: cycleResult.recipient_id,
        });
      }
    }

    // Notify contributor
    await supabase.rpc('send_payment_notification', {
      p_user_id: userId,
      p_type: 'payment_received',
      p_title: 'Contribution received',
      p_message: `Your contribution of ₦${amount.toLocaleString()} has been received.`,
      p_metadata: { groupId, contributionId, reference },
    });
  }

  return { success: true, reference, status: 'processed' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const secretHash = Deno.env.get('FLUTTERWAVE_SECRET_HASH');
    if (!secretHash) {
      throw new Error('FLUTTERWAVE_SECRET_HASH not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    // Flutterwave uses a plain header value for signature verification
    // (not HMAC – just compare the configured secret hash with the header value)
    const signature = req.headers.get('verif-hash');
    if (!signature || signature !== secretHash) {
      console.error('[flutterwave-webhook] Invalid or missing verif-hash header');
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const event: FlutterwaveWebhookEvent = await req.json();
    console.log('[flutterwave-webhook] Received event:', event.event);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let result: Record<string, unknown>;

    switch (event.event) {
      case 'charge.completed':
        result = await processChargeCompleted(supabase, event.data);
        break;

      case 'transfer.completed':
      case 'transfer.failed':
        console.log(`[flutterwave-webhook] ${event.event} – acknowledged (payout webhook)`);
        result = { success: true, status: 'acknowledged' };
        break;

      default:
        console.log(`[flutterwave-webhook] Unhandled event: ${event.event}`);
        result = { success: true, status: 'ignored' };
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[flutterwave-webhook] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
