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
import { calculateBackoffDelay } from '@/lib/utils/auth';

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
 * Helper to ensure session is available (with retry logic for post-redirect scenarios)
 * After payment redirects, session might need time to be restored from storage
 */
async function ensureSessionAvailable(maxAttempts = 5): Promise<boolean> {
  const supabase = createClient();
  
  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('ensureSessionAvailable: Session error:', error);
      if (attempts < maxAttempts - 1) {
        const delay = calculateBackoffDelay(attempts);
        console.log(`ensureSessionAvailable: Retrying in ${delay}ms (attempt ${attempts + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      return false;
    }
    
    if (session) {
      console.log('ensureSessionAvailable: Session is available');
      return true;
    }
    
    // No session yet, wait and retry
    if (attempts < maxAttempts - 1) {
      const delay = calculateBackoffDelay(attempts);
      console.log(`ensureSessionAvailable: Session not ready, retrying in ${delay}ms (attempt ${attempts + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  console.log('ensureSessionAvailable: Session not available after retries');
  return false;
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
      .from('transactions')
      .insert({
        user_id: user.id,
        group_id: groupId,
        amount: amount,
        type: 'contribution',
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
      .from('transactions')
      .insert({
        user_id: user.id,
        group_id: groupId,
        amount: amount,
        type: 'contribution',
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
 * Initialize Paystack payment for an Ajo contribution.
 *
 * @param params.email - User email address for Paystack
 * @param params.amountInKobo - Contribution amount in kobo (smallest currency unit)
 * @param params.ajoGroupId - The Ajo group ID
 * @param params.contributionId - The contribution record ID to update after payment
 * @returns PaymentInitializationResult with a unique reference on success
 */
export const initializeAjoContributionPayment = async (params: {
  email: string;
  amountInKobo: number;
  ajoGroupId: string;
  contributionId: string;
}): Promise<PaymentInitializationResult> => {
  const { amountInKobo, ajoGroupId, contributionId } = params;
  try {
    const supabase = createClient();

    // Get current user for user_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Generate unique payment reference
    const reference = generateReference();

    // Record payment intent in database
    const { error: recordError } = await supabase
      .from('transactions')
      .insert({
        user_id: user.id,
        group_id: ajoGroupId,
        amount: amountInKobo,
        type: 'contribution',
        status: 'pending',
        reference,
        metadata: {
          userId: user.id,
          groupId: ajoGroupId,
          paymentType: 'contribution',
          contributionId,
        },
      });

    if (recordError) {
      console.error('Error recording Ajo contribution payment intent:', recordError);
      return { success: false, error: 'Failed to initialize payment' };
    }

    return { success: true, reference };
  } catch (error) {
    console.error('Error initializing Ajo contribution payment:', error);
    return { success: false, error: getErrorMessage(error, 'Failed to initialize payment') };
  }
};

/**
 * Initialize payment for contribution cycle
 * @param groupId - The group ID
 * @param contributionId - The contribution record ID to update after payment
 * @param amount - The contribution amount
 */
export const initializeContributionPayment = async (
  groupId: string,
  contributionId: string,
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
      .from('transactions')
      .insert({
        user_id: user.id,
        group_id: groupId,
        amount: amount,
        type: 'contribution',
        status: 'pending',
        reference: reference,
        metadata: {
          userId: user.id,
          groupId: groupId,
          paymentType: 'contribution',
          contributionId: contributionId,
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
    console.log('verifyPaymentAndActivateMembership: Starting verification for reference:', reference);
    
    // Ensure session is available before attempting verification
    // This is crucial after payment redirects
    const sessionAvailable = await ensureSessionAvailable();
    if (!sessionAvailable) {
      console.error('verifyPaymentAndActivateMembership: Session not available');
      return { success: false, error: 'Session not available. Please try refreshing the page or logging in again.' };
    }
    
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    console.log('verifyPaymentAndActivateMembership: Calling verify-payment function');
    // Call Supabase Edge Function to verify payment
    const { data, error } = await supabase.functions.invoke('verify-payment', {
      body: { reference },
    });

    if (error) {
      console.error('verifyPaymentAndActivateMembership: Error verifying payment:', error);
      return { success: false, error: error.message };
    }

    if (!data.success) {
      console.error('verifyPaymentAndActivateMembership: Payment verification failed:', data.error);
      return { success: false, error: data.error || 'Payment verification failed' };
    }

    console.log('verifyPaymentAndActivateMembership: Payment verified successfully');
    return { success: true, verified: true, data: data.data };
  } catch (error) {
    console.error('verifyPaymentAndActivateMembership: Error in payment verification:', error);
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
    console.log('verifyPaymentAndRecordContribution: Starting verification for reference:', reference);
    
    // Ensure session is available before attempting verification
    const sessionAvailable = await ensureSessionAvailable();
    if (!sessionAvailable) {
      console.error('verifyPaymentAndRecordContribution: Session not available');
      return { success: false, error: 'Session not available. Please try refreshing the page or logging in again.' };
    }
    
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    console.log('verifyPaymentAndRecordContribution: Calling verify-payment function');
    // Call Supabase Edge Function to verify payment
    const { data, error } = await supabase.functions.invoke('verify-payment', {
      body: { reference },
    });

    if (error) {
      console.error('verifyPaymentAndRecordContribution: Error verifying payment:', error);
      return { success: false, error: error.message };
    }

    if (!data.success) {
      console.error('verifyPaymentAndRecordContribution: Payment verification failed:', data.error);
      return { success: false, error: data.error || 'Payment verification failed' };
    }

    console.log('verifyPaymentAndRecordContribution: Payment verified successfully');
    return { success: true, verified: true, data: data.data };
  } catch (error) {
    console.error('verifyPaymentAndRecordContribution: Error in payment verification:', error);
    return { success: false, error: getErrorMessage(error, 'Payment verification failed') };
  }
};

/**
 * Verify a contribution payment via the dedicated verify-contribution Edge Function.
 *
 * This calls the `/verify-contribution` endpoint which:
 * 1. Verifies the payment reference with Paystack
 * 2. Marks the transaction as completed
 * 3. Marks the contribution as paid
 * 4. Updates the group balance (total_collected)
 *
 * @param reference - The Paystack payment reference to verify
 */
export const verifyContributionPayment = async (
  reference: string
): Promise<PaymentVerificationResult> => {
  try {
    console.log('verifyContributionPayment: Starting verification for reference:', reference);

    // Ensure session is available before attempting verification
    const sessionAvailable = await ensureSessionAvailable();
    if (!sessionAvailable) {
      console.error('verifyContributionPayment: Session not available');
      return { success: false, error: 'Session not available. Please try refreshing the page or logging in again.' };
    }

    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    console.log('verifyContributionPayment: Calling verify-contribution function');
    // Call the dedicated verify-contribution Edge Function
    const { data, error } = await supabase.functions.invoke('verify-contribution', {
      body: { reference },
    });

    if (error) {
      console.error('verifyContributionPayment: Error verifying contribution payment:', error);
      return { success: false, error: error.message };
    }

    if (!data.success) {
      console.error('verifyContributionPayment: Contribution payment verification failed:', data.error);
      return { success: false, error: data.error || 'Contribution payment verification failed' };
    }

    console.log('verifyContributionPayment: Contribution payment verified successfully');
    return { success: true, verified: true, data: data.data };
  } catch (error) {
    console.error('verifyContributionPayment: Error in contribution payment verification:', error);
    return { success: false, error: getErrorMessage(error, 'Contribution payment verification failed') };
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
      .from('transactions')
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
      .from('transactions')
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
