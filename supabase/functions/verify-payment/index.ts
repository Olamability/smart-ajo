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
    // Get Paystack secret key from environment
    const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecretKey) {
      throw new Error('Paystack secret key not configured');
    }

    // Get Supabase credentials from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    // Parse request body
    const { reference } = await req.json();
    if (!reference) {
      return new Response(
        JSON.stringify({ success: false, error: 'Payment reference is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
      console.error('Paystack verification failed:', errorData);
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

    // Check if payment was successful
    if (!verificationData.status || verificationData.data.status !== 'success') {
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

    if (!userId || !groupId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid payment metadata' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update transaction record to 'completed'
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
      console.error('Error updating transaction record:', transactionUpdateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update transaction record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle different payment types
    if (paymentType === 'group_creation' || paymentType === 'group_join') {
      // Add user as group member with selected slot
      const { error: memberError } = await supabase
        .from('group_members')
        .insert({
          group_id: groupId,
          user_id: userId,
          rotation_position: slotNumber,
          status: 'active',
          payment_status: 'paid',
          has_paid_security_deposit: true,
        });

      if (memberError) {
        // Check if member already exists (duplicate insert)
        if (memberError.code !== '23505') {
          console.error('Error adding group member:', memberError);
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to activate membership' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Update group current_members count atomically to avoid race conditions
      // Try to use database function first for atomic increment
      const { data: updatedGroup, error: rpcError } = await supabase
        .rpc('increment_group_members', { group_id_param: groupId });

      if (rpcError) {
        // Fallback: If RPC function doesn't exist, use manual update
        console.warn('RPC function not available, using fallback update:', rpcError);
        
        const { data: groupData, error: groupFetchError } = await supabase
          .from('groups')
          .select('total_members, current_members')
          .eq('id', groupId)
          .single();

        if (!groupFetchError && groupData) {
          const newMemberCount = (groupData.current_members || 0) + 1;
          const newStatus = newMemberCount >= groupData.total_members ? 'active' : 'forming';

          const { error: groupUpdateError } = await supabase
            .from('groups')
            .update({
              current_members: newMemberCount,
              status: newStatus,
            })
            .eq('id', groupId);

          if (groupUpdateError) {
            console.error('Error updating group:', groupUpdateError);
          }
        }
      }

      // Update join request status if it's a join payment
      if (paymentType === 'group_join') {
        const { error: requestUpdateError } = await supabase
          .from('group_join_requests')
          .update({ 
            status: 'paid',
            payment_completed_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('group_id', groupId);

        if (requestUpdateError) {
          console.error('Error updating join request:', requestUpdateError);
        }
      }
    } else if (paymentType === 'contribution') {
      // Record contribution payment
      const cycleId = metadata.cycleId;
      
      if (!cycleId) {
        return new Response(
          JSON.stringify({ success: false, error: 'Cycle ID required for contribution payment' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error: contributionError } = await supabase
        .from('contributions')
        .insert({
          group_id: groupId,
          cycle_id: cycleId,
          user_id: userId,
          amount: paymentData.amount / 100, // Convert from kobo to naira
          payment_reference: reference,
          status: 'paid',
        });

      if (contributionError) {
        console.error('Error recording contribution:', contributionError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to record contribution' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if all members have contributed for this cycle
      const { data: cycleData } = await supabase
        .from('contribution_cycles')
        .select('*, groups!inner(total_members)')
        .eq('id', cycleId)
        .single();

      if (cycleData) {
        const { data: contributionsData } = await supabase
          .from('contributions')
          .select('id')
          .eq('cycle_id', cycleId)
          .eq('status', 'paid');

        const totalContributions = contributionsData?.length || 0;
        const requiredContributions = cycleData.groups.total_members;

        // If all members have paid, mark cycle as complete and process payout
        if (totalContributions >= requiredContributions) {
          const { error: cycleUpdateError } = await supabase
            .from('contribution_cycles')
            .update({ status: 'completed' })
            .eq('id', cycleId);

          if (cycleUpdateError) {
            console.error('Error updating cycle status:', cycleUpdateError);
          }

          // Trigger payout processing (could be another edge function)
          // For now, we'll let the application handle payout logic
        }
      }
    }

    // Return success response
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
