/**
 * Paystack Webhook Handler Edge Function
 * 
 * Handles real-time webhook notifications from Paystack.
 * This provides instant payment confirmation without requiring
 * the user to manually verify the payment.
 * 
 * Webhook Events Handled:
 * - charge.success: Payment completed successfully
 * - charge.failed: Payment failed
 * - transfer.success: Payout transfer completed
 * - transfer.failed: Payout transfer failed
 * 
 * Security:
 * - Verifies webhook signature using Paystack secret key
 * - Only processes verified events
 * - Uses service role key for database updates (bypasses RLS)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-paystack-signature',
};

interface PaystackWebhookEvent {
  event: string;
  data: {
    id: number;
    domain: string;
    status: string;
    reference: string;
    amount: number;
    message: string | null;
    gateway_response: string;
    paid_at: string;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    metadata: {
      userId?: string;
      groupId?: string;
      paymentType?: string;
      slotNumber?: number;
      cycleId?: string;
      [key: string]: unknown;
    };
    customer: {
      id: number;
      email: string;
      customer_code: string;
    };
  };
}

/**
 * Verify Paystack webhook signature
 */
function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hash = createHmac('sha512', secret)
    .update(payload)
    .digest('hex');
  return hash === signature;
}

/** Paystack amounts are denominated in kobo (smallest NGN unit); 100 kobo = 1 naira */
const KOBO_TO_NAIRA_DIVISOR = 100;

/**
 * Process payment success event
 */
