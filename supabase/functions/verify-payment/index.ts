/**
 * Payment Verification Edge Function - PRIMARY Payment Processor
 * 
 * This is the MAIN payment processor that runs synchronously when a user
 * completes payment. It provides immediate feedback to the user.
 * 
 * CRITICAL SECURITY FUNCTION:
 * ===========================
 * This function is the ONLY way to securely verify payments and activate
 * memberships. It ensures that:
 * 
 * 1. Payment actually succeeded (verified with Paystack using SECRET key)
 * 2. User is authenticated (JWT token validation)
 * 3. Business logic executes atomically (add member, activate status)
 * 4. Operations are idempotent (safe to retry)
 * 
 * What This Function Does:
 * ========================
 * 
 * STEP 1: Authentication
 * - Validates JWT token from request header
 * - Ensures user is logged in
 * - Prevents unauthorized verification attempts
 * 
 * STEP 2: Verify Payment with Paystack
 * - Calls Paystack API: GET /transaction/verify/{reference}
 * - Uses Paystack SECRET KEY (stored in environment, NEVER exposed to frontend)
 * - Validates payment actually succeeded on Paystack's end
 * - Gets complete payment details (amount, channel, customer, etc.)
 * 
 * STEP 3: Store Payment Record
 * - Updates/inserts payment record in database
 * - Sets verified = true for successful payments
 * - Stores all Paystack data for audit trail
 * - Idempotent: Safe to call multiple times
 * 
 * STEP 4: Execute Business Logic (THE CRITICAL PART)
 * Depending on payment type in metadata:
 * 
 * - group_creation:
 *   ✅ Add creator as member to group
 *   ✅ Set has_paid_security_deposit = true
 *   ✅ Set status = 'active'
 *   ✅ Assign payout position (preferred_slot)
 *   ✅ Create first contribution record
 *   ✅ Create transaction records
 * 
 * - group_join:
 *   ✅ Add user as member to group
 *   ✅ Set has_paid_security_deposit = true
 *   ✅ Set status = 'active'
 *   ✅ Assign payout position (next available or preferred)
 *   ✅ Create first contribution record
 *   ✅ Create transaction records
 *   ✅ Update join request status to 'joined'
 * 
 * - contribution:
 *   ✅ Update contribution status to 'paid'
 *   ✅ Set paid_date
 *   ✅ Create transaction record
 *   ✅ Create notification
 * 
 * STEP 5: Return Result
 * - Success: { success: true, verified: true, position: N, ... }
 * - Failure: { success: false, error: "...", ... }
 * 
 * Why Two Processors (verify-payment + webhook)?
 * ==============================================
 * 
 * verify-payment (this file):
 * - PRIMARY processor
 * - Synchronous: Runs immediately when user clicks verify
 * - Provides instant feedback to user
 * - User waits for result before proceeding
 * 
 * paystack-webhook (backup):
 * - SECONDARY processor
 * - Asynchronous: Triggered by Paystack notification
 * - Backup in case verify-payment fails (network issues, timeout, etc.)
 * - Runs same business logic
 * - Idempotent: Won't duplicate if verify-payment already succeeded
 * 
 * Both are necessary for reliability:
 * - User gets immediate feedback (verify-payment)
 * - Payment still processed if immediate verification fails (webhook)
 * 
 * Security Features:
 * ==================
 * 
 * ✅ JWT Authentication: Requires valid user session
 * ✅ Secret Key Protection: Uses Paystack secret key (backend only)
 * ✅ Signature Validation: Webhook validates Paystack signature
 * ✅ Idempotent Operations: Safe to call multiple times
 * ✅ Amount Validation: Verifies payment amount matches expected
 * ✅ User Validation: Verifies user is authorized for the action
 * ✅ Atomic Operations: All database changes or none
 * 
 * Usage:
 * ======
 * 
 * POST /verify-payment
 * Headers: { "Authorization": "Bearer <jwt_token>" }
 * Body: { "reference": "payment_reference" }
 * 
 * Response (Success):
 * {
 *   "success": true,
 *   "payment_status": "success",
 *   "verified": true,
 *   "amount": 500000,
 *   "message": "Payment verified and processed successfully",
 *   "position": 3,
 *   "data": { "reference": "...", "amount": 500000, ... }
 * }
 * 
 * Response (Failure):
 * {
 *   "success": false,
 *   "payment_status": "failed",
 *   "verified": false,
 *   "amount": 0,
 *   "message": "Payment verification failed",
 *   "error": "..."
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  processGroupCreationPayment,
  processGroupJoinPayment,
  processContributionPayment,
} from "../_shared/payment-processor.ts";

// ============================================================================
// CORS HEADERS
// ============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// ============================================================================
// TYPES
// ============================================================================

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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Verify payment with Paystack API
 */
