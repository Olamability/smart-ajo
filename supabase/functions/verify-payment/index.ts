/**
 * Payment Verification Edge Function
 * 
 * This function implements Paystack's mandatory verification flow:
 * 
 * ✅ WHAT THIS FUNCTION DOES:
 * 1. Verifies payment with Paystack API using GET /transaction/verify/:reference
 * 2. Stores payment record in the 'payments' table
 * 3. Returns verification status to frontend
 * 
 * ❌ WHAT THIS FUNCTION DOES NOT DO:
 * - Does NOT execute any business logic
 * - Does NOT update contributions table
 * - Does NOT update group_members table
 * - Does NOT create transactions
 * 
 * 🔄 WHERE BUSINESS LOGIC HAPPENS:
 * ALL business logic is executed exclusively in the paystack-webhook function.
 * The webhook is the single source of truth for payment processing because:
 * - Webhook is guaranteed to be called by Paystack even if user closes browser
 * - Webhook prevents race conditions and duplicate processing
 * - Webhook ensures payments are processed even if network fails during frontend callback
 * 
 * Security:
 * - Uses Paystack SECRET key (never exposed to frontend)
 * - Requires user authentication
 * - Idempotent (safe to call multiple times)
 * 
 * Usage:
 * POST /verify-payment
 * Body: { "reference": "payment_reference" }
 * Headers: { "Authorization": "Bearer <user_token>" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Constants
const FIRST_CYCLE_NUMBER = 1;

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
 * ALL business logic MUST be executed here on the backend
 */
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
    console.log('=== AUTH CHECK START ===');
    console.log('Authorization header present:', !!authHeader);
    console.log('Authorization header format valid:', authHeader?.startsWith('Bearer ') || false);
    console.log('Timestamp:', new Date().toISOString());
    
    if (!authHeader) {
      console.error('CRITICAL: Missing authorization header');
      console.error('Available request headers:', Array.from(req.headers.entries()).map(([k]) => k).join(', '));
      console.error('This suggests the frontend did not pass the Authorization header');
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized',
          message: 'Authentication required. Please ensure you are logged in.',
          details: 'No Authorization header provided in request',
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get Supabase configuration
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    console.log('Supabase URL configured:', !!supabaseUrl);
    console.log('Anon key configured:', !!supabaseAnonKey);
    console.log('Service key configured:', !!supabaseServiceKey);
    
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error('Supabase configuration missing');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract JWT token from Authorization header for format validation
    // Note: We don't pass this to auth.getUser() - the client uses the header directly
    const jwt = authHeader.replace('Bearer ', '');
    console.log('JWT token extracted for validation. Length:', jwt.length);
    
    // JWT format validation - must have exactly 3 parts (header.payload.signature)
    if (!jwt || jwt.length < 20 || jwt.split('.').length !== 3) {
      console.error('Invalid JWT format detected. Parts:', jwt.split('.').length);
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized',
          message: 'Invalid authentication token format.',
          details: 'Token does not appear to be a valid JWT',
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create a Supabase client with anon key and user JWT for authentication
    // The client will use the Authorization header passed in global config
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    
    // Verify the JWT token is valid with detailed error handling
    let user;
    let authError;
    
    try {
      console.log('Verifying JWT with Supabase auth...');
      // Call getUser() without passing JWT - it will use the Authorization header
      const result = await supabaseAuth.auth.getUser();
      user = result.data?.user;
      authError = result.error;
      
      console.log('Auth verification result:', {
        hasUser: !!user,
        hasError: !!authError,
        errorMessage: authError?.message,
        errorStatus: authError?.status,
        userId: user?.id
      });
    } catch (err) {
      const STACK_TRACE_LIMIT = 200;
      console.error('Exception during auth verification:', err);
      console.error('Exception details:', {
        name: err?.name,
        message: err?.message,
        stack: err?.stack?.substring(0, STACK_TRACE_LIMIT)
      });
      authError = { message: 'Auth verification exception', details: err };
    }
    
    if (authError || !user) {
      // Log detailed error server-side only
      console.error('Authentication failed:', authError?.message || 'No user found');
      console.error('Auth error details:', JSON.stringify(authError, null, 2));
      console.error('=== AUTH CHECK FAILED ===');
      
      // Provide more specific error messages based on the error
      let errorMessage = 'Invalid or expired authentication token. Please log in again.';
      let errorDetails = 'Authentication verification failed. Your session may have expired.';
      
      if (authError?.message?.toLowerCase().includes('expired')) {
        errorMessage = 'Your session has expired. Please log in again.';
        errorDetails = 'JWT token has expired';
      } else if (authError?.message?.toLowerCase().includes('invalid')) {
        errorMessage = 'Invalid authentication token. Please log in again.';
        errorDetails = 'JWT token is invalid or malformed';
      }
      
      // Return generic error to client (don't expose auth details)
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized',
          message: errorMessage,
          details: errorDetails,
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Request from authenticated user: ${user.id}`);
    console.log('=== AUTH CHECK PASSED ===');

    // Create a separate Supabase client with service role for privileged database operations
    // This client is used ONLY for database operations, not for authentication
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('Service role client created for database operations');

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

    // Step 2: Store payment record (MANDATORY per spec)
    // This is the ONLY action we take - business logic is handled by webhook
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

    // ✅ IMPORTANT: Business logic is NOT executed here
    // All business logic (updating contributions, group_members, transactions)
    // is handled exclusively by the paystack-webhook function.
    // This ensures webhook is the single source of truth for payment processing.
    console.log('Payment verified and stored. Business logic will be processed by webhook.');
    console.log('===== PAYMENT VERIFICATION END =====');

    // Return verification result - webhook will handle business logic
    return new Response(
      JSON.stringify({
        success: verificationResponse.data.status === 'success',
        payment_status: verificationResponse.data.status,
        verified: verificationResponse.data.status === 'success',
        amount: verificationResponse.data.amount,
        message: verificationResponse.data.status === 'success' 
          ? 'Payment verified successfully. Processing in progress via webhook.' 
          : 'Payment verification completed',
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
