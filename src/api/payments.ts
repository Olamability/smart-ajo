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
 * Verify payment with backend (with retry logic)
 * 
 * MANDATORY: All payments MUST be verified via backend before being
 * considered successful. Frontend callback does NOT equal payment success.
 * 
 * Implements retry logic to handle cases where Paystack transaction
 * might need a moment to be fully settled after the success callback.
 */
export const verifyPayment = async (
  reference: string,
  retries: number = 3,
  delayMs: number = 2000
): Promise<VerifyPaymentResponse> => {
  let lastError: string = '';
  
  // Get the current session once before attempting retries
  // IMPORTANT: Use getUser() first to validate the token and trigger refresh if needed.
  // getSession() only retrieves from local storage without validation, which can lead to
  // using expired tokens. getUser() makes a network call to verify the JWT is still valid.
  const supabase = createClient();
  
  // First, verify user is authenticated and get a fresh session
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    console.error('User authentication failed:', userError?.message || 'No user found');
    return {
      success: false,
      payment_status: 'unauthorized',
      verified: false,
      amount: 0,
      message: 'Authentication required. Please log in again.',
      error: userError?.message || 'No authenticated user',
    };
  }
  
  // Now get the session which should be fresh after getUser() validates it
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.access_token) {
    console.error('No active session found after user verification');
    return {
      success: false,
      payment_status: 'unauthorized',
      verified: false,
      amount: 0,
      message: 'Session expired. Please log in again.',
      error: 'No active session',
    };
  }
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Verifying payment with reference: ${reference} (attempt ${attempt}/${retries})`);

      // Add a small delay before first retry (not on first attempt)
      if (attempt > 1) {
        console.log(`Waiting ${delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Call the verify-payment Edge Function with explicit authorization header
      const { data, error } = await supabase.functions.invoke('verify-payment', {
        body: { reference },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      console.log('Edge Function response:', { data, error });

      if (error) {
        console.error('Payment verification error:', error);
        lastError = error.message;
        
        // Check if it's a 401 authentication error
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          console.error('Authentication error - session may be invalid or expired');
          return {
            success: false,
            payment_status: 'unauthorized',
            verified: false,
            amount: 0,
            message: 'Your session has expired. Please log out and log in again, then try the payment.',
            error: 'Authentication failed',
          };
        }
        
        // If it's a network error or timeout, retry
        if (attempt < retries && (
          error.message.includes('timeout') || 
          error.message.includes('network') ||
          error.message.includes('fetch')
        )) {
          console.log('Retrying due to network error...');
          continue;
        }
        
        return {
          success: false,
          payment_status: 'unknown',
          verified: false,
          amount: 0,
          message: 'Failed to verify payment',
          error: error.message,
        };
      }

      // Handle case where data is null or undefined
      if (!data) {
        console.error('No data returned from verification');
        lastError = 'No response from verification service';
        
        if (attempt < retries) {
          console.log('Retrying due to empty response...');
          continue;
        }
        
        return {
          success: false,
          payment_status: 'unknown',
          verified: false,
          amount: 0,
          message: 'No response from verification service',
          error: 'No response from verification service',
        };
      }

      // Check if the response has an error field (API-level error)
      if (data.error) {
        console.error('API returned error:', data.error, data.details);
        lastError = data.error;
        
        // Retry if payment is still being processed
        if (attempt < retries && (
          data.payment_status === 'processing' || 
          data.payment_status === 'pending' ||
          data.details?.includes('not found') ||
          data.details?.includes('pending')
        )) {
          console.log('Retrying due to payment still processing...');
          continue;
        }
        
        return {
          success: false,
          payment_status: data.payment_status || 'unknown',
          verified: false,
          amount: data.amount || 0,
          message: data.message || 'Payment verification failed',
          error: data.error,
        };
      }

      // Return successful verification
      console.log('Payment verification successful:', data);
      // Ensure consistent return structure
      return {
        success: data.success !== false,
        payment_status: data.payment_status || 'success',
        verified: data.verified === true,
        amount: data.amount || 0,
        message: data.message || 'Payment verified successfully',
        data: data.data,
      };
    } catch (error) {
      console.error(`Verify payment error (attempt ${attempt}):`, error);
      lastError = getErrorMessage(error, 'Failed to verify payment');
      
      // Retry on exception
      if (attempt < retries) {
        console.log('Retrying due to exception...');
        continue;
      }
    }
  }
  
  // All retries exhausted
  console.error('All verification attempts failed. Last error:', lastError);
  return {
    success: false,
    payment_status: 'unknown',
    verified: false,
    amount: 0,
    message: `Failed to verify payment after ${retries} attempts`,
    error: lastError || 'Verification failed',
  };
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
 * Poll payment status from database
 * Used as a fallback when Edge Function verification has issues
 */
export const pollPaymentStatus = async (
  reference: string,
  maxAttempts: number = 5,
  intervalMs: number = 3000
): Promise<{
  success: boolean;
  verified: boolean;
  payment?: any;
  error?: string;
}> => {
  console.log(`Starting payment status polling for reference: ${reference}`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`Polling attempt ${attempt}/${maxAttempts}`);
    
    const result = await getPaymentStatus(reference);
    
    if (result.success && result.payment) {
      console.log('Payment found:', result.payment);
      
      // Check if payment is verified and successful
      if (result.payment.verified && result.payment.status === 'success') {
        console.log('Payment verified and successful');
        return {
          success: true,
          verified: true,
          payment: result.payment,
        };
      }
      
      // Check if payment failed
      if (result.payment.status === 'failed') {
        console.log('Payment failed');
        return {
          success: false,
          verified: false,
          payment: result.payment,
          error: 'Payment failed',
        };
      }
      
      // Payment still pending, continue polling if we have attempts left
      if (attempt < maxAttempts) {
        console.log(`Payment still pending, waiting ${intervalMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        continue;
      }
    }
    
    // If not found or error, continue polling if we have attempts left
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }
  }
  
  console.log('Payment status polling exhausted all attempts');
  return {
    success: false,
    verified: false,
    error: 'Payment status could not be determined',
  };
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
