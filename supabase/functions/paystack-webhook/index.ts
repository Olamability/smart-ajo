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

/**
 * Write a record to audit_logs. Failures are swallowed so they never
 * interrupt the main webhook processing flow.
 */
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
    console.error('[paystack-webhook] Audit log write failed:', err);
  }
}

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

/** Shape of event.data for transfer.success / transfer.failed webhook events */
interface PaystackTransferWebhookData {
  id: number;
  domain: string;
  amount: number;
  currency: string;
  reference: string;       // Our reference passed during transfer initiation
  transfer_code: string;   // Paystack's internal transfer code
  status: string;
  reason: string;
  source: string;
  failures: unknown;
  created_at: string;
  updated_at: string;
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

  // Atomically claim the transaction for processing.
  // A single UPDATE … RETURNING ensures that only one concurrent webhook
  // delivery can advance the status from 'pending'/'initialized' to
  // 'processing'.  Any subsequent delivery for the same reference will find
  // the row already beyond those states and be treated as a duplicate.
  const { data: claimResult, error: claimError } = await supabase.rpc(
    'claim_transaction_for_processing',
    { p_reference: reference }
  );

  if (claimError) {
    console.error(`[paystack-webhook] Failed to claim transaction ${reference}:`, claimError);
    return { success: false, error: 'Failed to claim transaction for processing' };
  }

  if (!claimResult?.success) {
    console.log(`[paystack-webhook] Transaction ${reference} already claimed — skipping duplicate webhook`);
    return { success: true, reference, status: 'already_processed' };
  }

  const completedAt = new Date().toISOString();

  // For contribution payments the three writes (transaction, contribution, group
  // balance) are performed atomically via the record_contribution_payment RPC.
  // For all other payment types the transaction record is updated here and the
  // type-specific logic follows.
  if (paymentType === 'contribution') {
    const contributionId = metadata?.contributionId;
    if (!contributionId) {
      return { success: false, error: 'Contribution ID required for contribution payment' };
    }

    const contributionAmountNaira = amount / KOBO_TO_NAIRA_DIVISOR;

    const { data: paymentResult, error: paymentRpcError } = await supabase.rpc(
      'record_contribution_payment',
      {
        p_reference:       reference,
        p_contribution_id: contributionId,
        p_user_id:         userId,
        p_group_id:        groupId,
        p_amount_naira:    contributionAmountNaira,
        p_paid_at:         completedAt,
        p_metadata:        {
          ...metadata,
          webhook_received:  true,
          webhook_timestamp: completedAt,
          verification: {
            paystack_response: eventData,
            verified_at:       completedAt,
          },
        },
      }
    );

    if (paymentRpcError || !paymentResult?.success) {
      const errMsg = paymentRpcError?.message ?? paymentResult?.error ?? 'Failed to record contribution payment';
      console.error('[paystack-webhook] record_contribution_payment failed:', errMsg);
      return { success: false, error: errMsg };
    }

    if (!paymentResult.already_processed) {
      // Check if all members have contributed for this cycle and prepare payout
      const { data: contributionData } = await supabase
        .from('contributions')
        .select('group_id, cycle_number')
        .eq('id', contributionId)
        .single();

      if (contributionData) {
        const cycleNumber  = contributionData.cycle_number;
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

          if (cycleResult.payout_created && cycleResult.recipient_id) {
            await supabase.rpc('send_payout_ready_notifications', {
              p_group_id:     cycleGroupId,
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
        p_type:    'payment_received',
        p_title:   'Contribution received',
        p_message: `Your contribution of ₦${contributionAmountNaira.toLocaleString()} has been received.`,
        p_metadata: { groupId, contributionId, reference },
      });
    }

    await logAuditEvent(supabase, 'webhook_payment_processed', 'transaction', reference, {
      event:       'charge.success',
      paymentType,
      userId,
      groupId,
      amount:      eventData.amount,
    }, userId);

    return { success: true, reference, status: paymentResult.already_processed ? 'already_processed' : 'processed' };
  }

  // Non-contribution payment types: update transaction record then handle membership.
  // The transaction is currently in 'processing' state (set by claim_transaction_for_processing
  // above). We add an explicit status guard so the UPDATE only proceeds from 'processing',
  // making the transition state-machine compliant (processing → completed).
  const { error: transactionUpdateError } = await supabase
    .from('transactions')
    .update({
      status:      'completed',
      completed_at: completedAt,
      metadata: {
        ...metadata,
        webhook_received:  true,
        webhook_timestamp: completedAt,
        verification: {
          paystack_response: eventData,
          verified_at:       completedAt,
        },
      },
    })
    .eq('reference', reference)
    .eq('status', 'processing');

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
  }

  // Audit log the successful payment processing
  await logAuditEvent(supabase, 'webhook_payment_processed', 'transaction', reference, {
    event: 'charge.success',
    paymentType,
    userId,
    groupId,
    amount: eventData.amount,
  }, userId);

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
        // Update transaction status to failed.
        // Only transition from non-terminal states to avoid overwriting a
        // 'completed' record if a success webhook arrived first.
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
          .eq('reference', event.data.reference)
          .in('status', ['pending', 'initialized', 'processing']);

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

          await logAuditEvent(supabase, 'webhook_payment_failed', 'transaction', event.data.reference, {
            event: 'charge.failed',
            reason: event.data.gateway_response,
          }, failedUserId);
        }

