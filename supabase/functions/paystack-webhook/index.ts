/**
 * Paystack Webhook Handler - Clean Implementation
 * 
 * This Edge Function handles webhooks from Paystack.
 * 
 * This acts as a BACKUP/SECONDARY payment processor:
 * - PRIMARY: verify-payment Edge Function (user-initiated, synchronous)
 * - BACKUP: This webhook (Paystack-initiated, asynchronous)
 * 
 * Webhooks ensure payments are processed even if:
 * - User closes browser before verification completes
 * - Network fails during frontend callback
 * - verify-payment function fails temporarily
 * 
 * Business logic is idempotent - safe to execute multiple times.
 * 
 * Handles events:
 * - charge.success: Successful payments
 * - charge.failed: Failed payments
 * 
 * Security:
 * - Validates Paystack signature using HMAC SHA512
 * - Only processes verified webhooks
 * - Uses service role for database updates
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  processGroupCreationPayment,
  processGroupJoinPayment,
} from "../_shared/payment-processor.ts";

// ============================================================================
// CORS HEADERS
// ============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-paystack-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// ============================================================================
// TYPES
// ============================================================================

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
      preferred_slot?: number | string;
      [key: string]: any;
    };
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Verify Paystack webhook signature using Web Crypto API
 */
async function verifySignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(payload);
    
    // Import key for HMAC-SHA512
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );
    
    // Generate HMAC signature
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData);
    
    // Convert to hex string
    const hash = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return hash === signature;
  } catch (error) {
    console.error('[Signature] Verification error:', error);
    return false;
  }
}

/**
 * Store payment record in database
 * Idempotent: Safe to call multiple times
 */
async function storePaymentRecord(
  supabase: any,
  data: PaystackEvent['data']
): Promise<{ success: boolean; message: string }> {
  console.log('[Payment Store] Storing payment:', data.reference);
  console.log('[Payment Store] Status:', data.status);
  
  const paymentData = {
    reference: data.reference,
    user_id: data.metadata?.user_id || null,
    amount: data.amount,
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

  // Check if payment exists (idempotency)
  const { data: existing, error: existingError } = await supabase
    .from('payments')
    .select('id, verified, status')
    .eq('reference', data.reference)
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
      console.log('[Payment Store] Already verified (duplicate webhook)');
      return {
        success: true,
        message: 'Payment already verified',
      };
    }

    // Update existing record
    const { error } = await supabase
      .from('payments')
      .update(paymentData)
      .eq('reference', data.reference);

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
    message: 'Payment record stored successfully',
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
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    
    // Get Paystack secret key
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) {
      console.error('[Config] PAYSTACK_SECRET_KEY not configured');
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
    console.log('[Signature] Signature present:', !!signature);
    
    if (!signature) {
      console.error('[Signature] No signature provided');
      return new Response(
        JSON.stringify({ error: 'No signature provided' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const isValid = await verifySignature(rawBody, signature, paystackSecret);
    console.log('[Signature] Valid:', isValid);
    
    if (!isValid) {
      console.error('[Signature] Invalid signature');
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse webhook payload
    const event: PaystackEvent = JSON.parse(rawBody);
    console.log('[Webhook] Event:', event.event);
    console.log('[Webhook] Reference:', event.data.reference);

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Store payment record (ALWAYS, regardless of event type)
    const storeResult = await storePaymentRecord(supabase, event.data);
    if (!storeResult.success) {
      console.error('[Webhook] Failed to store payment:', storeResult.message);
      // Continue processing but log the error
    }

    // Step 2: Process based on event type
    let result = { success: false, message: 'Event not processed' };

    switch (event.event) {
      case 'charge.success': {
        const paymentType = event.data.metadata?.type;
        
        console.log('[Webhook] Processing charge.success');
        console.log('[Webhook] Payment type:', paymentType);

        if (paymentType === 'group_creation') {
          result = await processGroupCreationPayment(supabase, event.data);
        } else if (paymentType === 'group_join') {
          result = await processGroupJoinPayment(supabase, event.data);
        } else {
          console.warn('[Webhook] Unknown payment type:', paymentType);
          result = { 
            success: false, 
            message: `Unknown payment type: ${paymentType}` 
          };
        }
        break;
      }

      case 'charge.failed': {
        console.log('[Webhook] Payment failed:', event.data.reference);
        result = { 
          success: true, 
          message: 'Payment failure recorded' 
        };
        break;
      }

      default: {
        console.log('[Webhook] Unhandled event type:', event.event);
        result = { 
          success: true, 
          message: 'Event received but not processed' 
        };
      }
    }

    console.log('[Webhook] Processing result:', result.success ? 'SUCCESS' : 'FAILED');
    console.log('=== WEBHOOK END ===');

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
    console.error('=== WEBHOOK ERROR ===');
    console.error('Error:', error.message);
    console.error('=== END ERROR ===');
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
