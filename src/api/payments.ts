/**
 * Payment Verification API Service
 * 
 * Handles payment verification by calling the backend Edge Function.
 * This follows the mandatory verification flow from "Paystack steup.md":
 * - Frontend initializes payment
 * - Frontend callback triggers verification request
 * - Backend verifies with Paystack API
 * - Backend updates database
 * - Frontend receives confirmation
 */

import { createClient } from '@/lib/client/supabase';
import { getErrorMessage } from '@/lib/utils';

interface VerifyPaymentResponse {
  success: boolean;
  payment_status: string;
  verified: boolean;
  amount: number;
  message: string;
  data?: {
    reference: string;
    amount: number;
    currency: string;
    channel: string;
    paid_at: string;
  };
  error?: string;
}

/**
 * Initialize payment for group creation (security deposit + first contribution)
 * Returns payment reference to be used with Paystack
 */
export const initializeGroupCreationPayment = async (
  groupId: string,
  amount: number
): Promise<{ success: boolean; reference?: string; error?: string }> => {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Validate groupId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(groupId)) {
      return { success: false, error: 'Invalid group ID' };
    }

    // Generate unique payment reference using UUID for better uniqueness
    const uniqueId = crypto.randomUUID().substring(0, 8);
    const reference = `GRP_CREATE_${groupId.substring(0, 8)}_${uniqueId}`;

    // Create pending payment record
    const { error } = await supabase.from('payments').insert({
      reference,
      user_id: user.id,
      amount: amount * 100, // Convert to kobo
      currency: 'NGN',
      status: 'pending',
      email: user.email,
      channel: 'card', // Default, will be updated after payment
      verified: false,
      metadata: {
        type: 'group_creation',
        group_id: groupId,
        user_id: user.id,
      },
    });

    if (error) {
      console.error('Error creating payment record:', error);
      return { success: false, error: error.message };
    }

    return { success: true, reference };
  } catch (error) {
    console.error('Initialize group creation payment error:', error);
    return { success: false, error: getErrorMessage(error, 'Failed to initialize payment') };
  }
};

/**
 * Initialize payment for joining a group (security deposit + first contribution)
 * Returns payment reference to be used with Paystack
 */
export const initializeGroupJoinPayment = async (
  groupId: string,
  amount: number
): Promise<{ success: boolean; reference?: string; error?: string }> => {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Validate groupId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(groupId)) {
      return { success: false, error: 'Invalid group ID' };
    }

    // Generate unique payment reference using UUID for better uniqueness
    const uniqueId = crypto.randomUUID().substring(0, 8);
    const reference = `GRP_JOIN_${groupId.substring(0, 8)}_${uniqueId}`;

    // Create pending payment record
    const { error } = await supabase.from('payments').insert({
      reference,
      user_id: user.id,
      amount: amount * 100, // Convert to kobo
      currency: 'NGN',
      status: 'pending',
      email: user.email,
      channel: 'card', // Default, will be updated after payment
      verified: false,
      metadata: {
        type: 'group_join',
        group_id: groupId,
        user_id: user.id,
      },
    });

    if (error) {
      console.error('Error creating payment record:', error);
      return { success: false, error: error.message };
    }

    return { success: true, reference };
  } catch (error) {
    console.error('Initialize group join payment error:', error);
    return { success: false, error: getErrorMessage(error, 'Failed to initialize payment') };
  }
};

/**
 * Verify payment with backend
 * 
 * MANDATORY: All payments MUST be verified via backend before being
 * considered successful. Frontend callback does NOT equal payment success.
 */
export const verifyPayment = async (
  reference: string
): Promise<VerifyPaymentResponse> => {
  try {
    const supabase = createClient();

    // Call the verify-payment Edge Function
    const { data, error } = await supabase.functions.invoke('verify-payment', {
      body: { reference },
    });

    if (error) {
      console.error('Payment verification error:', error);
      return {
        success: false,
        payment_status: 'unknown',
        verified: false,
        amount: 0,
        message: 'Failed to verify payment',
        error: error.message,
      };
    }

    return data;
  } catch (error) {
    console.error('Verify payment error:', error);
    return {
      success: false,
      payment_status: 'unknown',
      verified: false,
      amount: 0,
      message: 'Failed to verify payment',
      error: getErrorMessage(error, 'Failed to verify payment'),
    };
  }
};

/**
 * Process group creation payment after verification
 * Activates the creator as a member after payment is verified
 */
export const processGroupCreationPayment = async (
  reference: string,
  groupId: string,
  preferredSlot?: number
): Promise<{ success: boolean; error?: string }> => {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Call database function to process payment with slot selection
    const { data, error } = await supabase.rpc('process_group_creation_payment', {
      p_payment_reference: reference,
      p_group_id: groupId,
      p_user_id: user.id,
      p_preferred_slot: preferredSlot || 1, // Default to slot 1 if not specified
    });

    if (error) {
      console.error('Error processing group creation payment:', error);
      return { success: false, error: error.message };
    }

    // Check result from function
    if (data && data.length > 0) {
      const result = data[0];
      if (!result.success) {
        return { success: false, error: result.error_message };
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Process group creation payment error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to process payment'),
    };
  }
};

/**
 * Process group join payment after verification
 * Adds the member to the group after payment is verified
 */
export const processGroupJoinPayment = async (
  reference: string,
  groupId: string
): Promise<{ success: boolean; position?: number; error?: string }> => {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Call database function to process payment
    const { data, error } = await supabase.rpc('process_group_join_payment', {
      p_payment_reference: reference,
      p_group_id: groupId,
      p_user_id: user.id,
    });

    if (error) {
      console.error('Error processing group join payment:', error);
      return { success: false, error: error.message };
    }

    // Check result from function
    if (data && data.length > 0) {
      const result = data[0];
      if (!result.success) {
        return { success: false, error: result.error_message };
      }
      return { success: true, position: result.position };
    }

    return { success: true };
  } catch (error) {
    console.error('Process group join payment error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to process payment'),
    };
  }
};

/**
 * Process group join payment after admin approval
 * Adds the member to the group after payment is verified (for approved join requests)
 */
export const processApprovedJoinPayment = async (
  reference: string,
  groupId: string
): Promise<{ success: boolean; position?: number; error?: string }> => {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Call database function to process approved join payment
    const { data, error } = await supabase.rpc('process_approved_join_payment', {
      p_payment_reference: reference,
      p_group_id: groupId,
      p_user_id: user.id,
    });

    if (error) {
      console.error('Error processing approved join payment:', error);
      return { success: false, error: error.message };
    }

    // Check result from function
    if (data && data.length > 0) {
      const result = data[0];
      if (!result.success) {
        return { success: false, error: result.error_message };
      }
      return { success: true, position: result.position };
    }

    return { success: true };
  } catch (error) {
    console.error('Process approved join payment error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to process payment'),
    };
  }
};

/**
 * Get payment status from database
 * Used to check if a payment has been verified and processed
 */
export const getPaymentStatus = async (
  reference: string
): Promise<{
  success: boolean;
  payment?: {
    id: string;
    reference: string;
    status: string;
    verified: boolean;
    amount: number;
    paid_at: string;
  };
  error?: string;
}> => {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('payments')
      .select('id, reference, status, verified, amount, paid_at')
      .eq('reference', reference)
      .maybeSingle();

    if (error) {
      console.error('Error fetching payment status:', error);
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: 'Payment not found' };
    }

    return { success: true, payment: data };
  } catch (error) {
    console.error('Get payment status error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch payment status'),
    };
  }
};
