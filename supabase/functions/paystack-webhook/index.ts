/**
 * Paystack Webhook Handler
 * 
 * This Edge Function handles Paystack payment webhooks.
 * 
 * This acts as a BACKUP/SECONDARY payment processor. The PRIMARY processor
 * is the verify-payment Edge Function which executes business logic immediately.
 * 
 * Webhooks ensure payments are processed even if:
 * - User closes browser before verification completes
 * - Network fails during frontend callback
 * - verify-payment Edge Function fails temporarily
 * 
 * Business logic is idempotent - safe to execute multiple times.
 * 
 * Handles events:
 * - charge.success: Successful payments
 * - charge.failed: Failed payments
 * - transfer.success: Successful transfers (payouts)
 * - refund.processed: Processed refunds
 * 
 * Security:
 * - Validates Paystack signature using HMAC SHA512
 * - Only processes verified webhooks
 * - Uses service role for database updates
 * - Implements idempotency to handle duplicate events
 * 
 * Storage:
 * - Stores complete payment data in 'payments' table
 * - Updates business logic tables (contributions, group_members)
 * - Creates transaction records for audit trail
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processGroupCreationPayment, processGroupJoinPayment } from "../_shared/payment-processor.ts";

// Constants
const FIRST_CYCLE_NUMBER = 1;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-paystack-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
};

interface PaystackEvent {
  event: string;
  data: {
    id: number;
    domain: string;
    reference: string;
    amount: number;
    currency: string;
    status: string;
    paid_at: string;
    created_at: string;
    channel: string;
    gateway_response: string;
    fees?: number;
    customer: {
      email: string;
      customer_code: string;
      id: number;
    };
    authorization?: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      channel: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable: boolean;
    };
    metadata?: {
      type?: string;
      user_id?: string;
      group_id?: string;
      cycle_number?: number;
      contribution_id?: string;
      app?: string;
      purpose?: string;
      entity_id?: string;
    };
  };
}

/**
 * Verify Paystack webhook signature using Web Crypto API
 */
async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(payload);
    
    // Import the key for HMAC-SHA512
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );
    
    // Generate the HMAC signature
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData);
    
    // Convert to hex string
    const hash = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return hash === signature;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Store payment data in payments table (MANDATORY per spec)
 * Implements idempotency - safe to call multiple times
 */
async function storePaymentRecord(
  supabase: any,
  data: PaystackEvent['data']
): Promise<{ success: boolean; message: string }> {
  const paymentData = {
    reference: data.reference,
    user_id: data.metadata?.user_id || null,
    amount: data.amount, // Already in kobo from Paystack
    currency: data.currency,
    status: data.status,
    email: data.customer.email,
    channel: data.channel,
    authorization_code: data.authorization?.authorization_code || null,
    customer_code: data.customer.customer_code,
    gateway_response: data.gateway_response,
    fees: data.fees || 0,
    paid_at: data.paid_at || null,
    verified: data.status === 'success',
    metadata: data.metadata || {},
    paystack_id: data.id,
    domain: data.domain,
    updated_at: new Date().toISOString(),
  };

  // Check if payment already exists (idempotency for duplicate webhooks)
  const { data: existing, error: existingError } = await supabase
    .from('payments')
    .select('id, verified, status')
    .eq('reference', data.reference)
    .maybeSingle();

  if (existingError) {
    console.error('Error checking existing payment:', existingError);
    return {
      success: false,
      message: 'Failed to check payment status',
    };
  }

  if (existing) {
    // Payment exists - update it only if status changed
    if (existing.verified && existing.status === 'success') {
      console.log('Payment already processed:', data.reference);
      return {
        success: true,
        message: 'Payment already verified (duplicate webhook)',
      };
    }

    const { error } = await supabase
      .from('payments')
      .update(paymentData)
      .eq('reference', data.reference);

    if (error) {
      console.error('Failed to update payment:', error);
      return {
        success: false,
        message: 'Failed to update payment record',
      };
    }
  } else {
    // New payment - insert it
    const { error } = await supabase
      .from('payments')
      .insert(paymentData);

    if (error) {
      console.error('Failed to insert payment:', error);
      return {
        success: false,
        message: 'Failed to create payment record',
      };
    }
  }

  return {
    success: true,
    message: 'Payment record stored successfully',
  };
}

/**
 * Process contribution payment
 */
async function processContributionPayment(
  supabase: any,
  data: PaystackEvent['data']
): Promise<{ success: boolean; message: string }> {
  const { reference, amount, metadata, status } = data;

  // Verify payment was successful
  if (status !== 'success') {
    return { success: false, message: 'Payment not successful' };
  }

  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;
  const cycleNumber = metadata?.cycle_number;

  if (!userId || !groupId || !cycleNumber) {
    return { success: false, message: 'Missing required metadata' };
  }

  // Find the contribution record
  const { data: contribution, error: findError } = await supabase
    .from('contributions')
    .select('*')
    .eq('user_id', userId)
    .eq('group_id', groupId)
    .eq('cycle_number', cycleNumber)
    .maybeSingle();

  if (findError || !contribution) {
    console.error('Contribution not found:', findError);
    return { success: false, message: 'Contribution not found' };
  }

  // Check if already processed (idempotency)
  if (contribution.status === 'paid' && contribution.transaction_ref === reference) {
    console.log('Contribution already processed for reference:', reference);
    return { success: true, message: 'Contribution payment already processed (duplicate webhook)' };
  }

  // Update contribution status
  const { error: updateError } = await supabase
    .from('contributions')
    .update({
      status: 'paid',
      paid_date: new Date(data.paid_at).toISOString(),
      transaction_ref: reference,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contribution.id);

  if (updateError) {
    console.error('Failed to update contribution:', updateError);
    return { success: false, message: 'Failed to update contribution' };
  }

  // Create transaction record
  const { error: txError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      group_id: groupId,
      type: 'contribution',
      amount: amount / 100, // Convert from kobo to Naira
      status: 'completed',
      reference: reference,
      payment_method: 'paystack',
      metadata: {
        paystack_id: data.id,
        contribution_id: contribution.id,
        cycle_number: cycleNumber,
      },
    });

  if (txError) {
    console.error('Failed to create transaction:', txError);
    // Don't fail the webhook if transaction creation fails
  }

  return { success: true, message: 'Contribution payment processed successfully' };
}

