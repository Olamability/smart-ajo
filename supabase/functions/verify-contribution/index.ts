/**
 * Verify Contribution Payment Edge Function
 *
 * Endpoint: /verify-contribution
 *
 * Securely verifies a Paystack contribution payment and updates all
 * relevant records in the database.
 *
 * Flow:
 * 1. Receive payment reference from frontend
 * 2. Verify payment with Paystack API using secret key
 * 3. If payment status is success:
 *    - Save transaction (mark as completed)
 *    - Mark contribution as paid
 *    - Update group balance (total_collected)
 * 4. If payment failed: return error
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Paystack amounts are denominated in kobo (smallest NGN unit); 100 kobo = 1 naira */
const KOBO_TO_NAIRA_DIVISOR = 100;

interface PaystackVerificationResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    domain: string;
    status: 'success' | 'failed' | 'abandoned';
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
      contributionId?: string;
      [key: string]: unknown;
    };
    customer: {
      id: number;
      email: string;
      customer_code: string;
    };
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Contribution verification request received');

    // Get Paystack secret key from environment
    const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecretKey) {
      console.error('PAYSTACK_SECRET_KEY not configured');
      throw new Error('Paystack secret key not configured');
    }

    // Get Supabase credentials from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase credentials not configured');
      throw new Error('Supabase credentials not configured');
    }

    // Parse request body — only `reference` is required
    const body = await req.json();
    const { reference } = body;

    if (!reference) {
      console.error('Payment reference not provided');
      return new Response(
        JSON.stringify({ success: false, error: 'Payment reference is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Verifying contribution payment with reference: ${reference}`);

    // Step 2: Call Paystack verification API
    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!paystackResponse.ok) {
      const errorData = await paystackResponse.json();
      console.error('Paystack verification request failed:', JSON.stringify(errorData));
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Payment verification failed with Paystack',
          details: errorData,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const verificationData: PaystackVerificationResponse = await paystackResponse.json();
    console.log(`Paystack verification response — status: ${verificationData.data.status}`);

    // Step 4: If failed — return error
    if (!verificationData.status || verificationData.data.status !== 'success') {
      console.error(`Payment not successful — status: ${verificationData.data.status}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Payment was not successful',
          paymentStatus: verificationData.data.status,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const paymentData = verificationData.data;
    const metadata = paymentData.metadata || {};
    const userId = metadata.userId;
    const groupId = metadata.groupId;
    const contributionId = metadata.contributionId;

    // Validate that this is a contribution payment
    if (metadata.paymentType && metadata.paymentType !== 'contribution') {
      console.error(`Invalid payment type for verify-contribution: ${metadata.paymentType}`);
      return new Response(
        JSON.stringify({ success: false, error: 'This endpoint only handles contribution payments' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!userId || !groupId) {
      console.error('Invalid payment metadata — missing userId or groupId');
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid payment metadata' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!contributionId) {
      console.error('Contribution ID missing in metadata');
      return new Response(
        JSON.stringify({ success: false, error: 'Contribution ID is required for contribution payment' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with service role key (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Idempotency check: if the transaction is already completed, return success immediately
    const { data: existingTransaction } = await supabase
      .from('transactions')
      .select('status')
      .eq('reference', reference)
      .single();

    if (existingTransaction?.status === 'completed') {
      console.log(`Contribution payment ${reference} already processed — returning cached success`);
      return new Response(
        JSON.stringify({
          success: true,
          verified: true,
          data: { reference, alreadyProcessed: true },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3a: Save transaction — update transaction record to 'completed'
    console.log('Updating transaction record to completed');
    const { error: transactionUpdateError } = await supabase
      .from('transactions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        metadata: {
          ...metadata,
          verification: {
            paystack_response: paymentData,
            verified_at: new Date().toISOString(),
          },
        },
      })
      .eq('reference', reference);

    if (transactionUpdateError) {
      console.error('Error updating transaction record:', JSON.stringify(transactionUpdateError));
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update transaction record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Transaction record updated successfully');

    // Step 3b: Mark contribution as paid
    console.log(`Updating contribution ${contributionId} to paid`);
    const { error: contributionError } = await supabase
      .from('contributions')
      .update({
        status: 'paid',
        paid_date: new Date().toISOString(),
        transaction_ref: reference,
      })
      .eq('id', contributionId)
      .eq('user_id', userId); // Extra safety check: only update own contribution

    if (contributionError) {
      console.error('Error updating contribution:', JSON.stringify(contributionError));
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to mark contribution as paid' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Contribution marked as paid successfully');

    // Step 3c: Update group balance (total_collected)
    // Increment the group's total_collected by the contribution amount (converted from kobo to naira)
    const contributionAmountNaira = paymentData.amount / KOBO_TO_NAIRA_DIVISOR;
    console.log(`Incrementing group ${groupId} total_collected by ${contributionAmountNaira}`);

    const { error: balanceUpdateError } = await supabase.rpc('increment_group_total_collected', {
      p_group_id: groupId,
      p_amount: contributionAmountNaira,
    });

    if (balanceUpdateError) {
      console.error('Error updating group balance via RPC:', JSON.stringify(balanceUpdateError));
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update group balance' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Group total_collected incremented via RPC');

    // Return success response
    console.log('Contribution payment verification completed successfully');
    return new Response(
      JSON.stringify({
        success: true,
        verified: true,
        data: {
          reference: paymentData.reference,
          amount: contributionAmountNaira,
          status: paymentData.status,
          paidAt: paymentData.paid_at,
          contributionId,
          groupId,
          userId,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in contribution verification:', error);
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