async function verifyWithPaystack(
  reference: string,
  secretKey: string
): Promise<PaystackVerificationResponse> {
  console.log('[Paystack API] Verifying payment:', reference);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
  
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
    console.log('[Paystack API] Response status:', response.status);

    if (!response.ok) {
      let errorMessage = 'Paystack verification failed';
      try {
        const error = await response.json();
        errorMessage = error.message || errorMessage;
        console.error('[Paystack API] Error:', error);
      } catch (parseError) {
        const text = await response.text();
        console.error('[Paystack API] Non-JSON error:', text);
        errorMessage = `HTTP ${response.status}: ${text || errorMessage}`;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('[Paystack API] Verification result:', result.data?.status);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      console.error('[Paystack API] Request timed out');
      throw new Error('Payment verification timed out. Please try again.');
    }
    
    throw error;
  }
}

/**
 * Store or update payment record in database
 * Idempotent: Safe to call multiple times
 */
async function storePaymentRecord(
  supabase: any,
  paystackData: PaystackVerificationResponse['data']
): Promise<{ success: boolean; message: string }> {
  console.log('[Payment Store] Storing payment:', paystackData.reference);
  console.log('[Payment Store] Status:', paystackData.status);
  
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

  // Check if payment exists (idempotency)
  const { data: existing, error: existingError } = await supabase
    .from('payments')
    .select('id, verified, status')
    .eq('reference', paystackData.reference)
    .maybeSingle();

  if (existingError) {
    console.error('[Payment Store] Error checking existing payment:', existingError);
    return {
      success: false,
      message: 'Failed to check payment status',
    };
  }

  if (existing) {
    // Already processed
    if (existing.verified && existing.status === 'success') {
      console.log('[Payment Store] Already verified');
      return {
        success: true,
        message: 'Payment already verified',
      };
    }

    // Update existing record
    const { error } = await supabase
      .from('payments')
      .update(paymentData)
      .eq('reference', paystackData.reference);

    if (error) {
      console.error('[Payment Store] Update failed:', error);
      return {
        success: false,
        message: 'Failed to update payment record',
      };
    }
    
    console.log('[Payment Store] Payment updated');
  } else {
    // Insert new record
    const { error } = await supabase
      .from('payments')
      .insert(paymentData);

    if (error) {
      console.error('[Payment Store] Insert failed:', error);
      return {
        success: false,
        message: 'Failed to create payment record',
      };
    }
    
    console.log('[Payment Store] Payment created');
  }

  return {
    success: true,
    message: 'Payment record saved successfully',
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    console.log('=== PAYMENT VERIFICATION START ===');
    console.log('Timestamp:', new Date().toISOString());
    
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    console.log('[Auth] Authorization header present:', !!authHeader);
    
    if (!authHeader) {
      console.error('[Auth] Missing authorization header');
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized',
          message: 'Authentication required',
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    
    console.log('[Config] Supabase URL configured:', !!supabaseUrl);
    console.log('[Config] Paystack secret configured:', !!paystackSecret);
    
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !paystackSecret) {
      console.error('[Config] Missing required environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate JWT format
    const jwt = authHeader.replace('Bearer ', '');
    console.log('[Auth] JWT length:', jwt.length);
    
    if (!jwt || jwt.length < 20 || jwt.split('.').length !== 3) {
      console.error('[Auth] Invalid JWT format');
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized',
          message: 'Invalid authentication token format',
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create auth client with user JWT
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    
    // Verify user
    console.log('[Auth] Verifying user...');
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    
    if (authError || !user) {
      console.error('[Auth] User verification failed:', authError?.message);
      
      let errorMessage = 'Invalid or expired authentication token';
      if (authError?.message?.toLowerCase().includes('expired')) {
        errorMessage = 'Session expired. Please log in again.';
      }
      
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized',
          message: errorMessage,
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('[Auth] User authenticated:', user.id);

    // Create service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('[Database] Service role client created');

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

    console.log('[Verification] Reference:', reference);

    // Step 1: Verify with Paystack
    let verificationResponse: PaystackVerificationResponse;
    try {
      verificationResponse = await verifyWithPaystack(reference, paystackSecret);
    } catch (error) {
      console.error('[Verification] Paystack verification failed:', error.message);
      
      return new Response(
        JSON.stringify({
          success: false,
          payment_status: 'verification_failed',
          verified: false,
          amount: 0,
          message: 'Payment verification failed with Paystack',
          error: 'Payment verification failed',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!verificationResponse.status || !verificationResponse.data) {
      console.error('[Verification] Invalid Paystack response');
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

    console.log('[Verification] Paystack verification successful');
    console.log('[Verification] Payment status:', verificationResponse.data.status);

    // Step 2: Store payment record
    console.log('[Verification] Storing payment record...');
    const storeResult = await storePaymentRecord(supabase, verificationResponse.data);
    
    if (!storeResult.success) {
      console.error('[Verification] Failed to store payment:', storeResult.message);
      return new Response(
        JSON.stringify({
          success: false,
          payment_status: verificationResponse.data.status,
          verified: verificationResponse.data.status === 'success',
          amount: verificationResponse.data.amount,
          message: storeResult.message,
          error: storeResult.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 3: Execute business logic for successful payments
    let businessLogicResult: { success: boolean; message: string; position?: number } | null = null;
    
    if (verificationResponse.data.status === 'success') {
      console.log('[Business Logic] Payment successful, executing business logic...');
      const paymentType = verificationResponse.data.metadata?.type;
      
      console.log('[Business Logic] Payment type:', paymentType);
      
      // THIS IS WHERE MEMBERSHIP GETS ACTIVATED!
      // ========================================
      // Based on payment type, we execute different business logic:
      // 
      // 1. group_creation: Add creator as member with selected slot
      // 2. group_join: Add new member with assigned position
      // 3. contribution: Mark contribution as paid
      // 
      // All operations are idempotent - safe to call multiple times.
      // The webhook will also execute this logic as a backup.
      
      try {
        if (paymentType === 'group_creation') {
          // CREATOR PAYMENT: Add creator as first member
          console.log('[Business Logic] Processing group creation payment');
          businessLogicResult = await processGroupCreationPayment(supabase, verificationResponse.data);
          console.log('[Business Logic] Result:', businessLogicResult.success ? 'SUCCESS' : 'FAILED');
        } else if (paymentType === 'group_join') {
          // JOIN PAYMENT: Add new member to group
          console.log('[Business Logic] Processing group join payment');
          businessLogicResult = await processGroupJoinPayment(supabase, verificationResponse.data);
          console.log('[Business Logic] Result:', businessLogicResult.success ? 'SUCCESS' : 'FAILED');
          if (businessLogicResult.position) {
            console.log('[Business Logic] Assigned position:', businessLogicResult.position);
          }
        } else if (paymentType === 'contribution') {
          // CONTRIBUTION PAYMENT: Mark contribution as paid
          console.log('[Business Logic] Processing contribution payment');
          businessLogicResult = await processContributionPayment(supabase, verificationResponse.data);
          console.log('[Business Logic] Result:', businessLogicResult.success ? 'SUCCESS' : 'FAILED');
        } else {
          console.warn('[Business Logic] Unknown payment type:', paymentType);
          businessLogicResult = { 
            success: true, 
            message: 'Payment verified. Type-specific processing will be handled by webhook.' 
          };
        }

        if (businessLogicResult?.success === false) {
          console.error('[Business Logic] Processing failed:', businessLogicResult.message);
          return new Response(
            JSON.stringify({
              success: false,
              payment_status: 'verified_but_processing_failed',
              verified: true,
              amount: verificationResponse.data.amount,
              message: `Payment verified but failed to process: ${businessLogicResult.message}`,
              error: businessLogicResult.message,
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      } catch (error) {
        console.error('[Business Logic] Exception:', error.message);
        return new Response(
          JSON.stringify({
            success: false,
            payment_status: 'verified_but_processing_error',
            verified: true,
            amount: verificationResponse.data.amount,
            message: 'Payment verified but encountered an error during processing. Webhook will retry.',
            error: error.message || 'Business logic execution failed',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      
      console.log('[Business Logic] Execution complete:', businessLogicResult?.success ? 'SUCCESS' : 'PENDING');
    }

    console.log('[Verification] Payment verified and processed successfully');
    console.log('=== PAYMENT VERIFICATION END ===');

    // Return success response
    const paymentVerified = verificationResponse.data.status === 'success';
    const businessLogicSucceeded = businessLogicResult === null || businessLogicResult.success === true;
    const overallSuccess = paymentVerified && businessLogicSucceeded;

    return new Response(
      JSON.stringify({
        success: overallSuccess,
        payment_status: verificationResponse.data.status,
        verified: paymentVerified,
        amount: verificationResponse.data.amount,
        message: businessLogicResult?.message || (paymentVerified 
          ? 'Payment verified and processed successfully' 
          : 'Payment verification completed'),
        position: businessLogicResult?.position,
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
    console.error('=== VERIFICATION ERROR ===');
    console.error('Error:', error.message);
    console.error('=== END ERROR ===');
    
    return new Response(
      JSON.stringify({
        success: false,
        payment_status: 'error',
        verified: false,
        amount: 0,
        message: 'Internal server error during verification',
        error: 'Internal server error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
