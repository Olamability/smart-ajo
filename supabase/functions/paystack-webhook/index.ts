/**
 * Paystack Webhook Handler
 * 
 * This Edge Function handles Paystack payment webhooks according to
 * "Paystack steup.md" specification.
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

/**
 * Helper function to create payment transactions for group payments
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
 * Process group creation payment
 * Adds creator as member with selected slot and updates payment status
 */
async function processGroupCreationPayment(
  supabase: any,
  data: PaystackEvent['data']
): Promise<{ success: boolean; message: string }> {
  const { reference, amount, metadata, status } = data;

  console.log('=== PROCESS GROUP CREATION PAYMENT START ===');
  console.log('Reference:', reference);
  console.log('Amount:', amount);
  console.log('Status:', status);
  console.log('Metadata:', JSON.stringify(metadata, null, 2));

  // Verify payment was successful
  if (status !== 'success') {
    console.error('Payment status is not success:', status);
    return { success: false, message: 'Payment not successful' };
  }

  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;
  // Parse preferred_slot as integer - Paystack may send it as string
  const preferredSlot = metadata?.preferred_slot ? parseInt(String(metadata.preferred_slot), 10) : 1;

  if (!userId || !groupId) {
    console.error('Missing required metadata:', { userId, groupId, preferredSlot });
    return { success: false, message: 'Missing required metadata for group creation' };
  }

  console.log(`Processing group creation payment for user ${userId} in group ${groupId}, preferred slot: ${preferredSlot}`);

  // Get group details
  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('contribution_amount, security_deposit_amount, total_members, created_by')
    .eq('id', groupId)
    .single();

  if (groupError || !group) {
    console.error('Group not found:', groupError);
    return { success: false, message: 'Group not found' };
  }

  console.log('Group found:', { 
    contribution_amount: group.contribution_amount, 
    security_deposit_amount: group.security_deposit_amount,
    total_members: group.total_members,
    created_by: group.created_by
  });

  // Verify user is the creator
  if (group.created_by !== userId) {
    console.error('User is not the creator of this group. Creator:', group.created_by, 'User:', userId);
    return { success: false, message: 'Only the group creator can make this payment' };
  }

  // Verify payment amount
  const requiredAmount = (group.contribution_amount + group.security_deposit_amount) * 100;
  if (amount < requiredAmount) {
    return {
      success: false,
      message: `Payment amount insufficient. Expected: ₦${requiredAmount / 100}, Received: ₦${amount / 100}`,
    };
  }

  // Check if user is already a member (idempotency)
  const { data: existingMember } = await supabase
    .from('group_members')
    .select('id, position, has_paid_security_deposit')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingMember?.has_paid_security_deposit) {
    console.log('Group creation payment already processed for reference:', reference);
    return { success: true, message: 'Payment already processed (duplicate webhook)' };
  }

  let memberPosition = preferredSlot;

  if (!existingMember) {
    // Creator is not yet a member - add them with their preferred slot
    console.log(`Adding creator as member with preferred slot ${preferredSlot}`);
    
    // Call add_member_to_group function to add creator
    const { data: addMemberResult, error: addMemberError } = await supabase
      .rpc('add_member_to_group', {
        p_group_id: groupId,
        p_user_id: userId,
        p_is_creator: true,
        p_preferred_slot: preferredSlot
      });

    if (addMemberError) {
      console.error('Failed to add creator as member:', addMemberError);
      return { success: false, message: 'Failed to add creator to group' };
    }

    // Check if the function returned success
    if (addMemberResult && addMemberResult.length > 0) {
      const result = addMemberResult[0];
      if (!result.success) {
        console.error('add_member_to_group failed:', result.error_message);
        return { success: false, message: result.error_message || 'Failed to add creator to group' };
      }
      memberPosition = result.position || preferredSlot;
    }

    // Update the newly added member's payment status
    const { error: memberError } = await supabase
      .from('group_members')
      .update({
        has_paid_security_deposit: true,
        security_deposit_paid_at: new Date().toISOString(),
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (memberError) {
      console.error('Failed to update member payment status:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  } else {
    memberPosition = existingMember.position;

    // Update existing member's payment status
    const { error: memberError } = await supabase
      .from('group_members')
      .update({
        has_paid_security_deposit: true,
        security_deposit_paid_at: new Date().toISOString(),
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (memberError) {
      console.error('Failed to update member payment status:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  }

  // Update or create first contribution record
  const { error: contribError } = await supabase
    .from('contributions')
    .upsert({
      group_id: groupId,
      user_id: userId,
      amount: group.contribution_amount,
      cycle_number: FIRST_CYCLE_NUMBER,
      status: 'paid',
      due_date: new Date().toISOString(),
      paid_date: new Date().toISOString(),
      transaction_ref: reference,
    }, {
      onConflict: 'group_id,user_id,cycle_number'
    });

  if (contribError) {
    console.error('Failed to update contribution:', contribError);
    // Non-fatal for group creation - member is already set up with payment status
    // The contribution record can be fixed later if needed
  }

  // Create transaction records
  const txSuccess = await createPaymentTransactions(
    supabase,
    groupId,
    userId,
    reference,
    group.security_deposit_amount,
    group.contribution_amount,
    true // isCreator
  );

  if (!txSuccess) {
    console.error('Failed to create transaction records - payment processed but audit trail incomplete');
    // Non-fatal - payment status is already updated correctly
    // Transaction records are for audit purposes and can be fixed later
  } else {
    console.log('Transaction records created successfully');
  }

  console.log(`Group creation payment processed successfully. Creator assigned to position ${memberPosition}`);
  console.log('=== PROCESS GROUP CREATION PAYMENT END (SUCCESS) ===');
  return { success: true, message: 'Group creation payment processed successfully' };
}

/**
 * Process group join payment
 * Updates payment status for member who is already added to the group
 */
async function processGroupJoinPayment(
  supabase: any,
  data: PaystackEvent['data']
): Promise<{ success: boolean; message: string }> {
  const { reference, amount, metadata, status } = data;

  console.log('=== PROCESS GROUP JOIN PAYMENT START ===');
  console.log('Reference:', reference);
  console.log('Amount:', amount);
  console.log('Status:', status);
  console.log('Metadata:', JSON.stringify(metadata, null, 2));

  // Verify payment was successful
  if (status !== 'success') {
    console.error('Payment status is not success:', status);
    return { success: false, message: 'Payment not successful' };
  }

  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;
  // Parse preferred_slot as integer - Paystack may send it as string
  const preferredSlot = metadata?.preferred_slot ? parseInt(String(metadata.preferred_slot), 10) : null;

  if (!userId || !groupId) {
    console.error('Missing required metadata:', { userId, groupId });
    return { success: false, message: 'Missing required metadata for group join' };
  }

  console.log(`Processing group join payment for user ${userId} in group ${groupId}, preferred slot: ${preferredSlot}`);

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

  // Check if user is already a member
  // NEW FLOW: User is NOT added as member on approval - they're added here after payment
  // OLD FLOW: User WAS added as member on approval - just update payment status
  const { data: existingMember } = await supabase
    .from('group_members')
    .select('id, position, has_paid_security_deposit, status')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingMember) {
    // User is already a member - check if already paid (idempotency)
    if (existingMember.has_paid_security_deposit) {
      console.log('Group join payment already processed for reference:', reference);
      return { success: true, message: 'Payment already processed (duplicate webhook)' };
    }

    // Update existing member's payment status
    const { error: memberError } = await supabase
      .from('group_members')
      .update({
        has_paid_security_deposit: true,
        security_deposit_paid_at: new Date().toISOString(),
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (memberError) {
      console.error('Failed to update member payment status:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  } else {
    // User is NOT a member yet - add them now (NEW FLOW)
    console.log(`Adding user as member with payment (NEW FLOW)`);
    
    // Get preferred slot from join request
    let slotToAssign = preferredSlot;
    if (!slotToAssign) {
      const { data: joinRequest } = await supabase
        .from('group_join_requests')
        .select('preferred_slot')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('status', 'approved')
        .maybeSingle();
      
      slotToAssign = joinRequest?.preferred_slot || null;
    }
    
    // Call add_member_to_group function to add user with their preferred slot
    const { data: addMemberResult, error: addMemberError } = await supabase
      .rpc('add_member_to_group', {
        p_group_id: groupId,
        p_user_id: userId,
        p_is_creator: false,
        p_preferred_slot: slotToAssign
      });

    if (addMemberError) {
      console.error('Failed to add user as member:', addMemberError);
      return { success: false, message: 'Failed to add user to group' };
    }

    // Check if the function returned success
    if (!addMemberResult || addMemberResult.length === 0) {
      console.error('add_member_to_group returned no result - unexpected behavior');
      return { success: false, message: 'Failed to add user to group - no result returned' };
    }
    
    const result = addMemberResult[0];
    if (!result.success) {
      console.error('add_member_to_group failed:', result.error_message);
      return { success: false, message: result.error_message || 'Failed to add user to group' };
    }

    // Update the newly added member's payment status
    const { error: memberError } = await supabase
      .from('group_members')
      .update({
        has_paid_security_deposit: true,
        security_deposit_paid_at: new Date().toISOString(),
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (memberError) {
      console.error('Failed to update member payment status:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  }

  // Update or create first contribution record
  const { error: contribError } = await supabase
    .from('contributions')
    .upsert({
      group_id: groupId,
      user_id: userId,
      amount: group.contribution_amount,
      cycle_number: FIRST_CYCLE_NUMBER,
      status: 'paid',
      due_date: new Date().toISOString(),
      paid_date: new Date().toISOString(),
      transaction_ref: reference,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'group_id,user_id,cycle_number'
    });

  if (contribError) {
    console.error('Failed to update contribution:', contribError);
    // Non-fatal for group join - member payment status is already updated
    // The contribution record can be fixed later if needed
  }

  // Create transaction records
  const txSuccess = await createPaymentTransactions(
    supabase,
    groupId,
    userId,
    reference,
    group.security_deposit_amount,
    group.contribution_amount,
    false // isCreator
  );

  if (!txSuccess) {
    console.error('Failed to create transaction records - payment processed but audit trail incomplete');
    // Non-fatal - payment status is already updated correctly
    // Transaction records are for audit purposes and can be fixed later
  } else {
    console.log('Transaction records created successfully');
  }

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
    // Non-fatal - the core payment processing succeeded
    // Join request status update is a secondary operation
  } else {
    console.log('Join request status updated to joined');
  }

  console.log('Group join payment processed successfully');
  console.log('=== PROCESS GROUP JOIN PAYMENT END (SUCCESS) ===');
  return { success: true, message: 'Group join payment processed successfully' };
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
