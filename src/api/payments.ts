/**
 * Payment Verification API Service
 * 
 * Handles payment verification by calling the backend Edge Function.
 * This follows the mandatory verification flow from "Paystack setup.md":
 * - Frontend initializes payment
 * - Frontend callback triggers verification request
 * - Backend verifies with Paystack API
 * - Backend updates database
 * - Frontend receives confirmation
 */

import { createClient } from '@/lib/client/supabase';
import { getErrorMessage } from '@/lib/utils';

/**
 * Helper function to check if a Supabase session is expired
 */
const isSessionExpired = (session: { expires_at?: number } | null): boolean => {
  if (!session?.expires_at) {
    return true;
  }
  // Supabase returns expires_at as a Unix timestamp in seconds
  return session.expires_at < Date.now() / 1000;
};

interface VerifyPaymentResponse {
  success: boolean;
  payment_status: string;
  verified: boolean;
  amount: number;
  message: string;
  position?: number; // Position assigned to user in group (for group_creation/join payments)
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
  amount: number,
  preferredSlot?: number
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
        preferred_slot: preferredSlot || 1, // Store preferred slot for webhook processing
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
  
  const supabase = createClient();
  
  console.log('=== PAYMENT VERIFICATION FLOW START ===');
  console.log('Reference:', reference);
  console.log('Timestamp:', new Date().toISOString());
  
  // Proactively refresh the session to ensure we have a valid token
  // This is critical for payment flows where the user might have been away from the app
  // (e.g., completing payment on Paystack) and their session may have expired
  console.log('Proactively refreshing session before verification...');
  
  // First, get the current session
  const { data: { session: currentSession } } = await supabase.auth.getSession();
  
  if (!currentSession?.access_token) {
    console.error('No active session found before refresh attempt');
    return {
      success: false,
      payment_status: 'unauthorized',
      verified: false,
      amount: 0,
      message: 'No active session found. Please refresh this page or log in again to verify your payment. Your payment was successful and will be verified once you reconnect.',
      error: 'Session expired - please log in again',
    };
  }
  
  // Try to refresh the session
  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
  
  let activeSession = currentSession; // Start with current session
  
  if (refreshError || !refreshData.session) {
    console.warn('Session refresh failed:', refreshError?.message || 'No session returned');
    console.log('Will attempt to use current session if still valid');
    
    // Check if current session is still valid (not expired)
    if (isSessionExpired(currentSession)) {
      console.error('Current session has expired and refresh failed');
      return {
        success: false,
        payment_status: 'unauthorized',
        verified: false,
        amount: 0,
        message: 'Your session has expired. Please refresh this page or log in again to verify your payment. Your payment was successful and will be verified once you reconnect.',
        error: 'Session expired and refresh failed',
      };
    }
    
    // Current session is still valid, continue with it
    console.log('Current session is still valid, will use it');
  } else {
    console.log('Session refreshed successfully');
    activeSession = refreshData.session;
    
    // CRITICAL: Verify the refreshed session is actually valid
    // Sometimes refreshSession() returns a new session but with an expired token
    if (isSessionExpired(activeSession)) {
      console.error('Refreshed session is already expired!');
      return {
        success: false,
        payment_status: 'unauthorized',
        verified: false,
        amount: 0,
        message: 'Session refresh returned an expired token. Please refresh this page or log in again to verify your payment. Your payment was successful and will be verified once you reconnect.',
        error: 'Refreshed session is expired',
      };
    }
  }
  
  // Verify we have a valid user with the active session
  const { data: { user }, error: userError } = await supabase.auth.getUser(activeSession.access_token);
  
  if (userError || !user) {
    console.error('User authentication failed with active session:', userError?.message || 'No user found');
    return {
      success: false,
      payment_status: 'unauthorized',
      verified: false,
      amount: 0,
      message: 'Authentication failed. Please log in again.',
      error: userError?.message || 'No authenticated user',
    };
  }
  
  // Don't log PII in production
  if (import.meta.env.DEV) {
    console.log('User authenticated:', user.id);
    console.log('User email:', user.email);
    console.log('Token expires at:', new Date(activeSession.expires_at! * 1000).toISOString());
  } else {
    console.log('User authenticated successfully');
    console.log('Session valid until:', new Date(activeSession.expires_at! * 1000).toISOString());
  }
  
  console.log('Session valid. Token length:', activeSession.access_token.length);
  
