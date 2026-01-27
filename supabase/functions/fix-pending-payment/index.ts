/**
 * Fix Pending Payment Edge Function
 * 
 * This function manually processes payments that are stuck in 'pending' status.
 * It should only be used for payments that are confirmed successful in Paystack.
 * 
 * Usage:
 * POST /fix-pending-payment
 * Body: { "reference": "GRP_CREATE_xxx" }
 * Headers: { "Authorization": "Bearer <service_role_key>" }
 * 
 * This function:
 * 1. Verifies payment with Paystack
 * 2. Updates payment record
 * 3. Executes business logic (creates membership)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processGroupCreationPayment, processGroupJoinPayment } from "../_shared/payment-processor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface FixPaymentRequest {
  reference: string;
  force?: boolean; // If true, skip Paystack verification and just process based on DB data
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // This function requires service role authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.includes('service_role')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - service role required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body: FixPaymentRequest = await req.json();
    const { reference, force = false } = body;

    if (!reference) {
      return new Response(
        JSON.stringify({ error: 'Payment reference is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('=== FIX PENDING PAYMENT START ===');
    console.log('Reference:', reference);
    console.log('Force:', force);

    // Get current payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('reference', reference)
      .maybeSingle();

    if (paymentError || !payment) {
      console.error('Payment not found:', paymentError);
      return new Response(
        JSON.stringify({ error: 'Payment not found', reference }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Current payment status:', {
      status: payment.status,
      verified: payment.verified,
      amount: payment.amount,
      metadata: payment.metadata
    });

    // Check if already processed
    if (payment.verified && payment.status === 'success') {
      console.log('Payment already verified and successful');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Payment already processed',
          payment_status: 'success',
          verified: true
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let paystackStatus = payment.status;
    let shouldProcess = force;

    // Verify with Paystack unless force=true
    if (!force && paystackSecret) {
      console.log('Verifying with Paystack...');
      try {
        const response = await fetch(
          `https://api.paystack.co/transaction/verify/${reference}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${paystackSecret}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.ok) {
          const result = await response.json();
          if (result.status && result.data) {
            paystackStatus = result.data.status;
            console.log('Paystack verification result:', paystackStatus);
            shouldProcess = paystackStatus === 'success';

            // Update payment with Paystack data
            await supabase
              .from('payments')
              .update({
                status: result.data.status,
                verified: result.data.status === 'success',
                paid_at: result.data.paid_at,
                gateway_response: result.data.gateway_response,
                updated_at: new Date().toISOString()
              })
              .eq('reference', reference);
          }
        } else {
          console.warn('Paystack verification failed:', response.status);
        }
      } catch (error) {
        console.error('Paystack verification error:', error);
        // Continue with force processing if Paystack fails
        if (force) {
          shouldProcess = true;
        }
      }
    }

    if (!shouldProcess) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Payment status is '${paystackStatus}', not 'success'. Cannot process.`,
          payment_status: paystackStatus,
          verified: false
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update payment to success/verified
    console.log('Updating payment to success/verified...');
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'success',
        verified: true,
        updated_at: new Date().toISOString()
      })
      .eq('reference', reference);

    if (updateError) {
      console.error('Failed to update payment:', updateError);
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Failed to update payment record',
          error: updateError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Payment updated to success/verified');

    // Execute business logic
    const paymentType = payment.metadata?.type;
    console.log('Payment type:', paymentType);

    let businessLogicResult;

    try {
      const paymentData = {
        reference: payment.reference,
        amount: payment.amount,
        status: 'success',
        metadata: payment.metadata
      };

      if (paymentType === 'group_creation') {
        businessLogicResult = await processGroupCreationPayment(supabase, paymentData);
      } else if (paymentType === 'group_join') {
        businessLogicResult = await processGroupJoinPayment(supabase, paymentData);
      } else {
        console.warn('Unknown payment type:', paymentType);
        businessLogicResult = {
          success: true,
          message: 'Payment updated but no business logic executed for this type'
        };
      }

      console.log('Business logic result:', businessLogicResult);

      if (businessLogicResult.success) {
        console.log('=== FIX PENDING PAYMENT END (SUCCESS) ===');
        return new Response(
          JSON.stringify({
            success: true,
            message: businessLogicResult.message,
            payment_status: 'success',
            verified: true,
            position: businessLogicResult.position
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        console.error('Business logic failed:', businessLogicResult.message);
        return new Response(
          JSON.stringify({
            success: false,
            message: `Payment updated but business logic failed: ${businessLogicResult.message}`,
            payment_status: 'success',
            verified: true,
            error: businessLogicResult.message
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (error) {
      console.error('Business logic error:', error);
      console.error('=== FIX PENDING PAYMENT END (FAILED) ===');
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Payment updated but business logic threw an error',
          payment_status: 'success',
          verified: true,
          error: error.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('=== FIX PENDING PAYMENT ERROR ===');
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Internal server error',
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
