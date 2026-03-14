/**
 * initialize-payment Edge Function
 *
 * Creates a pending transaction record and returns the payment reference.
 * Called by the frontend before opening the Paystack popup.
 *
 * Request body:
 * {
 *   groupId: string;
 *   amount: number;          // in kobo
 *   paymentType: 'group_creation' | 'group_join' | 'contribution';
 *   slotNumber?: number;     // for group_creation / group_join
 *   contributionId?: string; // for contribution
 *   cycleNumber?: number;    // for contribution (informational)
 * }
 *
 * Response:
 * {
 *   reference: string;
 *   amount: number;
 *   email: string;
 * }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function generateReference(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `ajo_txn_${ts}_${rand}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error('Supabase credentials not configured');
    }

    // Authenticate the calling user via their JWT
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionFromUrl: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token);

    if (authError || !user) {
      console.error('[initialize-payment] Auth error:', authError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Unauthorized',
          details: authError?.message ?? 'User not found'
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rate limit: max 10 payment initialisations per user per 60 seconds
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: rateLimitOk, error: rlError } = await adminClient.rpc('check_rate_limit', {
      p_identifier: `user:${user.id}`,
      p_action: 'payment_init',
      p_max_requests: 10,
      p_window_secs: 60,
    });

    if (rlError) {
      console.warn('[initialize-payment] Rate limit check failed (non-blocking):', rlError.message);
    } else if (rateLimitOk === false) {
      console.warn('[initialize-payment] Rate limit exceeded for user:', user.id);
      return new Response(
        JSON.stringify({ success: false, error: 'Too many requests. Please wait before trying again.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' } }
      );
    }

    const body = await req.json();
    const { groupId, amount, paymentType, slotNumber, contributionId, cycleNumber } = body as {
      groupId: string;
      amount: number;
      paymentType: string;
      slotNumber?: number;
      contributionId?: string;
      cycleNumber?: number;
    };

    if (!groupId || !amount || !paymentType) {
      return new Response(
        JSON.stringify({ success: false, error: 'groupId, amount and paymentType are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const reference = generateReference();

    // Map paymentType to the transaction_type_enum value in the DB.
    // group_creation / group_join are security deposits; contribution is a regular contribution.
    const transactionType =
      paymentType === 'contribution' ? 'contribution' : 'security_deposit';

    // Use service role client to insert the transaction (bypasses RLS).
    const supabase = adminClient;

    const { error: insertError } = await supabase.from('transactions').insert({
      user_id: user.id,
      group_id: groupId,
      amount,
      type: transactionType,
      status: 'pending',
      reference,
      description: paymentType === 'group_join' || paymentType === 'group_creation'
        ? 'Security Deposit + 1st Contribution + Service Fee'
        : paymentType === 'contribution' ? `Contribution Cycle ${cycleNumber || ''}` : undefined,
      metadata: {
        userId: user.id,
        groupId,
        paymentType,
        ...(slotNumber !== undefined ? { slotNumber } : {}),
        ...(contributionId ? { contributionId } : {}),
        ...(cycleNumber !== undefined ? { cycleNumber } : {}),
      },
    });

    if (insertError) {
      console.error('[initialize-payment] DB insert error:', insertError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create payment record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Write audit log for payment initialization
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      user_email: user.email,
      action: 'payment_initialized',
      resource_type: 'transaction',
      resource_id: reference,
      details: {
        groupId,
        paymentType,
        amount,
        ...(slotNumber !== undefined ? { slotNumber } : {}),
        ...(contributionId ? { contributionId } : {}),
        ...(cycleNumber !== undefined ? { cycleNumber } : {}),
      },
    }).then(({ error }) => {
      if (error) console.error('[initialize-payment] Audit log insert failed:', error);
    });

    console.log('[initialize-payment] Pending transaction created', {
      reference,
      userId: user.id,
      groupId,
      paymentType,
      amount,
    });

    return new Response(
      JSON.stringify({ success: true, reference, amount, email: user.email }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[initialize-payment] Unexpected error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
