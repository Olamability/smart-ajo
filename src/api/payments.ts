/**
 * Payments API Service
 * 
 * Handles all payment-related operations for the Smart Ajo platform.
 * Integrates with Paystack for payment processing and Supabase for verification.
 * 
 * Payment Flow:
 * 1. Initialize payment record (creates pending payment in DB)
 * 2. Caller handles Paystack payment popup
 * 3. Verify payment via Supabase Edge Function (backend)
 * 4. Activate membership/update records
 */

import { createClient } from '@/lib/client/supabase';
import { getErrorMessage } from '@/lib/utils';

export interface PaymentInitializationResult {
  success: boolean;
  reference?: string;
  error?: string;
}

export interface PaymentVerificationResult {
  success: boolean;
  verified?: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Generate a unique payment reference
 */
function generateReference(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  return `AJO-${timestamp}-${random}`;
}

/**
 * Initialize payment for group creation (creator's initial payment)
 */
export const initializeGroupCreationPayment = async (
  groupId: string,
  amount: number,
  slotNumber: number
): Promise<PaymentInitializationResult> => {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Generate payment reference
    const reference = generateReference();

    // Record payment intent in database
    const { error: recordError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        group_id: groupId,
        amount: amount,
        payment_type: 'group_creation',
        status: 'pending',
        reference: reference,
        metadata: {
          userId: user.id,
          groupId: groupId,
          paymentType: 'group_creation',
          slotNumber: slotNumber,
        },
      });

    if (recordError) {
      console.error('Error recording payment intent:', recordError);
      return { success: false, error: 'Failed to initialize payment' };
    }

    return { success: true, reference };
  } catch (error) {
    console.error('Error initializing group creation payment:', error);
    return { success: false, error: getErrorMessage(error, 'Failed to initialize payment') };
  }
};

/**
 * Initialize payment for joining a group (after approval)
 */
export const initializeGroupJoinPayment = async (
  groupId: string,
  amount: number,
  slotNumber: number
): Promise<PaymentInitializationResult> => {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Generate payment reference
    const reference = generateReference();

    // Record payment intent in database
    const { error: recordError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        group_id: groupId,
        amount: amount,
        payment_type: 'group_join',
        status: 'pending',
        reference: reference,
        metadata: {
          userId: user.id,
          groupId: groupId,
          paymentType: 'group_join',
          slotNumber: slotNumber,
        },
      });

    if (recordError) {
      console.error('Error recording payment intent:', recordError);
      return { success: false, error: 'Failed to initialize payment' };
    }

    return { success: true, reference };
  } catch (error) {
    console.error('Error initializing group join payment:', error);
    return { success: false, error: getErrorMessage(error, 'Failed to initialize payment') };
  }
};

/**
 * Initialize payment for contribution cycle
 */
export const initializeContributionPayment = async (
  groupId: string,
  cycleId: string,
  amount: number
): Promise<PaymentInitializationResult> => {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Generate payment reference
    const reference = generateReference();

    // Record payment intent in database
    const { error: recordError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        group_id: groupId,
        cycle_id: cycleId,
        amount: amount,
        payment_type: 'contribution',
        status: 'pending',
        reference: reference,
        metadata: {
          userId: user.id,
          groupId: groupId,
          paymentType: 'contribution',
          cycleId: cycleId,
        },
      });

    if (recordError) {
      console.error('Error recording payment intent:', recordError);
      return { success: false, error: 'Failed to initialize payment' };
    }

    return { success: true, reference };
  } catch (error) {
    console.error('Error initializing contribution payment:', error);
    return { success: false, error: getErrorMessage(error, 'Failed to initialize payment') };
  }
};

/**
 * Verify payment and activate membership
 * This calls the Supabase Edge Function for secure verification
 */
export const verifyPaymentAndActivateMembership = async (
  reference: string
): Promise<PaymentVerificationResult> => {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Call Supabase Edge Function to verify payment
    const { data, error } = await supabase.functions.invoke('verify-payment', {
      body: { reference },
    });

    if (error) {
      console.error('Error verifying payment:', error);
      return { success: false, error: error.message };
    }

    if (!data.success) {
      return { success: false, error: data.error || 'Payment verification failed' };
    }

    return { success: true, verified: true, data: data.data };
  } catch (error) {
    console.error('Error in payment verification:', error);
    return { success: false, error: getErrorMessage(error, 'Payment verification failed') };
  }
};

/**
 * Verify payment and record contribution
 * This calls the Supabase Edge Function for secure verification
 */
export const verifyPaymentAndRecordContribution = async (
  reference: string
): Promise<PaymentVerificationResult> => {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Call Supabase Edge Function to verify payment
    const { data, error } = await supabase.functions.invoke('verify-payment', {
      body: { reference },
    });

    if (error) {
      console.error('Error verifying payment:', error);
      return { success: false, error: error.message };
    }

    if (!data.success) {
      return { success: false, error: data.error || 'Payment verification failed' };
    }

    return { success: true, verified: true, data: data.data };
  } catch (error) {
    console.error('Error in payment verification:', error);
    return { success: false, error: getErrorMessage(error, 'Payment verification failed') };
  }
};

/**
 * Get payment history for a user
 */
export const getUserPayments = async (): Promise<Record<string, unknown>[]> => {
  try {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Not authenticated');
    }

    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching user payments:', error);
    throw error;
  }
};

/**
 * Get payment by reference
 */
export const getPaymentByReference = async (reference: string): Promise<Record<string, unknown> | null> => {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('reference', reference)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found
        return null;
      }
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error fetching payment by reference:', error);
    throw error;
  }
};