async function processPaymentSuccess(
  supabase: SupabaseClient,
  eventData: PaystackWebhookEvent['data']
) {
  const { reference, amount, metadata, status } = eventData;
  
  if (status !== 'success') {
    console.log(`Payment ${reference} is not successful, status: ${status}`);
    return { success: false, error: 'Payment not successful' };
  }

  const userId = metadata?.userId;
  const groupId = metadata?.groupId;
  const paymentType = metadata?.paymentType;
  const slotNumber = metadata?.slotNumber;

  if (!userId || !groupId) {
    console.error('Invalid payment metadata:', metadata);
    return { success: false, error: 'Invalid payment metadata' };
  }

  // Idempotency check: if the transaction is already completed, skip re-processing
  const { data: existingTransaction } = await supabase
    .from('transactions')
    .select('status')
    .eq('reference', reference)
    .single();

  if (existingTransaction?.status === 'completed') {
    console.log(`Payment ${reference} already processed — skipping duplicate webhook`);
    return { success: true, reference, status: 'already_processed' };
  }

  // Update transaction record to 'completed'
  const { error: transactionUpdateError } = await supabase
    .from('transactions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      metadata: {
        ...metadata,
        webhook_received: true,
        webhook_timestamp: new Date().toISOString(),
        verification: {
          paystack_response: eventData,
          verified_at: new Date().toISOString(),
        },
      },
    })
    .eq('reference', reference);

  if (transactionUpdateError) {
    console.error('Error updating transaction record:', transactionUpdateError);
    return { success: false, error: 'Failed to update transaction record' };
  }

  // Handle different payment types
  if (paymentType === 'group_creation' || paymentType === 'group_join') {
    // Add or update user as group member with selected slot.
    // `position` is the correct column name in group_members.
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
        {
          onConflict: 'user_id,group_id',
          ignoreDuplicates: false,
        }
      );

    if (memberError) {
      console.error('Error adding/updating group member:', memberError);
      return { success: false, error: 'Failed to activate membership' };
    }

    // Check if group should be activated
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

    // Update join request status if it's a join payment
    if (paymentType === 'group_join') {
      await supabase
        .from('group_join_requests')
        .update({ 
          status: 'paid',
          payment_completed_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('group_id', groupId)
        .eq('status', 'approved'); // Only update approved requests
    }

    // Notify the user their payment was successful
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
    // Update existing contribution record to mark as paid
    const contributionId = metadata?.contributionId;
    
    if (!contributionId) {
      return { success: false, error: 'Contribution ID required for contribution payment' };
    }

    // Update the contribution record to mark it as paid
    const { error: contributionError } = await supabase
      .from('contributions')
      .update({
        status: 'paid',
        paid_date: new Date().toISOString(),
        transaction_ref: reference,
      })
      .eq('id', contributionId)
      .eq('user_id', userId); // Extra safety: only update own contribution

    if (contributionError) {
      console.error('Error updating contribution:', contributionError);
      return { success: false, error: 'Failed to record contribution' };
    }

    // Update group balance (total_collected)
    const contributionAmountNaira = amount / KOBO_TO_NAIRA_DIVISOR;
    console.log(`Incrementing group ${groupId} total_collected by ${contributionAmountNaira}`);

    const { error: balanceUpdateError } = await supabase.rpc('increment_group_total_collected', {
      p_group_id: groupId,
      p_amount: contributionAmountNaira,
    });

    if (balanceUpdateError) {
      console.error('Error updating group balance:', balanceUpdateError);
      return { success: false, error: 'Failed to update group balance' };
    }

    // Check if all members have contributed for this cycle and prepare payout
    // Delegate to the check_cycle_and_prepare_payout RPC for atomic logic
    const { data: contributionData } = await supabase
      .from('contributions')
      .select('group_id, cycle_number')
      .eq('id', contributionId)
      .single();

    if (contributionData) {
      const cycleNumber = contributionData.cycle_number;
      const cycleGroupId = contributionData.group_id;
      console.log(`[paystack-webhook] Checking cycle ${cycleNumber} readiness for group ${cycleGroupId}`);

      const { data: cycleResult, error: cycleError } = await supabase.rpc(
        'check_cycle_and_prepare_payout',
        { p_group_id: cycleGroupId, p_cycle_number: cycleNumber }
      );

      if (cycleError) {
        console.error('[paystack-webhook] Error checking cycle readiness:', cycleError);
      } else if (cycleResult?.cycle_complete) {
        console.log(`[paystack-webhook] Cycle ${cycleNumber} complete – payout prepared`, cycleResult);

        // Notify all group members that the payout cycle is ready
        if (cycleResult.payout_created && cycleResult.recipient_id) {
          await supabase.rpc('send_payout_ready_notifications', {
            p_group_id: cycleGroupId,
            p_cycle_number: cycleNumber,
            p_recipient_id: cycleResult.recipient_id,
          });
        }
      } else {
        console.log(`[paystack-webhook] Cycle ${cycleNumber} not yet complete`, cycleResult);
      }
    }

    // Notify the contributor their payment was received
    await supabase.rpc('send_payment_notification', {
      p_user_id: userId,
      p_type: 'payment_received',
      p_title: 'Contribution received',
      p_message: `Your contribution of ₦${contributionAmountNaira.toLocaleString()} has been received.`,
      p_metadata: { groupId, contributionId, reference },
    });
  }

  return { success: true, reference, status: 'processed' };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get Paystack secret key from environment
    const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecretKey) {
      throw new Error('Paystack secret key not configured');
    }

    // Get Supabase credentials from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    // Get webhook signature from header
    const signature = req.headers.get('x-paystack-signature');
    if (!signature) {
      return new Response(
        JSON.stringify({ success: false, error: 'No signature provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get raw request body for signature verification
    const rawBody = await req.text();
    
    // Verify webhook signature
    if (!verifyWebhookSignature(rawBody, signature, paystackSecretKey)) {
      console.error('Invalid webhook signature');
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the webhook event
    const event: PaystackWebhookEvent = JSON.parse(rawBody);
    console.log('Received webhook event:', event.event);

    // Initialize Supabase client with service role key (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Process based on event type
    let result;
    switch (event.event) {
      case 'charge.success':
        result = await processPaymentSuccess(supabase, event.data);
        break;
      
      case 'charge.failed': {
        // Update transaction status to failed
        await supabase
          .from('transactions')
          .update({
            status: 'failed',
            metadata: {
              webhook_received: true,
              webhook_timestamp: new Date().toISOString(),
              failure_reason: event.data.gateway_response,
            },
          })
          .eq('reference', event.data.reference);

        // Notify the user of the payment failure (best-effort)
        const failedUserId = event.data.metadata?.userId;
        if (failedUserId) {
          await supabase.rpc('send_payment_notification', {
            p_user_id: failedUserId,
            p_type: 'payment_failed',
            p_title: 'Payment failed',
            p_message: 'Your payment could not be processed. Please try again.',
            p_metadata: {
              reference: event.data.reference,
              reason: event.data.gateway_response,
            },
          });
        }

        result = { success: true, status: 'failed_payment_recorded' };
        break;
      }
      
      case 'transfer.success':
      case 'transfer.failed':
        // Handle payout webhooks (future implementation)
        console.log(`Received ${event.event} webhook - not yet implemented`);
        result = { success: true, status: 'acknowledged' };
        break;
      
      default:
        console.log(`Unhandled webhook event: ${event.event}`);
        result = { success: true, status: 'ignored' };
    }

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error processing webhook:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
