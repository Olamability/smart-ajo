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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours (86400 seconds)
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
  console.log(`Verifying payment with Paystack: ${reference}`);
  
  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
  
  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);
    console.log(`Paystack API response status: ${response.status}`);

    if (!response.ok) {
      let errorMessage = 'Paystack verification failed';
      try {
        const error = await response.json();
        errorMessage = error.message || errorMessage;
        console.error('Paystack API error:', error);
      } catch (parseError) {
        const text = await response.text();
        console.error('Paystack API error (non-JSON):', text);
        console.error('Parse error:', parseError);
        errorMessage = `HTTP ${response.status}: ${text || errorMessage}`;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log(`Paystack verification result - status: ${result.status}, data.status: ${result.data?.status}`);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Handle abort/timeout
    if (error.name === 'AbortError') {
      console.error('Paystack API request timed out after 30 seconds');
      throw new Error('Payment verification timed out. Please try again.');
    }
    
    throw error;
  }
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
    case 'group_creation':
    case 'group_join':
      // These payment types are handled by separate RPC functions
      // (process_group_creation_payment and process_group_join_payment)
      // after verification, so we just acknowledge the verification here
      return {
        success: true,
        message: 'Payment verified successfully',
      };
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
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    // Verify authentication - extract JWT token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized',
          message: 'Authentication required. Please ensure you are logged in.',
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get Supabase configuration
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase configuration missing');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create a Supabase client with the auth header to verify user
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Verify the user is authenticated
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    
    if (authError || !user) {
      console.error('Authentication failed:', authError?.message || 'No user found');
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized',
          message: 'Invalid or expired authentication token. Please log in again.',
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Request from authenticated user: ${user.id}`);

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

    console.log('===== PAYMENT VERIFICATION START =====');
    console.log('Reference:', reference);
    console.log('Timestamp:', new Date().toISOString());

    // Step 1: Verify with Paystack
    let verificationResponse: PaystackVerificationResponse;
    try {
      verificationResponse = await verifyWithPaystack(reference, paystackSecret);
    } catch (error) {
      console.error('Paystack verification failed:', error);
      console.error('Error type:', error.constructor.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      
      return new Response(
        JSON.stringify({
          success: false,
          payment_status: 'verification_failed',
          verified: false,
          amount: 0,
          message: 'Payment verification failed with Paystack',
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
      console.error('Invalid Paystack response:', JSON.stringify(verificationResponse));
      return new Response(
        JSON.stringify({
          success: false,
          payment_status: 'invalid_response',
          verified: false,
          amount: 0,
          message: verificationResponse.message || 'Invalid response from payment gateway',
          error: 'Invalid response from payment gateway',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('Paystack verification successful');
    console.log('Payment status:', verificationResponse.data.status);
    console.log('Payment amount:', verificationResponse.data.amount);

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 2: Store payment record
    console.log('Storing payment record...');
    const storeResult = await storePaymentRecord(supabase, verificationResponse.data);
    console.log('Store result:', storeResult);
    
    if (!storeResult.success) {
      console.error('Failed to store payment record:', storeResult.message);
      return new Response(
        JSON.stringify({
          success: false,
          payment_status: verificationResponse.data.status,
          verified: verificationResponse.data.status === 'success',
          amount: verificationResponse.data.amount,
          message: storeResult.message,
          error: storeResult.message,
          data: {
            reference: verificationResponse.data.reference,
            amount: verificationResponse.data.amount,
            currency: verificationResponse.data.currency,
            channel: verificationResponse.data.channel,
            paid_at: verificationResponse.data.paid_at,
          },
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
      console.log('Executing business logic...');
      businessLogicResult = await executeBusinessLogic(supabase, verificationResponse.data);
      console.log('Business logic result:', businessLogicResult);
    } else {
      console.log('Payment not successful, skipping business logic. Status:', verificationResponse.data.status);
    }

    console.log('===== PAYMENT VERIFICATION END =====');

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
    console.error('===== VERIFICATION ERROR =====');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('===== END ERROR =====');
    
    return new Response(
      JSON.stringify({
        success: false,
        payment_status: 'error',
        verified: false,
        amount: 0,
        message: 'Internal server error during verification',
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
