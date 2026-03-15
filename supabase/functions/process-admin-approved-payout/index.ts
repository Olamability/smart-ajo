/**
 * process-admin-approved-payout Edge Function
 *
 * Initiates a Paystack transfer for a single payout that has been explicitly
 * approved by an admin via the approve_payout() RPC.
 *
 * Authentication:
 *   Requires a valid Supabase JWT belonging to a user with is_admin = true.
 *
 * Request body (POST):
 * {
 *   payoutId: string;   // UUID of the payouts row to process
 * }
 *
 * Response:
 * {
 *   success: boolean;
 *   payoutId: string;
 *   status: string;     // 'processing' | 'failed'
 *   error?: string;
 * }
 *
 * State transitions (approval_status column):
 *   approved → processing  (after Paystack transfer is initiated)
 *   approved → failed      (if transfer initiation fails permanently)
 *
 * The Paystack transfer.success / transfer.failed webhooks (handled by the
 * paystack-webhook function) subsequently advance the payout to
 * 'completed' or 'failed'.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Paystack Transfers API types
// ---------------------------------------------------------------------------

interface PaystackTransferRecipientResponse {
  status: boolean;
  message: string;
  data: {
    recipient_code: string;
    details: {
      account_number: string;
      account_name: string | null;
      bank_code: string;
      bank_name: string;
    };
  };
}

interface PaystackInitiateTransferResponse {
  status: boolean;
  message: string;
  data: {
    transfer_code: string;
    reference: string;
    status: string;
    amount: number;
    currency: string;
  };
}

// ---------------------------------------------------------------------------
// Payout row type (joined with user bank details)
// ---------------------------------------------------------------------------

interface ApprovedPayout {
  id: string;
  related_group_id: string;
  recipient_id: string;
  cycle_number: number;
  amount: number;
  approval_status: string;
  retry_count: number;
  max_retries: number;
  users: {
    id: string;
    email: string | null;
    full_name: string;
    account_number: string | null;
    account_name: string | null;
    bank_code: string | null;
    bank_name: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------

async function logAuditEvent(
  supabase: SupabaseClient,
  action: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId ?? null,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details,
    });
  } catch (err) {
    console.error('[process-admin-approved-payout] Failed to write audit log:', err);
  }
}

// ---------------------------------------------------------------------------
// Verify that the bearer token belongs to an admin user.
// Returns the admin's user ID, or throws if unauthorized.
// ---------------------------------------------------------------------------

async function requireAdmin(
  supabase: SupabaseClient,
  authHeader: string | null,
): Promise<string> {
  if (!authHeader) {
    throw new Error('Authorization header is required');
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    throw new Error('Invalid or expired token');
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('User profile not found');
  }

  if (!profile.is_admin) {
    throw new Error('Admin privileges required');
  }

  return user.id;
}

// ---------------------------------------------------------------------------
// Core payout processing logic
// ---------------------------------------------------------------------------

async function processApprovedPayout(
  supabase: SupabaseClient,
  paystackSecretKey: string,
  adminId: string,
  payout: ApprovedPayout,
): Promise<{ payoutId: string; status: string; error?: string }> {
  const user = payout.users;

  if (!user) {
    console.error(
      `[process-admin-approved-payout] User not found for payout ${payout.id}`,
    );
    return { payoutId: payout.id, status: 'failed', error: 'Recipient not found' };
  }

  // Validate bank account details before attempting transfer.
  if (!user.account_number || !user.bank_code) {
    console.error(
      `[process-admin-approved-payout] Recipient ${user.id} has no bank account details`,
    );

    await supabase
      .from('payouts')
      .update({
        status: 'failed',
        notes: 'Recipient has no bank account details on file',
      })
      .eq('id', payout.id);

    await supabase.rpc('send_payment_notification', {
      p_user_id: user.id,
      p_type: 'payout_processed',
      p_title: 'Payout failed — bank details missing',
      p_message:
        'Your payout could not be processed because your bank account details are missing. ' +
        'Please update your profile and contact support.',
      p_metadata: {
        payout_id: payout.id,
        cycle_number: payout.cycle_number,
        group_id: payout.related_group_id,
      },
    });

    await logAuditEvent(
      supabase,
      'payout_failed',
      'payout',
      payout.id,
      {
        reason: 'missing_bank_details',
        recipient_id: user.id,
        group_id: payout.related_group_id,
        cycle_number: payout.cycle_number,
        admin_id: adminId,
      },
      adminId,
    );

    return { payoutId: payout.id, status: 'failed', error: 'Missing bank account details' };
  }

  const amountInKobo = Math.round(payout.amount * 100);
  const transferReference = `ajo_payout_${payout.id}_${Date.now()}`;

  try {
    // Step 1: Create a Paystack transfer recipient.
    const recipientResponse = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'nuban',
        name: user.account_name ?? user.full_name,
        account_number: user.account_number,
        bank_code: user.bank_code,
        currency: 'NGN',
      }),
    });

    if (!recipientResponse.ok) {
      const recipientError = await recipientResponse.json();
      throw new Error(
        `Failed to create transfer recipient: ${JSON.stringify(recipientError)}`,
      );
    }

    const recipientData: PaystackTransferRecipientResponse =
      await recipientResponse.json();
    if (!recipientData.status) {
      throw new Error(`Paystack recipient creation failed: ${recipientData.message}`);
    }

    const recipientCode = recipientData.data.recipient_code;
    console.log(
      `[process-admin-approved-payout] Transfer recipient created: ${recipientCode}`,
    );

    // Step 2: Atomically advance approval_status to 'processing' before the
    //         transfer is sent.  The conditional WHERE clause ensures exactly
    //         one concurrent caller wins the race — if another request already
    //         advanced the status, the UPDATE returns 0 rows and we abort.
    const { data: markedRows, error: markProcessingError } = await supabase
      .from('payouts')
      .update({
        status: 'processing',
        approval_status: 'processing',
        payment_reference: transferReference,
        notes: `Paystack recipient code: ${recipientCode}`,
      })
      .eq('id', payout.id)
      .eq('approval_status', 'approved')  // only advance if still 'approved'
      .select('id');

    if (markProcessingError) {
      throw new Error(
        `Failed to mark payout as processing: ${markProcessingError.message}`,
      );
    }

    if (!markedRows || markedRows.length === 0) {
      // Another concurrent request already claimed this payout — bail out
      // to avoid dispatching a duplicate Paystack transfer.
      throw new Error(
        'Payout was already claimed by a concurrent request; skipping to prevent duplicate transfer',
      );
    }

    // Step 3: Initiate the Paystack transfer.
    const transferResponse = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: amountInKobo,
        recipient: recipientCode,
        reason: `Smart Ajo payout — cycle ${payout.cycle_number}`,
        reference: transferReference,
        currency: 'NGN',
      }),
    });

    const transferData: PaystackInitiateTransferResponse = await transferResponse.json();

    if (!transferResponse.ok || !transferData.status) {
      throw new Error(`Transfer initiation failed: ${transferData.message}`);
    }

    console.log(
      `[process-admin-approved-payout] Transfer initiated: ${transferData.data.transfer_code}`,
    );

    // Step 4: Atomically record transfer details and insert transaction row.
    const { data: initiationResult, error: initiationError } = await supabase.rpc(
      'record_payout_initiation',
      {
        p_payout_id:          payout.id,
        p_user_id:            user.id,
        p_group_id:           payout.related_group_id,
        p_cycle_number:       payout.cycle_number,
        p_amount_kobo:        amountInKobo,
        p_transfer_code:      transferData.data.transfer_code,
        p_transfer_reference: transferReference,
      },
    );

    if (initiationError || !(initiationResult as { success: boolean })?.success) {
      throw new Error(
        (initiationResult as { error?: string })?.error ??
          initiationError?.message ??
          'Failed to record payout initiation',
      );
    }

    // Step 5: Audit log.
    await logAuditEvent(
      supabase,
      'payout_initiated',
      'payout',
      payout.id,
      {
        admin_id:            adminId,
        recipient_id:        user.id,
        group_id:            payout.related_group_id,
        cycle_number:        payout.cycle_number,
        amount_naira:        payout.amount,
        amount_kobo:         amountInKobo,
        transfer_code:       transferData.data.transfer_code,
        transfer_reference:  transferReference,
        recipient_code:      recipientCode,
      },
      adminId,
    );

    return { payoutId: payout.id, status: 'processing' };
  } catch (transferError) {
    const errorMessage =
      transferError instanceof Error ? transferError.message : String(transferError);
    console.error(
      `[process-admin-approved-payout] Transfer error for payout ${payout.id}:`,
      transferError,
    );

    // Increment retry counter and decide whether to re-queue or permanently fail.
    const { data: retryResult } = await supabase.rpc('increment_payout_retry', {
      p_payout_id:      payout.id,
      p_failure_reason: errorMessage,
    });

    const canRetry: boolean = (retryResult as { can_retry?: boolean })?.can_retry ?? false;
    const retryCount: number =
      (retryResult as { retry_count?: number })?.retry_count ?? payout.retry_count + 1;
    const maxRetries: number =
      (retryResult as { max_retries?: number })?.max_retries ?? payout.max_retries;

    if (canRetry) {
      // Return to 'approved' so the admin can re-trigger the transfer.
      await supabase
        .from('payouts')
        .update({
          status: 'pending',
          approval_status: 'approved',
          notes: `Transfer error (attempt ${retryCount}/${maxRetries}): ${errorMessage}`,
        })
        .eq('id', payout.id);

      console.warn(
        `[process-admin-approved-payout] Payout ${payout.id} failed (attempt ${retryCount}/${maxRetries}); re-queued for retry.`,
      );
    } else {
      // Exceeded max retries — permanently mark as failed.
      await supabase
        .from('payouts')
        .update({
          status: 'failed',
          approval_status: 'failed',
          notes: `Permanently failed after ${retryCount} attempts. Last error: ${errorMessage}`,
        })
        .eq('id', payout.id);

      await supabase.rpc('send_payment_notification', {
        p_user_id: user.id,
        p_type: 'payout_processed',
        p_title: 'Payout permanently failed',
        p_message:
          `Your payout for cycle ${payout.cycle_number} could not be processed after ` +
          `${retryCount} attempts. Please contact support.`,
        p_metadata: {
          payout_id:    payout.id,
          cycle_number: payout.cycle_number,
          group_id:     payout.related_group_id,
          retry_count:  retryCount,
        },
      });

      console.error(
        `[process-admin-approved-payout] Payout ${payout.id} permanently failed after ${retryCount}/${maxRetries} attempts.`,
      );
    }

    await logAuditEvent(
      supabase,
      'payout_transfer_error',
      'payout',
      payout.id,
      {
        admin_id:     adminId,
        recipient_id: user.id,
        group_id:     payout.related_group_id,
        cycle_number: payout.cycle_number,
        error:        errorMessage,
        retry_count:  retryCount,
        max_retries:  maxRetries,
        can_retry:    canRetry,
      },
      adminId,
    );

    return {
      payoutId: payout.id,
      status: canRetry ? 'error' : 'failed',
      error: errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecretKey) {
      throw new Error('PAYSTACK_SECRET_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate: must be an admin.
    const authHeader = req.headers.get('authorization');
    const adminId = await requireAdmin(supabase, authHeader);

    console.log(
      `[process-admin-approved-payout] Request from admin ${adminId}`,
    );

    // Parse request body.
    const body = await req.json();
    const { payoutId } = body as { payoutId?: string };

    if (!payoutId) {
      return new Response(
        JSON.stringify({ success: false, error: 'payoutId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch the payout, verifying it is in the 'approved' state.
    const { data: payout, error: fetchError } = await supabase
      .from('payouts')
      .select(
        `id,
         related_group_id,
         recipient_id,
         cycle_number,
         amount,
         approval_status,
         retry_count,
         max_retries,
         users!recipient_id (
           id,
           email,
           full_name,
           account_number,
           account_name,
           bank_code,
           bank_name
         )`,
      )
      .eq('id', payoutId)
      .single();

    if (fetchError || !payout) {
      return new Response(
        JSON.stringify({
          success: false,
          error: fetchError?.message ?? 'Payout not found',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const approvedPayout = payout as ApprovedPayout;

    if (approvedPayout.approval_status !== 'approved') {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Payout approval_status is '${approvedPayout.approval_status}'; only 'approved' payouts may be processed here`,
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(
      `[process-admin-approved-payout] Processing approved payout ${payoutId}`,
    );

    const result = await processApprovedPayout(
      supabase,
      paystackSecretKey,
      adminId,
      approvedPayout,
    );

    return new Response(
      JSON.stringify({ success: result.status !== 'failed', ...result }),
      {
        status: result.status === 'failed' ? 500 : 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[process-admin-approved-payout] Unexpected error:', message);

    const status =
      message.includes('Admin privileges required') ||
      message.includes('Authorization header') ||
      message.includes('Invalid or expired token')
        ? 403
        : 500;

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