/**
 * Process security deposit payment
 */
async function processSecurityDeposit(
  supabase: any,
  data: PaystackEvent['data']
): Promise<{ success: boolean; message: string }> {
  const { reference, amount, metadata, status } = data;

  // Verify payment was successful
  if (status !== 'success') {
    return { success: false, message: 'Payment not successful' };
  }

  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;

  if (!userId || !groupId) {
    return { success: false, message: 'Missing required metadata' };
  }

  // Check if already processed (idempotency)
  const { data: existingMember } = await supabase
    .from('group_members')
    .select('has_paid_security_deposit')
    .eq('user_id', userId)
    .eq('group_id', groupId)
    .maybeSingle();

  if (existingMember?.has_paid_security_deposit) {
    console.log('Security deposit already processed for reference:', reference);
    return { success: true, message: 'Security deposit already processed (duplicate webhook)' };
  }

  // Update group_members record
  const { error: updateError } = await supabase
    .from('group_members')
    .update({
      has_paid_security_deposit: true,
      security_deposit_payment_ref: reference,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('group_id', groupId);

  if (updateError) {
    console.error('Failed to update security deposit:', updateError);
    return { success: false, message: 'Failed to update security deposit' };
  }

  // Create transaction record
  const { error: txError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      group_id: groupId,
      type: 'security_deposit',
      amount: amount / 100, // Convert from kobo to Naira
      status: 'completed',
      reference: reference,
      payment_method: 'paystack',
      metadata: {
        paystack_id: data.id,
      },
    });

  if (txError) {
    console.error('Failed to create transaction:', txError);
    // Don't fail the webhook if transaction creation fails
  }

  return { success: true, message: 'Security deposit payment processed successfully' };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    // Get Paystack secret key from environment
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) {
      console.error('PAYSTACK_SECRET_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get request body as text for signature verification
    const rawBody = await req.text();
    
    // Verify webhook signature
    const signature = req.headers.get('x-paystack-signature');
    if (!signature) {
      console.error('No signature provided');
      return new Response(
        JSON.stringify({ error: 'No signature provided' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const isValid = await verifySignature(rawBody, signature, paystackSecret);
    if (!isValid) {
      console.error('Invalid signature');
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse the webhook payload
    const event: PaystackEvent = JSON.parse(rawBody);

    console.log('Received Paystack event:', event.event, 'reference:', event.data.reference);

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: ALWAYS store payment record first (MANDATORY per spec)
    const storeResult = await storePaymentRecord(supabase, event.data);
    if (!storeResult.success) {
      console.error('Failed to store payment:', storeResult.message);
      // Continue processing but log the error
    }

    // Step 2: Process payment based on event type
    let result = { success: false, message: 'Event not processed' };

    switch (event.event) {
      case 'charge.success': {
        const paymentType = event.data.metadata?.type;
        
        console.log('Processing charge.success event');
        console.log('Payment type:', paymentType);
        console.log('Metadata:', JSON.stringify(event.data.metadata, null, 2));

        if (paymentType === 'contribution') {
          result = await processContributionPayment(supabase, event.data);
        } else if (paymentType === 'security_deposit') {
          result = await processSecurityDeposit(supabase, event.data);
        } else if (paymentType === 'group_creation') {
          result = await processGroupCreationPayment(supabase, event.data);
        } else if (paymentType === 'group_join') {
          result = await processGroupJoinPayment(supabase, event.data);
        } else {
          console.error('Unknown payment type received:', paymentType);
          console.error('Full metadata:', event.data.metadata);
          result = { 
            success: false, 
            message: `Unknown payment type: ${paymentType}. Expected one of: contribution, security_deposit, group_creation, group_join` 
          };
        }
        break;
      }

      case 'charge.failed': {
        // Payment failed - update payment status
        console.log('Payment failed:', event.data.reference);
        result = { 
          success: true, 
          message: 'Payment failure recorded' 
        };
        break;
      }

      case 'transfer.success': {
        // Transfer successful (payout)
        console.log('Transfer successful:', event.data.reference);
        result = { 
          success: true, 
          message: 'Transfer success recorded' 
        };
        break;
      }

      case 'refund.processed': {
        // Refund processed
        console.log('Refund processed:', event.data.reference);
        result = { 
          success: true, 
          message: 'Refund recorded' 
        };
        break;
      }

      default: {
        console.log('Unhandled event type:', event.event);
        result = { 
          success: true, 
          message: 'Event received but not processed' 
        };
      }
    }

    return new Response(
      JSON.stringify({
        ...result,
        payment_stored: storeResult.success,
      }),
      {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Webhook processing error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