        result = { success: true, status: 'failed_payment_recorded' };
        break;
      }

      case 'transfer.success': {
        // Payout transfer completed — atomically mark payout and transaction as completed.
        const transferEventData = event.data as unknown as PaystackTransferWebhookData;
        const transferCode = transferEventData.transfer_code ?? transferEventData.reference;

        const { data: payoutRecord } = await supabase
          .from('payouts')
          .select('id, recipient_id, cycle_number, related_group_id')
          .eq('payment_reference', transferCode)
          .single();

        if (payoutRecord) {
          const { data: completeResult, error: completeError } = await supabase.rpc(
            'complete_payout_transfer',
            { p_payout_id: payoutRecord.id, p_transfer_code: transferCode }
          );

          if (completeError || !completeResult?.success) {
            const errMsg = completeError?.message ?? completeResult?.error ?? 'Failed to complete payout transfer';
            console.error(`[paystack-webhook] complete_payout_transfer failed for payout ${payoutRecord.id}:`, errMsg);
          } else {
            // Notify the recipient that their payout has been sent
            await supabase.rpc('send_payment_notification', {
              p_user_id: payoutRecord.recipient_id,
              p_type: 'payout_processed',
              p_title: 'Payout sent!',
              p_message: `Your payout for cycle ${payoutRecord.cycle_number} has been sent to your bank account.`,
              p_metadata: {
                payout_id:    payoutRecord.id,
                cycle_number: payoutRecord.cycle_number,
                group_id:     payoutRecord.related_group_id,
                transfer_code: transferCode,
              },
            });

            await logAuditEvent(supabase, 'payout_completed', 'payout', payoutRecord.id, {
              transfer_code: transferCode,
              recipient_id:  payoutRecord.recipient_id,
              cycle_number:  payoutRecord.cycle_number,
              group_id:      payoutRecord.related_group_id,
            }, payoutRecord.recipient_id);

            console.log(`[paystack-webhook] Payout ${payoutRecord.id} marked as completed`);
          }
        } else {
          console.warn(`[paystack-webhook] No payout found for transfer_code: ${transferCode}`);
        }

        result = { success: true, status: 'transfer_success_processed' };
        break;
      }

      case 'transfer.failed': {
        // Payout transfer failed — revert payout to pending for retry
        const failedTransferEventData = event.data as unknown as PaystackTransferWebhookData;
        const failedTransferCode = failedTransferEventData.transfer_code ?? failedTransferEventData.reference;
        const failureReason = failedTransferEventData.reason ?? event.data.gateway_response;

        const { data: failedPayout } = await supabase
          .from('payouts')
          .select('id, recipient_id, cycle_number, related_group_id')
          .eq('payment_reference', failedTransferCode)
          .single();

        if (failedPayout) {
          // Revert payout status to pending for retry
          await supabase
            .from('payouts')
            .update({
              status: 'pending',
              notes: `Transfer failed: ${failureReason}`,
              payment_reference: null,
            })
            .eq('id', failedPayout.id);

          // Update the matching payout transaction to failed using payout_id in metadata
          await supabase
            .from('transactions')
            .update({ status: 'failed' })
            .contains('metadata', { payout_id: failedPayout.id })
            .eq('type', 'payout');

          // Notify recipient about the failed payout
          await supabase.rpc('send_payment_notification', {
            p_user_id: failedPayout.recipient_id,
            p_type: 'payout_processed',
            p_title: 'Payout failed',
            p_message: 'Your payout could not be processed. Our team will retry automatically.',
            p_metadata: {
              payout_id: failedPayout.id,
              cycle_number: failedPayout.cycle_number,
              group_id: failedPayout.related_group_id,
              reason: failureReason,
            },
          });

          await logAuditEvent(supabase, 'payout_transfer_failed', 'payout', failedPayout.id, {
            transfer_code: failedTransferCode,
            reason: failureReason,
            recipient_id: failedPayout.recipient_id,
            cycle_number: failedPayout.cycle_number,
            group_id: failedPayout.related_group_id,
          }, failedPayout.recipient_id);

          console.log(`[paystack-webhook] Payout ${failedPayout.id} reverted to pending after transfer failure`);
        } else {
          console.warn(`[paystack-webhook] No payout found for failed transfer_code: ${failedTransferCode}`);
        }

        result = { success: true, status: 'transfer_failure_processed' };
        break;
      }
      
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