  // CRITICAL FIX: Instead of relying on automatic session propagation,
  // explicitly pass the access token in the Authorization header.
  // This ensures the Edge Function receives the fresh token immediately,
  // avoiding race conditions with session storage updates.
  console.log('Preparing to call Edge Function with explicit token...');
  const accessToken = activeSession.access_token;
  console.log('Access token available:', !!accessToken, 'Length:', accessToken.length);
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Verification attempt ${attempt}/${retries} for reference: ${reference}`);

      // Add a small delay before retry (not on first attempt)
      if (attempt > 1) {
        const waitTime = delayMs * attempt; // Exponential backoff
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Call the verify-payment Edge Function
      // IMPORTANT: Explicitly pass the Authorization header with the fresh token
      // to avoid relying on automatic session propagation which can have timing issues
      console.log('Calling Edge Function with explicit authorization...');
      const { data, error } = await supabase.functions.invoke('verify-payment', {
        body: { reference },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      console.log('Edge Function response received:', { 
        hasData: !!data, 
        hasError: !!error,
        dataKeys: data ? Object.keys(data) : [],
        errorMessage: error?.message 
      });

      if (error) {
        console.error('Payment verification error:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        lastError = error.message;
        
        // Best Practice: Check for specific error types with context
        const errorContext = (error as any).context;
        const statusCode = errorContext?.status;
        
        // Check if edge function doesn't exist (404 Not Found)
        if (statusCode === 404 || 
            error.message.includes('404') || 
            error.message.toLowerCase().includes('not found')) {
          console.error('Edge Function not found - verify-payment may not be deployed');
          console.error('Deployment required: Ensure edge functions are deployed to Supabase');
          return {
            success: false,
            payment_status: 'service_unavailable',
            verified: false,
            amount: 0,
            message: 'Payment verification service is not available. Please contact support.',
            error: 'Edge Function not deployed',
          };
        }
        
        // Check if it's a 401 authentication error using context if available
        // FunctionsHttpError may have context.status
        const isAuthError = statusCode === 401 ||
                           error.message.includes('401') || 
                           error.message.includes('Unauthorized') ||
                           error.message.includes('Authentication');
        
        if (isAuthError) {
          console.error('Authentication error detected despite explicit token passing');
          console.error('This indicates either:');
          console.error('  1. The refreshed token is invalid or expired');
          console.error('  2. Backend auth service is unavailable');
          console.error('  3. Token was not properly extracted from request');
          console.error('Auth error details:', { 
            errorMessage: error.message,
            statusCode,
            attempt,
            hasContext: !!errorContext,
            tokenProvided: !!accessToken,
            tokenLength: accessToken?.length || 0
          });
          
          // Log session details for debugging (non-PII)
          console.error('Session state:', {
            hasSession: !!activeSession,
            expiresAt: activeSession.expires_at ? new Date(activeSession.expires_at * 1000).toISOString() : 'unknown',
            isExpired: activeSession.expires_at ? activeSession.expires_at < Date.now() / 1000 : true
          });
          
          return {
            success: false,
            payment_status: 'unauthorized',
            verified: false,
            amount: 0,
            message: 'Session expired during payment verification. Please refresh this page to retry. Your payment was successful and will be verified once you reconnect.',
            error: 'Authentication failed - token validation error',
          };
        }
        
        // Check for server errors (500, 502, 503, 504)
        if (statusCode && statusCode >= 500) {
          console.error(`Server error detected (${statusCode}). Edge function may be experiencing issues.`);
          if (attempt < retries) {
            console.log('Server error - will retry...');
            continue;
          }
          return {
            success: false,
            payment_status: 'service_error',
            verified: false,
            amount: 0,
            message: 'Payment verification service is temporarily unavailable. Please try again in a few moments.',
            error: `Server error: ${statusCode}`,
          };
        }
        
        // If it's a network error or timeout, retry
        if (attempt < retries && (
          error.message.includes('timeout') || 
          error.message.includes('network') ||
          error.message.includes('fetch') ||
          error.message.includes('Failed to fetch')
        )) {
          console.log('Network error detected, will retry...');
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
          console.log('Will retry due to empty response...');
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

      console.log('Verification data received:', {
        success: data.success,
        payment_status: data.payment_status,
        verified: data.verified,
        amount: data.amount,
        hasError: !!data.error
      });

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
          console.log('Payment still processing, will retry...');
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
      console.log('Payment verification successful!');
      console.log('=== PAYMENT VERIFICATION FLOW END (SUCCESS) ===');
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
      console.error(`Verify payment exception (attempt ${attempt}):`, error);
      console.error('Exception type:', error?.constructor?.name);
      console.error('Exception message:', error?.message);
      lastError = getErrorMessage(error, 'Failed to verify payment');
      
      // Retry on exception
      if (attempt < retries) {
        console.log('Will retry due to exception...');
        continue;
      }
    }
  }
  
  // All retries exhausted
  console.error('All verification attempts failed. Last error:', lastError);
  console.error('=== PAYMENT VERIFICATION FLOW END (FAILED) ===');
  return {
    success: false,
    payment_status: 'unknown',
    verified: false,
    amount: 0,
    message: `Failed to verify payment after ${retries} attempts. ${lastError}`,
    error: lastError || 'Verification failed',
  };
};

/**
 * DEPRECATED: Process group creation payment after verification
 * This function is no longer needed - the verify-payment Edge Function now handles all business logic.
 * Kept for backward compatibility only.
 * @deprecated Use verifyPayment() instead - it handles everything on the backend.
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
 * DEPRECATED: Process group join payment after verification
 * This function is no longer needed - the verify-payment Edge Function now handles all business logic.
 * Kept for backward compatibility only.
 * @deprecated Use verifyPayment() instead - it handles everything on the backend.
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
 * DEPRECATED: Process group join payment after admin approval
 * This function is no longer needed - the verify-payment Edge Function now handles all business logic.
 * Kept for backward compatibility only.
 * @deprecated Use verifyPayment() instead - it handles everything on the backend.
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
 * DEPRECATED: Poll payment status from database
 * This function is no longer needed - payment verification should only happen via the Edge Function.
 * Polling creates race conditions and should not be used.
 * @deprecated Do not use polling - rely on verify-payment Edge Function only.
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
