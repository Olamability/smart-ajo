/**
 * Payment Verification Edge Function
 * 
 * This function verifies payments with Paystack and updates the database.
 * It follows the mandatory verification flow from "Paystack steup.md":
 * 
 * 1. Backend MUST verify every payment using GET /transaction/verify/:reference
 * 2. Only after status = success AND verified = true, execute business logic
 * 3. Frontend success callback does NOT equal payment success
 * 
 * Security:
 * - Uses Paystack SECRET key (never exposed to frontend)
 * - Service role for database updates
 * - Idempotent (safe to call multiple times)
 * 
 * Usage:
 * POST /verify-payment
 * Body: { "reference": "payment_reference" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VerifyPaymentRequest {
  reference: string;
}

interface PaystackVerificationResponse {
  status: boolean;
  message: string;
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
    metadata: any;
    fees: number;
    customer: {
      id: number;
      first_name: string | null;
      last_name: string | null;
      email: string;
      customer_code: string;
      phone: string | null;
      metadata: any;
    };
    authorization: {
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
      signature: string;
    };
    transaction_date: string;
  };
}

/**
 * Verify payment with Paystack API
 */
async function verifyWithPaystack(
  reference: string,
  secretKey: string
): Promise<PaystackVerificationResponse> {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${reference}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Paystack verification failed');
  }

  return await response.json();
}

/**
 * Store or update payment record in database
 */
async function storePaymentRecord(
  supabase: any,
  paystackData: PaystackVerificationResponse['data']
): Promise<{ success: boolean; message: string }> {
  const paymentData = {
    reference: paystackData.reference,
    user_id: paystackData.metadata?.user_id,
    amount: paystackData.amount,
    currency: paystackData.currency,
    status: paystackData.status,
    email: paystackData.customer.email,
    channel: paystackData.channel,
    authorization_code: paystackData.authorization?.authorization_code || null,
    customer_code: paystackData.customer.customer_code,
    gateway_response: paystackData.gateway_response,
    fees: paystackData.fees || 0,
    paid_at: paystackData.paid_at,
    verified: paystackData.status === 'success',
    metadata: paystackData.metadata || {},
    paystack_id: paystackData.id,
    domain: paystackData.domain,
    updated_at: new Date().toISOString(),
  };

  // Check if payment already exists (idempotency)
  const { data: existing, error: existingError } = await supabase
    .from('payments')
    .select('id, verified, status')
    .eq('reference', paystackData.reference)
    .maybeSingle();

  if (existingError) {
    console.error('Error checking existing payment:', existingError);
    return {
      success: false,
      message: 'Failed to check payment status',
    };
  }

  if (existing) {
    // Payment exists - update it only if not already verified
    if (existing.verified && existing.status === 'success') {
      return {
        success: true,
        message: 'Payment already verified',
      };
    }

    const { error } = await supabase
      .from('payments')
      .update(paymentData)
      .eq('reference', paystackData.reference);

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
    message: 'Payment record saved successfully',
  };
}

/**
 * Execute business logic based on payment type
 */
async function executeBusinessLogic(
  supabase: any,
  paystackData: PaystackVerificationResponse['data']
): Promise<{ success: boolean; message: string }> {
  const metadata = paystackData.metadata || {};
  const paymentType = metadata.type;

  if (!paymentType) {
    return {
      success: false,
      message: 'Payment type not specified in metadata',
    };
  }

  switch (paymentType) {
    case 'contribution':
      return await processContributionPayment(supabase, paystackData);
    case 'security_deposit':
      return await processSecurityDeposit(supabase, paystackData);
    default:
      return {
        success: false,
        message: `Unknown payment type: ${paymentType}`,
      };
  }
}

/**
 * Process contribution payment
 */
async function processContributionPayment(
  supabase: any,
  data: PaystackVerificationResponse['data']
): Promise<{ success: boolean; message: string }> {
  const { reference, amount, metadata } = data;
  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;
  const cycleNumber = metadata?.cycle_number;

  if (!userId || !groupId || cycleNumber === undefined) {
    return { success: false, message: 'Missing required metadata for contribution' };
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
  }

  return { success: true, message: 'Contribution payment processed successfully' };
}

/**
 * Process security deposit payment
 */
async function processSecurityDeposit(
  supabase: any,
  data: PaystackVerificationResponse['data']
): Promise<{ success: boolean; message: string }> {
  const { reference, amount, metadata } = data;
  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;

  if (!userId || !groupId) {
    return { success: false, message: 'Missing required metadata for security deposit' };
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
  }

  return { success: true, message: 'Security deposit payment processed successfully' };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get Paystack secret key
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

    // Parse request body
    const body: VerifyPaymentRequest = await req.json();
    const { reference } = body;

    if (!reference) {
      return new Response(
        JSON.stringify({ error: 'Payment reference is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('Verifying payment:', reference);

    // Step 1: Verify with Paystack
    let verificationResponse: PaystackVerificationResponse;
    try {
      verificationResponse = await verifyWithPaystack(reference, paystackSecret);
    } catch (error) {
      console.error('Paystack verification failed:', error);
      return new Response(
        JSON.stringify({
          error: 'Payment verification failed',
          details: error.message,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!verificationResponse.status || !verificationResponse.data) {
      return new Response(
        JSON.stringify({
          error: 'Invalid response from payment gateway',
          message: verificationResponse.message,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 2: Store payment record
    const storeResult = await storePaymentRecord(supabase, verificationResponse.data);
    if (!storeResult.success) {
      return new Response(
        JSON.stringify({
          error: storeResult.message,
          payment_status: verificationResponse.data.status,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 3: Execute business logic only if payment was successful and verified
    let businessLogicResult = { success: true, message: 'No business logic needed' };
    
    if (verificationResponse.data.status === 'success') {
      businessLogicResult = await executeBusinessLogic(supabase, verificationResponse.data);
    }

    // Return combined result
    return new Response(
      JSON.stringify({
        success: verificationResponse.data.status === 'success' && businessLogicResult.success,
        payment_status: verificationResponse.data.status,
        verified: verificationResponse.data.status === 'success',
        amount: verificationResponse.data.amount,
        message: businessLogicResult.message,
        data: {
          reference: verificationResponse.data.reference,
          amount: verificationResponse.data.amount,
          currency: verificationResponse.data.currency,
          channel: verificationResponse.data.channel,
          paid_at: verificationResponse.data.paid_at,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Verification error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
