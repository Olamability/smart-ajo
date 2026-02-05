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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
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
      [key: string]: any;
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

/**
 * Process payment success event
 */
async function processPaymentSuccess(
  supabase: any,
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
    // Add or update user as group member with selected slot
    const { error: memberError } = await supabase
      .from('group_members')
      .upsert(
        {
          group_id: groupId,
          user_id: userId,
          rotation_position: slotNumber,
          status: 'active',
          payment_status: 'paid',
          has_paid_security_deposit: true,
        },
        {
          onConflict: 'group_id,user_id',
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
        .eq('group_id', groupId);
    }
  } else if (paymentType === 'contribution') {
    // Record contribution payment
    const cycleId = metadata?.cycleId;
    
    if (!cycleId) {
      return { success: false, error: 'Cycle ID required for contribution payment' };
    }

    const { error: contributionError } = await supabase
      .from('contributions')
      .insert({
        group_id: groupId,
        cycle_id: cycleId,
        user_id: userId,
        amount: amount / 100, // Convert from kobo to naira
        payment_reference: reference,
        status: 'paid',
      });

    if (contributionError) {
      console.error('Error recording contribution:', contributionError);
      return { success: false, error: 'Failed to record contribution' };
    }

    // Check if all members have contributed for this cycle
    const { data: cycleData } = await supabase
      .from('contribution_cycles')
      .select('*, groups!inner(total_members)')
      .eq('id', cycleId)
      .single();

    if (cycleData) {
      const { data: contributionsData } = await supabase
        .from('contributions')
        .select('id')
        .eq('cycle_id', cycleId)
        .eq('status', 'paid');

      const totalContributions = contributionsData?.length || 0;
      const requiredContributions = cycleData.groups.total_members;

      if (totalContributions >= requiredContributions) {
        await supabase
          .from('contribution_cycles')
          .update({ status: 'completed' })
          .eq('id', cycleId);
      }
    }
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
      
      case 'charge.failed':
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
        
        result = { success: true, status: 'failed_payment_recorded' };
        break;
      
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
