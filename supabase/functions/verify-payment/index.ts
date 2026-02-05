/**
 * Paystack Payment Verification Edge Function
 * 
 * Securely verifies payments with Paystack and activates group membership.
 * This function runs on the backend (Supabase Edge Functions) with access to secret keys.
 * 
 * Flow:
 * 1. Receive payment reference from frontend
 * 2. Verify payment with Paystack API using secret key
 * 3. Update payment record in database
 * 4. Activate user's group membership
 * 5. Update group status if needed
 * 6. Return success/failure response
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      slotNumber?: number;
      cycleId?: string;
      [key: string]: any;
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
    console.log('Payment verification request received');
    
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

    // Parse request body
    const { reference } = await req.json();
    if (!reference) {
      console.error('Payment reference not provided');
      return new Response(
        JSON.stringify({ success: false, error: 'Payment reference is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Verifying payment with reference: ${reference}`);

    // Verify payment with Paystack
    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
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
      console.error('Paystack verification failed:', JSON.stringify(errorData));
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Payment verification failed with Paystack',
          details: errorData 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const verificationData: PaystackVerificationResponse = await paystackResponse.json();
    console.log(`Paystack verification response - status: ${verificationData.data.status}`);

    // Check if payment was successful
    if (!verificationData.status || verificationData.data.status !== 'success') {
      console.error(`Payment not successful - status: ${verificationData.data.status}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Payment was not successful',
          paymentStatus: verificationData.data.status 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with service role key (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const paymentData = verificationData.data;
    const metadata = paymentData.metadata || {};
    const userId = metadata.userId;
    const groupId = metadata.groupId;
    const paymentType = metadata.paymentType;
    const slotNumber = metadata.slotNumber;

    console.log(`Processing payment - Type: ${paymentType}, User: ${userId}, Group: ${groupId}`);

    if (!userId || !groupId) {
      console.error('Invalid payment metadata - missing userId or groupId');
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid payment metadata' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update transaction record to 'completed'
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

    // Handle different payment types
    if (paymentType === 'group_creation' || paymentType === 'group_join') {
      console.log(`Processing ${paymentType} payment for slot ${slotNumber}`);
      
      // Add or update user as group member with selected slot
      // Use upsert to handle both new members (group_creation) and existing pending members (group_join)
      const { error: memberError } = await supabase
        .from('group_members')
        .upsert(
          {
            group_id: groupId,
            user_id: userId,
            rotation_position: slotNumber,
            status: 'active',
            payment_status: 'paid',
            has_paid_security_deposit: true,
          },
          {
            onConflict: 'group_id,user_id',
            ignoreDuplicates: false, // Update existing record instead of ignoring
          }
        );

      if (memberError) {
        console.error('Error adding/updating group member:', JSON.stringify(memberError));
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to activate membership' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Group member added/updated successfully');

      // Update group status to 'active' if all members have joined
      // Using eq filters makes this operation safe from race conditions:
      // - Only updates if status is still 'forming'
      // - Even if multiple payments complete simultaneously, all will set status to 'active' (idempotent)
      // - The trigger ensures current_members is accurately maintained
      const { data: groupData } = await supabase
        .from('groups')
        .select('total_members, current_members')
        .eq('id', groupId)
        .single();

      if (groupData && groupData.current_members >= groupData.total_members) {
        console.log(`Group is full (${groupData.current_members}/${groupData.total_members}), activating group`);
        const { error: statusUpdateError } = await supabase
          .from('groups')
          .update({ status: 'active' })
          .eq('id', groupId)
          .eq('status', 'forming'); // Only update if still forming (race-safe)

        if (statusUpdateError) {
          console.error('Error activating group:', JSON.stringify(statusUpdateError));
          // Don't fail the request, group status update is non-critical for payment verification
        } else {
          console.log('Group status updated to active');
        }
      } else {
        console.log(`Group not yet full (${groupData?.current_members}/${groupData?.total_members})`);
      }

      // Update join request status if it's a join payment
      if (paymentType === 'group_join') {
        console.log('Updating join request status to paid');
        const { error: requestUpdateError } = await supabase
          .from('group_join_requests')
          .update({ 
            status: 'paid',
            payment_completed_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('group_id', groupId);

        if (requestUpdateError) {
          console.error('Error updating join request:', JSON.stringify(requestUpdateError));
        } else {
          console.log('Join request updated successfully');
        }
      }
    } else if (paymentType === 'contribution') {
      console.log('Processing contribution payment');
      
      // Update existing contribution record to mark as paid
      const contributionId = metadata.contributionId;
      
      if (!contributionId) {
        console.error('Contribution ID missing in metadata');
        return new Response(
          JSON.stringify({ success: false, error: 'Contribution ID required for contribution payment' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Updating contribution ${contributionId} to paid`);
      
      // Update the contribution record to mark it as paid
      const { error: contributionError } = await supabase
        .from('contributions')
        .update({
          status: 'paid',
          paid_date: new Date().toISOString(),
          transaction_ref: reference,
        })
        .eq('id', contributionId);

      if (contributionError) {
        console.error('Error updating contribution:', JSON.stringify(contributionError));
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to record contribution' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Contribution updated successfully');

      // Check if all members have contributed for this cycle
      // First get the contribution to find group and cycle info
      const { data: contributionData } = await supabase
        .from('contributions')
        .select('group_id, cycle_number')
        .eq('id', contributionId)
        .single();

      if (contributionData) {
        // Count total paid contributions for this cycle
        const { data: contributionsData } = await supabase
          .from('contributions')
          .select('id')
          .eq('group_id', contributionData.group_id)
          .eq('cycle_number', contributionData.cycle_number)
          .eq('status', 'paid');

        // Get total members in the group
        const { data: groupData } = await supabase
          .from('groups')
          .select('total_members')
          .eq('id', contributionData.group_id)
          .single();

        const totalContributions = contributionsData?.length || 0;
        const requiredContributions = groupData?.total_members || 0;

        // If all members have paid for this cycle, trigger payout processing
        // (Future implementation: Create payout record, initiate transfer, etc.)
        if (totalContributions >= requiredContributions) {
          console.log(`Cycle ${contributionData.cycle_number} complete for group ${contributionData.group_id} - ${totalContributions}/${requiredContributions} paid`);
          // TODO: Implement payout logic here
          // 1. Calculate payout amount
          // 2. Identify recipient (based on rotation_position)
          // 3. Create payout record
          // 4. Initiate transfer via Paystack Transfer API
        }
      }
    }

    // Return success response
    console.log('Payment verification completed successfully');
    return new Response(
      JSON.stringify({
        success: true,
        verified: true,
        data: {
          reference: paymentData.reference,
          amount: paymentData.amount / 100, // Convert to naira
          status: paymentData.status,
          paidAt: paymentData.paid_at,
          paymentType,
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
    console.error('Error in payment verification:', error);
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
