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
async function executeBusinessLogic(
  supabase: any,
  paystackData: PaystackVerificationResponse['data']
): Promise<{ success: boolean; message: string; position?: number }> {
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
      return await processGroupCreationPayment(supabase, paystackData);
    case 'group_join':
      return await processGroupJoinPayment(supabase, paystackData);
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

/**
 * Helper function to create first contribution record
 */
async function createFirstContribution(
  supabase: any,
  groupId: string,
  userId: string,
  amount: number,
  reference: string
): Promise<boolean> {
  const { error } = await supabase
    .from('contributions')
    .insert({
      group_id: groupId,
      user_id: userId,
      amount: amount,
      cycle_number: FIRST_CYCLE_NUMBER,
      status: 'paid',
      due_date: new Date().toISOString(),
      paid_date: new Date().toISOString(),
      transaction_ref: reference,
    });

  if (error) {
    console.error('Failed to create contribution:', error);
    return false;
  }
  return true;
}

/**
 * Helper function to create payment transaction records
 */
async function createPaymentTransactions(
  supabase: any,
  groupId: string,
  userId: string,
  reference: string,
  securityDepositAmount: number,
  contributionAmount: number,
  isCreator: boolean
): Promise<boolean> {
  const { error } = await supabase
    .from('transactions')
    .insert([
      {
        user_id: userId,
        group_id: groupId,
        type: 'security_deposit',
        amount: securityDepositAmount,
        status: 'completed',
        reference: reference + '_SD',
        description: isCreator ? 'Security deposit for group creation' : 'Security deposit for joining group',
        completed_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        group_id: groupId,
        type: 'contribution',
        amount: contributionAmount,
        status: 'completed',
        reference: reference + '_C1',
        description: 'First contribution payment',
        completed_at: new Date().toISOString(),
      },
    ]);

  if (error) {
    console.error('Failed to create transactions:', error);
    return false;
  }
  return true;
}

/**
 * Helper function to increment group member count
 * Uses RPC function for atomic increment to avoid race conditions
 */
async function incrementGroupMemberCount(
  supabase: any,
  groupId: string
): Promise<boolean> {
  // Use atomic increment via SQL to avoid race conditions
  const { error } = await supabase.rpc('increment_group_member_count', {
    p_group_id: groupId
  });

  if (error) {
    console.error('Failed to increment member count:', error);
    // Fallback to manual update if RPC doesn't exist
    const { error: updateError } = await supabase
      .from('groups')
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq('id', groupId)
      .select('current_members')
      .single()
      .then(async ({ data: group }: any) => {
        if (group) {
          return await supabase
            .from('groups')
            .update({
              current_members: group.current_members + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', groupId)
            .eq('current_members', group.current_members); // Optimistic locking
        }
        return { error: null };
      });
    
    if (updateError) {
      console.error('Fallback update also failed:', updateError);
      return false;
    }
  }
  return true;
}

/**
 * Process group creation payment
 * Updates payment status for creator who is already a member
 */
async function processGroupCreationPayment(
  supabase: any,
  data: PaystackVerificationResponse['data']
): Promise<{ success: boolean; message: string; position?: number }> {
  const { reference, amount, metadata } = data;
  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;
  const preferredSlot = metadata?.preferred_slot || 1;

  if (!userId || !groupId) {
    return { success: false, message: 'Missing required metadata for group creation' };
  }

  console.log(`Processing group creation payment for user ${userId} in group ${groupId}`);

  // Get group details
  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('contribution_amount, security_deposit_amount')
    .eq('id', groupId)
    .single();

  if (groupError || !group) {
    console.error('Group not found:', groupError);
    return { success: false, message: 'Group not found' };
  }

  // Verify payment amount
  const requiredAmount = (group.contribution_amount + group.security_deposit_amount) * 100;
  if (amount < requiredAmount) {
    return {
      success: false,
      message: `Payment amount insufficient. Expected: ₦${requiredAmount / 100}, Received: ₦${amount / 100}`,
    };
  }

  // Check if user is already a member (should be, as they're auto-added on group creation)
  const { data: existingMember } = await supabase
    .from('group_members')
    .select('id, position, has_paid_security_deposit')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existingMember) {
    console.error('Creator is not a member of the group - this should not happen');
    return { success: false, message: 'User is not a member of this group' };
  }

  // Check if already paid (idempotency)
  if (existingMember.has_paid_security_deposit) {
    console.log('User has already paid, skipping duplicate processing');
    return {
      success: true,
      message: 'Payment already processed',
      position: existingMember.position,
    };
  }

  // Update member payment status
  const { error: memberError } = await supabase
    .from('group_members')
    .update({
      has_paid_security_deposit: true,
      security_deposit_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId)
    .eq('user_id', userId);

  if (memberError) {
    console.error('Failed to update member payment status:', memberError);
    return { success: false, message: 'Failed to update member payment status' };
  }

  // Update first contribution to paid status
  const { error: contribError } = await supabase
    .from('contributions')
    .update({
      status: 'paid',
      paid_date: new Date().toISOString(),
      transaction_ref: reference,
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .eq('cycle_number', FIRST_CYCLE_NUMBER);

  if (contribError) {
    console.error('Failed to update contribution:', contribError);
    // Non-fatal, continue
  }

  // Create transaction records using helper
  await createPaymentTransactions(
    supabase,
    groupId,
    userId,
    reference,
    group.security_deposit_amount,
    group.contribution_amount,
    true // isCreator
  );

  console.log('Group creation payment processed successfully');
  return {
    success: true,
    message: 'Group creation payment processed successfully',
    position: existingMember.position,
  };
}

/**
 * Process group join payment
 * Updates payment status for member who is already added to the group
 */
async function processGroupJoinPayment(
  supabase: any,
  data: PaystackVerificationResponse['data']
): Promise<{ success: boolean; message: string; position?: number }> {
  const { reference, amount, metadata } = data;
  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;
  const preferredSlot = metadata?.preferred_slot;

  if (!userId || !groupId) {
    return { success: false, message: 'Missing required metadata for group join' };
  }

  console.log(`Processing group join payment for user ${userId} in group ${groupId}`);

  // Get group details
  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('contribution_amount, security_deposit_amount, current_members, max_members')
    .eq('id', groupId)
    .single();

  if (groupError || !group) {
    console.error('Group not found:', groupError);
    return { success: false, message: 'Group not found' };
  }

  // Verify payment amount
  const requiredAmount = (group.contribution_amount + group.security_deposit_amount) * 100;
  if (amount < requiredAmount) {
    return {
      success: false,
      message: `Payment amount insufficient. Expected: ₦${requiredAmount / 100}, Received: ₦${amount / 100}`,
    };
  }

  // Check if user is a member (should be, as they're added on join approval)
  const { data: existingMember } = await supabase
    .from('group_members')
    .select('id, position, has_paid_security_deposit')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existingMember) {
    console.error('User is not a member of the group - this should not happen');
    return { success: false, message: 'User is not a member of this group' };
  }

  // Check if already paid (idempotency)
  if (existingMember.has_paid_security_deposit) {
    console.log('User has already paid, skipping duplicate processing');
    return {
      success: true,
      message: 'Payment already processed',
      position: existingMember.position,
    };
  }

  // Update member payment status
  const { error: memberError } = await supabase
    .from('group_members')
    .update({
      has_paid_security_deposit: true,
      security_deposit_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId)
    .eq('user_id', userId);

  if (memberError) {
    console.error('Failed to update member payment status:', memberError);
    return { success: false, message: 'Failed to update member payment status' };
  }

  // Update first contribution to paid status
  const { error: contribError } = await supabase
    .from('contributions')
    .update({
      status: 'paid',
      paid_date: new Date().toISOString(),
      transaction_ref: reference,
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .eq('cycle_number', FIRST_CYCLE_NUMBER);

  if (contribError) {
    console.error('Failed to update contribution:', contribError);
    // Non-fatal, continue
  }

  // Create transaction records using helper
  await createPaymentTransactions(
    supabase,
    groupId,
    userId,
    reference,
    group.security_deposit_amount,
    group.contribution_amount,
    false // isCreator
  );

  // Update join request status to 'joined' if it exists
  const { error: joinReqError } = await supabase
    .from('group_join_requests')
    .update({
      status: 'joined',
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .eq('status', 'approved');

  if (joinReqError) {
    console.error('Failed to update join request:', joinReqError);
    // Non-fatal, continue
  }

  console.log('Group join payment processed successfully');
  return {
    success: true,
    message: 'Group join payment processed successfully',
    position: existingMember.position,
  };
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

    // Step 2: Store payment record (using supabase client created earlier)
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
        position: businessLogicResult.position, // Include position for group join/creation
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
