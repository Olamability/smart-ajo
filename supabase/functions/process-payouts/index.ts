/**
 * Process Payouts Edge Function
 * 
 * This function processes pending payouts by transferring funds to recipients via Paystack.
 * It should be triggered by a scheduled job (cron) or manually for testing.
 * 
 * Flow:
 * 1. Get all pending payouts from database
 * 2. For each payout, create a Paystack transfer recipient
 * 3. Initiate transfer via Paystack Transfer API
 * 4. Update payout status based on transfer result
 * 5. Create transaction record and notification
 * 
 * Idempotent: Safe to run multiple times - will only process pending payouts
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

interface PayoutRecord {
  payout_id: string;
  group_id: string;
  group_name: string;
  recipient_id: string;
  recipient_name: string;
  recipient_email: string;
  recipient_bank_code: string;
  recipient_account_number: string;
  recipient_account_name: string;
  amount: number;
  cycle_number: number;
  created_at: string;
}

/**
 * Create or get Paystack transfer recipient
 */
async function createTransferRecipient(
  paystackSecretKey: string,
  accountNumber: string,
  bankCode: string,
  name: string
): Promise<{ success: boolean; recipient_code?: string; error?: string }> {
  try {
    const response = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'nuban',
        name: name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      console.error('[Paystack] Failed to create recipient:', data);
      return {
        success: false,
        error: data.message || 'Failed to create transfer recipient',
      };
    }

    return {
      success: true,
      recipient_code: data.data.recipient_code,
    };
  } catch (error) {
    console.error('[Paystack] Exception creating recipient:', error);
    return {
      success: false,
      error: error.message || 'Exception while creating recipient',
    };
  }
}

/**
 * Initiate Paystack transfer
 */
async function initiateTransfer(
  paystackSecretKey: string,
  recipientCode: string,
  amount: number,
  reference: string,
  reason: string
): Promise<{ success: boolean; transfer_code?: string; error?: string }> {
  try {
    // Convert amount to kobo (Paystack uses kobo)
    const amountInKobo = Math.round(amount * 100);

    const response = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: amountInKobo,
        recipient: recipientCode,
        reference: reference,
        reason: reason,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      console.error('[Paystack] Transfer failed:', data);
      return {
        success: false,
        error: data.message || 'Transfer initiation failed',
      };
    }

    return {
      success: true,
      transfer_code: data.data.transfer_code,
    };
  } catch (error) {
    console.error('[Paystack] Exception initiating transfer:', error);
    return {
      success: false,
      error: error.message || 'Exception while initiating transfer',
    };
  }
}

/**
 * Process a single payout
 */
async function processPayout(
  supabase: any,
  paystackSecretKey: string,
  payout: PayoutRecord
): Promise<{ success: boolean; message: string }> {
  console.log('[Process Payout] Processing:', payout.payout_id);

  // Mark as processing (prevents duplicate processing)
  const { data: markResult, error: markError } = await supabase.rpc(
    'mark_payout_processing',
    { p_payout_id: payout.payout_id }
  );

  if (markError || !markResult) {
    console.log('[Process Payout] Already processing or not found:', payout.payout_id);
    return {
      success: false,
      message: 'Payout already processing or not found',
    };
  }

  // Create transfer recipient
  const recipientResult = await createTransferRecipient(
    paystackSecretKey,
    payout.recipient_account_number,
    payout.recipient_bank_code,
    payout.recipient_account_name
  );

  if (!recipientResult.success || !recipientResult.recipient_code) {
    // Mark as failed
    await supabase.rpc('mark_payout_failed', {
      p_payout_id: payout.payout_id,
      p_error_message: recipientResult.error || 'Failed to create recipient',
    });

    return {
      success: false,
      message: `Recipient creation failed: ${recipientResult.error}`,
    };
  }

  // Generate transfer reference
  const reference = `PAYOUT_${payout.payout_id.substring(0, 8)}_${Date.now()}`;

  // Initiate transfer
  const transferResult = await initiateTransfer(
    paystackSecretKey,
    recipientResult.recipient_code,
    payout.amount,
    reference,
    `Payout for ${payout.group_name} - Cycle ${payout.cycle_number}`
  );

  if (!transferResult.success) {
    // Mark as failed
    await supabase.rpc('mark_payout_failed', {
      p_payout_id: payout.payout_id,
      p_error_message: transferResult.error || 'Transfer failed',
    });

    return {
      success: false,
      message: `Transfer failed: ${transferResult.error}`,
    };
  }

  // Mark as completed
  const { error: completeError } = await supabase.rpc('mark_payout_completed', {
    p_payout_id: payout.payout_id,
    p_payment_reference: reference,
    p_payment_method: 'bank_transfer',
  });

  if (completeError) {
    console.error('[Process Payout] Failed to mark as completed:', completeError);
  }

  // Create transaction record
  const { error: txError } = await supabase.from('transactions').insert({
    user_id: payout.recipient_id,
    group_id: payout.group_id,
    type: 'payout',
    amount: payout.amount,
    status: 'completed',
    reference: reference,
    description: `Payout for cycle ${payout.cycle_number}`,
    completed_at: new Date().toISOString(),
  });

  if (txError) {
    console.error('[Process Payout] Failed to create transaction:', txError);
    // Non-fatal: payout is already marked complete, but log for monitoring
  }

  // Create notification
  const { error: notifError } = await supabase.from('notifications').insert({
    user_id: payout.recipient_id,
    type: 'payout_completed',
    title: 'Payout Sent!',
    message: `Your payout of ₦${payout.amount.toLocaleString()} has been sent to your bank account.`,
    data: {
      payout_id: payout.payout_id,
      group_id: payout.group_id,
      amount: payout.amount,
      cycle_number: payout.cycle_number,
      reference: reference,
    },
  });

  if (notifError) {
    console.error('[Process Payout] Failed to create notification:', notifError);
    // Non-fatal: payout is complete, but user won't get notification
  }

  console.log('[Process Payout] Completed:', payout.payout_id);

  return {
    success: true,
    message: `Payout processed successfully. Reference: ${reference}`,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Get Paystack secret key
    const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecretKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Paystack secret key not configured',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get pending payouts
    const { data: payouts, error: payoutsError } = await supabase.rpc('get_pending_payouts');

    if (payoutsError) {
      console.error('[Process Payouts] Failed to get pending payouts:', payoutsError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to fetch pending payouts',
          details: payoutsError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!payouts || payouts.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No pending payouts to process',
          processed: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`[Process Payouts] Found ${payouts.length} pending payouts`);

    // Process each payout
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const payout of payouts) {
      const result = await processPayout(supabase, paystackSecretKey, payout);
      results.push({
        payout_id: payout.payout_id,
        recipient_name: payout.recipient_name,
        amount: payout.amount,
        ...result,
      });

      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${payouts.length} payouts`,
        total: payouts.length,
        successful: successCount,
        failed: failureCount,
        results: results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[Process Payouts] Exception:', error);
    return new Response(
      JSON.stringify({
        success: false,
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
