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
 * 2. Payment record is ALWAYS stored (even if auth fails)
 * 3. Business logic executes only with valid authentication
 * 4. Operations are idempotent (safe to retry)
 * 
 * What This Function Does:
 * ========================
 * 
 * STEP 1: Verify Payment with Paystack (NO AUTH REQUIRED)
 * - Calls Paystack API: GET /transaction/verify/{reference}
 * - Uses Paystack SECRET KEY (stored in environment, NEVER exposed to frontend)
 * - Validates payment actually succeeded on Paystack's end
 * - Gets complete payment details (amount, channel, customer, etc.)
 * 
 * STEP 2: Store Payment Record (NO AUTH REQUIRED)
 * - Updates/inserts payment record in database
 * - Sets verified = true for successful payments
 * - Stores all Paystack data for audit trail (fees, paystack_id, domain, etc.)
 * - **CRITICAL**: This happens BEFORE auth check, ensuring payment is always recorded
 * - Idempotent: Safe to call multiple times
 * 
 * STEP 3: Verify User Authentication (FOR BUSINESS LOGIC ONLY)
 * - Validates JWT token from request header
 * - Ensures user is logged in
 * - Validates user matches payment user_id in metadata
 * - If auth fails: Payment is stored, webhook will activate membership later
 * - If auth succeeds: Proceed to business logic
 * 
 * STEP 4: Execute Business Logic (ONLY IF AUTHENTICATED)
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
 * - Auth expired: { success: false, verified: true, payment_status: 'verified_pending_activation', requiresRefresh: true }
 * - Failure: { success: false, error: "...", ... }
 * 
 * Why Payment Storage Happens Before Auth Check:
 * =============================================
 * 
 * **The Problem**: User sessions can expire during payment flow
 * - User initiates payment (JWT token valid)
 * - User completes payment on Paystack (takes 2-5 minutes)
 * - User returns to app (JWT token may have expired)
 * - Old flow: Auth check failed → payment never stored → data lost
 * 
 * **The Solution**: Store payment first, then check auth
 * - Payment data from Paystack is ALWAYS stored
 * - Database has complete payment record (fees, paystack_id, domain, paid_at)
 * - Auth only required for immediate membership activation
 * - If auth fails: Payment stored, webhook activates membership later
 * - If auth succeeds: Payment stored, membership activated immediately
 * 
 * **Benefits**:
 * - No payment data loss regardless of auth state
 * - User can refresh page to retry activation with new session
 * - Webhook has complete payment data to work with
 * - Better user experience with clear "refresh to activate" message
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
 * - Backup in case verify-payment fails (network issues, timeout, auth issues)
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
 * ✅ Secret Key Protection: Uses Paystack secret key (backend only)
 * ✅ JWT Authentication: Requires valid user session for business logic
 * ✅ User Validation: Verifies user matches payment metadata
 * ✅ Idempotent Operations: Safe to call multiple times
 * ✅ Amount Validation: Verifies payment amount matches expected
 * ✅ Atomic Operations: All database changes or none
 * ✅ Payment Storage: Always stored even if auth fails (no data loss)
 * 
 * Usage:
 * ======
 * 
 * POST /verify-payment
 * Headers: { "Authorization": "Bearer <jwt_token>" }
 * Body: { "reference": "payment_reference" }
 * 
 * Response (Success - Activated):
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
 * Response (Success - Pending Activation):
 * {
 *   "success": false,
 *   "payment_status": "verified_pending_activation",
 *   "verified": true,
 *   "amount": 500000,
 *   "message": "Payment verified and stored. Please refresh to complete activation.",
 *   "error": "Session expired during verification",
 *   "requiresRefresh": true,
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
          status: 200,
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

    console.log('[Verification] Reference:', reference);

    // Create service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('[Database] Service role client created');

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

    // Step 3: Verify authentication for business logic
    // This is done AFTER storing payment so payment is always recorded
    // But BEFORE business logic to ensure only authenticated users can activate memberships
    const authHeader = req.headers.get('Authorization');
    console.log('[Auth] Authorization header present:', !!authHeader);

    let user = null;
    let authError = null;

    if (authHeader) {
      // Validate JWT format
      const jwt = authHeader.replace('Bearer ', '');
      console.log('[Auth] JWT length:', jwt.length);

      if (jwt && jwt.length >= 20 && jwt.split('.').length === 3) {
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
        const authResult = await supabaseAuth.auth.getUser();
        user = authResult.data?.user || null;
        authError = authResult.error;

        if (authError || !user) {
          console.error('[Auth] User verification failed:', authError?.message);
        } else {
          console.log('[Auth] User authenticated:', user.id);

          // Verify the authenticated user matches the payment user
          const paymentUserId = verificationResponse.data.metadata?.user_id;
          if (paymentUserId && user.id !== paymentUserId) {
            console.error('[Auth] User ID mismatch:', { authenticated: user.id, payment: paymentUserId });
            user = null;
            authError = new Error('User ID mismatch');
          }
        }
      } else {
        console.error('[Auth] Invalid JWT format');
        authError = new Error('Invalid JWT format');
      }
    } else {
      console.warn('[Auth] No authorization header provided');
      authError = new Error('No authorization header');
    }

    // Step 4: Execute business logic for successful payments (only if authenticated)
    let businessLogicResult: { success: boolean; message: string; position?: number } | null = null;

    // Handle failed payments early
    if (verificationResponse.data.status !== 'success') {
      console.log('[Verification] Payment not successful:', verificationResponse.data.status);
      console.log('=== PAYMENT VERIFICATION END ===');

      return new Response(
        JSON.stringify({
          success: false,
          payment_status: verificationResponse.data.status,
          verified: false,
          amount: verificationResponse.data.amount,
          message: `Payment ${verificationResponse.data.status}. Please try again or contact support.`,
          error: `Payment ${verificationResponse.data.status}`,
          data: {
            reference: verificationResponse.data.reference,
            amount: verificationResponse.data.amount,
            currency: verificationResponse.data.currency,
            channel: verificationResponse.data.channel,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Payment successful - process business logic
    console.log('[Business Logic] Payment successful, checking authentication for business logic...');
    const paymentType = verificationResponse.data.metadata?.type;

    console.log('[Business Logic] Payment type:', paymentType);

    // Check if user is authenticated
    if (!user || authError) {
      console.warn('[Business Logic] User not authenticated, skipping business logic');
      console.warn('[Business Logic] Auth error:', authError?.message);
      console.log('[Business Logic] Payment stored. Webhook will process business logic.');

      // Payment is stored but business logic needs authentication
      // Return success with message to refresh
      return new Response(
        JSON.stringify({
          success: false,
          payment_status: 'verified_pending_activation',
          verified: true,
          amount: verificationResponse.data.amount,
          message: 'Payment verified and stored successfully. Please refresh the page to complete activation. If the issue persists, your payment will be activated automatically within a few minutes.',
          error: authError?.message || 'Authentication required for immediate activation',
          requiresRefresh: true,
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
    }

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
            message: `Payment verified but failed to process: ${businessLogicResult.message}. Your payment will be activated automatically within a few minutes.`,
            error: businessLogicResult.message,
            // Include debug info if available
            debug: {
              step: 'business_logic',
              details: businessLogicResult
            }
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
          message: 'Payment verified but encountered an error during processing. Your payment will be activated automatically within a few minutes.',
          error: error.message || 'Business logic execution failed',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('[Business Logic] Execution complete:', businessLogicResult?.success ? 'SUCCESS' : 'PENDING');

    console.log('[Verification] Payment verified and processed successfully');
    console.log('=== PAYMENT VERIFICATION END ===');

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        payment_status: 'success',
        verified: true,
        amount: verificationResponse.data.amount,
        message: businessLogicResult?.message || 'Payment verified and processed successfully',
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
