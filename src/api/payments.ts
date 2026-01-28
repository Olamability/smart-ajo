/**
 * Payment API Service - Clean Implementation
 * 
 * This module provides a minimal, clean interface for payment operations.
 * 
 * SECURITY ARCHITECTURE:
 * ======================
 * 
 * FRONTEND (this file):
 * - Uses Paystack PUBLIC key only (safe for browser)
 * - Initializes payments and creates pending records
 * - Calls backend for verification (never trusts client-side data)
 * - Displays results from backend
 * 
 * BACKEND (Supabase Edge Functions):
 * - Uses Paystack SECRET key (never exposed to frontend)
 * - Verifies payments with Paystack API
 * - Executes business logic (add members, activate memberships)
 * - Single source of truth for payment status
 * 
 * Architecture Principles:
 * ✅ Backend is the single source of truth for payment state
 * ✅ Frontend only initiates payments and displays backend-confirmed results
 * ✅ No frontend state management for payment verification
 * ✅ All business logic executed on backend
 * ✅ Proper idempotency throughout
 * ✅ JWT authentication for all backend calls
 * ✅ Row-level security on database
 * 
 * Payment Verification Flow:
 * ==========================
 * 
 * 1. INITIALIZATION (Frontend):
 *    - User clicks "Join Group" or "Pay Contribution"
 *    - Call initializeGroupJoinPayment() or initializeContributionPayment()
 *    - Creates PENDING payment record in database
 *    - Returns unique payment reference
 * 
 * 2. PAYMENT (Paystack):
 *    - Open Paystack modal with reference
 *    - User completes payment on Paystack's platform
 *    - Paystack validates payment method
 *    - User redirected back with reference in URL
 * 
 * 3. VERIFICATION (Backend via this file's verifyPayment function):
 *    - Frontend calls verifyPayment(reference)
 *    - Backend Edge Function:
 *      a. Authenticates user (JWT token)
 *      b. Calls Paystack API with SECRET key
 *      c. Validates payment actually succeeded
 *      d. Stores payment record in database
 *      e. EXECUTES BUSINESS LOGIC:
 *         - Adds member to group
 *         - Activates membership (has_paid_security_deposit = true)
 *         - Assigns payout position
 *         - Creates contribution records
 *      f. Returns verification result
 * 
 * 4. CONFIRMATION (Frontend):
 *    - Display success/failure to user
 *    - Redirect to group page (membership now active)
 * 
 * 5. BACKUP (Webhook):
 *    - Paystack sends webhook notification
 *    - Edge Function processes same business logic
 *    - Idempotent: Safe if already processed
 * 
 * Why This Architecture is Secure:
 * =================================
 * 
 * ❌ INSECURE (what we DON'T do):
 *    if (paystackCallback.status === 'success') {
 *      addUserToGroup();  // ❌ Client can fake this!
 *    }
 * 
 * ✅ SECURE (what we DO):
 *    - Client calls backend with reference
 *    - Backend verifies with Paystack using SECRET key
 *    - Backend executes business logic after verification
 *    - Client displays result from backend
 * 
 * This prevents:
 * - Payment fraud (can't fake successful payment)
 * - Unauthorized access (can't add themselves without paying)
 * - Data tampering (all changes via backend with proper auth)
 */

import { createClient } from '@/lib/client/supabase';
import { getErrorMessage } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

export interface PaymentInitResult {
  success: boolean;
  reference?: string;
  error?: string;
}

export interface PaymentVerificationResult {
  success: boolean;
  verified: boolean;
  payment_status: string;
  amount: number;
  message: string;
  position?: number; // For group payments - assigned position
  data?: {
    reference: string;
    amount: number;
    currency: string;
    channel: string;
    paid_at: string;
  };
  error?: string;
}

export interface PaymentStatus {
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
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PREFERRED_SLOT = 1;
const VERIFICATION_RETRIES = 3;
const VERIFICATION_DELAY_MS = 2000;

// ============================================================================
// PAYMENT INITIALIZATION
// ============================================================================

/**
 * Initialize payment for group creation
 * Creates a pending payment record in the database
 * 
 * @param groupId - The group ID
 * @param amount - Total amount in Naira (will be converted to kobo)
 * @param preferredSlot - Optional preferred payout slot position
 * @returns Payment reference to use with Paystack
 */
export async function initializeGroupCreationPayment(
  groupId: string,
  amount: number,
  preferredSlot?: number
): Promise<PaymentInitResult> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    // Validate groupId format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(groupId)) {
      return { success: false, error: 'Invalid group ID format' };
    }

    // Generate unique reference
    const uniqueId = crypto.randomUUID().substring(0, 8);
    const reference = `GRP_CREATE_${groupId.substring(0, 8)}_${uniqueId}`;

    // Create pending payment record
    const { error } = await supabase.from('payments').insert({
      reference,
      user_id: user.id,
      amount: Math.round(amount * 100), // Convert to kobo
      currency: 'NGN',
      status: 'pending',
      email: user.email,
      channel: 'card',
      verified: false,
      metadata: {
        type: 'group_creation',
        group_id: groupId,
        user_id: user.id,
        preferred_slot: preferredSlot || DEFAULT_PREFERRED_SLOT,
      },
    });

    if (error) {
      console.error('[Payment Init] Failed to create payment record:', error);
      return { success: false, error: error.message };
    }

    console.log('[Payment Init] Created pending payment:', reference);
    return { success: true, reference };
  } catch (error) {
    console.error('[Payment Init] Exception:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to initialize payment'),
    };
  }
}

/**
 * Initialize payment for joining a group
 * Creates a pending payment record in the database
 * 
 * @param groupId - The group ID
 * @param amount - Total amount in Naira (will be converted to kobo)
 * @param preferredSlot - Optional preferred payout slot position
 * @returns Payment reference to use with Paystack
 */
export async function initializeGroupJoinPayment(
  groupId: string,
  amount: number,
  preferredSlot?: number
): Promise<PaymentInitResult> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    // Validate groupId format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(groupId)) {
      return { success: false, error: 'Invalid group ID format' };
    }

    // Get preferred slot from join request if not provided
    let slotToUse = preferredSlot;
    if (!slotToUse) {
      const { data: joinRequest } = await supabase
        .from('group_join_requests')
        .select('preferred_slot')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .eq('status', 'approved')
        .maybeSingle();
      
      slotToUse = joinRequest?.preferred_slot || DEFAULT_PREFERRED_SLOT;
    }

    // Generate unique reference
    const uniqueId = crypto.randomUUID().substring(0, 8);
    const reference = `GRP_JOIN_${groupId.substring(0, 8)}_${uniqueId}`;

    // Create pending payment record
    const { error } = await supabase.from('payments').insert({
      reference,
      user_id: user.id,
      amount: Math.round(amount * 100), // Convert to kobo
      currency: 'NGN',
      status: 'pending',
      email: user.email,
      channel: 'card',
      verified: false,
      metadata: {
        type: 'group_join',
        group_id: groupId,
        user_id: user.id,
        preferred_slot: slotToUse,
      },
    });

    if (error) {
      console.error('[Payment Init] Failed to create payment record:', error);
      return { success: false, error: error.message };
    }

    console.log('[Payment Init] Created pending payment:', reference);
    return { success: true, reference };
  } catch (error) {
    console.error('[Payment Init] Exception:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to initialize payment'),
    };
  }
}

/**
 * Initialize payment for a standalone contribution
 * Creates a pending payment record in the database
 * 
 * @param contributionId - The contribution ID to pay
 * @param groupId - The group ID
 * @param amount - Total amount in Naira (will be converted to kobo)
 * @returns Payment reference to use with Paystack
 */
export async function initializeContributionPayment(
  contributionId: string,
  groupId: string,
  amount: number
): Promise<PaymentInitResult> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    // Validate IDs format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(contributionId) || !uuidRegex.test(groupId)) {
      return { success: false, error: 'Invalid ID format' };
    }

    // Verify contribution exists and belongs to user
    const { data: contribution, error: contributionError } = await supabase
      .from('contributions')
      .select('id, user_id, status, amount')
      .eq('id', contributionId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (contributionError || !contribution) {
      return { success: false, error: 'Contribution not found or access denied' };
    }

    if (contribution.status === 'paid') {
      return { success: false, error: 'Contribution already paid' };
    }

    // Generate unique reference
    const uniqueId = crypto.randomUUID().substring(0, 8);
    const reference = `CONTRIB_${contributionId.substring(0, 8)}_${uniqueId}`;

    // Create pending payment record
    const { error } = await supabase.from('payments').insert({
      reference,
      user_id: user.id,
      amount: Math.round(amount * 100), // Convert to kobo
      currency: 'NGN',
      status: 'pending',
      email: user.email,
      channel: 'card',
      verified: false,
      metadata: {
        type: 'contribution',
        contribution_id: contributionId,
        group_id: groupId,
        user_id: user.id,
      },
    });

    if (error) {
      console.error('[Payment Init] Failed to create payment record:', error);
      return { success: false, error: error.message };
    }

    console.log('[Payment Init] Created pending contribution payment:', reference);
    return { success: true, reference };
  } catch (error) {
    console.error('[Payment Init] Exception:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to initialize payment'),
    };
  }
}

// ============================================================================
// PAYMENT VERIFICATION
// ============================================================================

/**
 * Helper to check if Supabase session is expired
 */
function isSessionExpired(session: { expires_at?: number } | null): boolean {
  if (!session?.expires_at) return true;
  return session.expires_at < Date.now() / 1000;
}

/**
 * Verify payment with backend
 * 
 * This is the ONLY way to verify a payment. The backend:
 * - Verifies with Paystack API using secret key
 * - Updates payment record in database
 * - Executes all business logic (add member, create contribution, etc.)
 * - Returns final result to frontend
 * 
 * Frontend MUST NOT assume payment success based on Paystack callback alone.
 * 
 * SECURITY: This function includes multiple layers of protection:
 * - Validates payment reference format
 * - Refreshes JWT token before calling backend
 * - Retries on network/timeout errors
 * - Does NOT retry on authentication errors (user must refresh)
 * - Backend validates with Paystack using SECRET key
 * 
 * @param reference - Payment reference from Paystack
 * @param retries - Number of retry attempts (default: 3)
 * @param delayMs - Delay between retries in milliseconds (default: 2000)
 * @returns Verification result from backend
 */
export async function verifyPayment(
  reference: string,
  retries: number = VERIFICATION_RETRIES,
  delayMs: number = VERIFICATION_DELAY_MS
): Promise<PaymentVerificationResult> {
  console.log('[Payment Verify] Starting verification for:', reference);
  
  // Validate reference format
  if (!reference || typeof reference !== 'string' || reference.trim().length === 0) {
    console.error('[Payment Verify] Invalid reference format:', reference);
    return {
      success: false,
      payment_status: 'invalid_reference',
      verified: false,
      amount: 0,
      message: 'Invalid payment reference',
      error: 'Payment reference is required and must be a non-empty string',
    };
  }
  
  const supabase = createClient();
  
  // Proactively refresh session to ensure valid token
  console.log('[Payment Verify] Refreshing session...');
  const { data: { session: currentSession } } = await supabase.auth.getSession();
  
  if (!currentSession?.access_token) {
    console.error('[Payment Verify] No active session');
    return {
      success: false,
      payment_status: 'unauthorized',
      verified: false,
      amount: 0,
      message: 'Session expired. Please refresh and try again.',
      error: 'No active session',
    };
  }
  
  // Try to refresh session
  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
  
  let activeSession = currentSession;
  
  if (refreshError || !refreshData.session) {
    console.warn('[Payment Verify] Session refresh failed, checking current session validity');
    
    if (isSessionExpired(currentSession)) {
      console.error('[Payment Verify] Current session expired and refresh failed');
      return {
        success: false,
        payment_status: 'unauthorized',
        verified: false,
        amount: 0,
        message: 'Session expired. Please refresh the page.',
        error: 'Session expired',
      };
    }
    
    console.log('[Payment Verify] Current session still valid');
  } else {
    console.log('[Payment Verify] Session refreshed successfully');
    activeSession = refreshData.session;
    
    if (isSessionExpired(activeSession)) {
      console.error('[Payment Verify] Refreshed session already expired');
      return {
        success: false,
        payment_status: 'unauthorized',
        verified: false,
        amount: 0,
        message: 'Session refresh failed. Please log in again.',
        error: 'Refreshed session expired',
      };
    }
  }
  
  // Verify user with active session
  const { data: { user }, error: userError } = await supabase.auth.getUser(activeSession.access_token);
  
  if (userError || !user) {
    console.error('[Payment Verify] User authentication failed:', userError?.message);
    return {
      success: false,
      payment_status: 'unauthorized',
      verified: false,
      amount: 0,
      message: 'Authentication failed. Please log in again.',
      error: userError?.message || 'No authenticated user',
    };
  }
  
  console.log('[Payment Verify] User authenticated successfully');
  
  // Retry loop for verification
  let lastError = '';
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Payment Verify] Attempt ${attempt}/${retries}`);
      
      // Wait before retry (not on first attempt)
      if (attempt > 1) {
        const waitTime = delayMs * attempt; // Exponential backoff
        console.log(`[Payment Verify] Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Call verify-payment Edge Function
      // Use the same client that has the refreshed session
      const { data, error } = await supabase.functions.invoke('verify-payment', {
        body: { reference },
      });
      
      console.log('[Payment Verify] Edge Function response:', {
        hasData: !!data,
        hasError: !!error,
        status: data?.payment_status,
      });
      
      if (error) {
        console.error('[Payment Verify] Edge Function error:', error.message);
        lastError = error.message;
        
        const errorContext = (error as any).context;
        const statusCode = errorContext?.status;
        
        // Handle specific error types
        if (statusCode === 404 || error.message.includes('404')) {
          return {
            success: false,
            payment_status: 'service_unavailable',
            verified: false,
            amount: 0,
            message: 'Payment verification service unavailable. Please contact support.',
            error: 'Edge Function not deployed',
          };
        }
        
        if (statusCode === 401 || error.message.includes('401') || error.message.includes('Unauthorized')) {
          return {
            success: false,
            payment_status: 'unauthorized',
            verified: false,
            amount: 0,
            message: 'Session expired. Please refresh the page.',
            error: 'Authentication failed',
          };
        }
        
        if (statusCode && statusCode >= 500) {
          if (attempt < retries) {
            console.log('[Payment Verify] Server error, will retry...');
            continue;
          }
          return {
            success: false,
            payment_status: 'service_error',
            verified: false,
            amount: 0,
            message: 'Service temporarily unavailable. Please try again.',
            error: `Server error: ${statusCode}`,
          };
        }
        
        // Network errors - retry
        if (attempt < retries && (
          error.message.includes('timeout') ||
          error.message.includes('network') ||
          error.message.includes('fetch')
        )) {
          console.log('[Payment Verify] Network error, will retry...');
          continue;
        }
        
        return {
          success: false,
          payment_status: 'unknown',
          verified: false,
          amount: 0,
          message: 'Payment verification failed',
          error: error.message,
        };
      }
      
      if (!data) {
        console.error('[Payment Verify] No data returned');
        lastError = 'No response from verification service';
        
        if (attempt < retries) {
          continue;
        }
        
        return {
          success: false,
          payment_status: 'unknown',
          verified: false,
          amount: 0,
          message: 'No response from verification service',
          error: lastError,
        };
      }
      
      // Check for API-level errors
      if (data.error) {
        console.error('[Payment Verify] API error:', data.error);
        lastError = data.error;
        
        // Retry if still processing
        if (attempt < retries && (
          data.payment_status === 'processing' ||
          data.payment_status === 'pending'
        )) {
          console.log('[Payment Verify] Payment still processing, will retry...');
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
      
      // Success!
      console.log('[Payment Verify] Verification successful');
      return {
        success: data.success !== false,
        payment_status: data.payment_status || 'success',
        verified: data.verified === true,
        amount: data.amount || 0,
        message: data.message || 'Payment verified successfully',
        position: data.position,
        data: data.data,
      };
    } catch (error) {
      console.error(`[Payment Verify] Exception on attempt ${attempt}:`, error);
      lastError = getErrorMessage(error, 'Verification failed');
      
      if (attempt < retries) {
        console.log('[Payment Verify] Will retry after exception...');
        continue;
      }
    }
  }
  
  // All retries exhausted
  console.error('[Payment Verify] All attempts failed. Last error:', lastError);
  return {
    success: false,
    payment_status: 'unknown',
    verified: false,
    amount: 0,
    message: `Failed to verify payment after ${retries} attempts`,
    error: lastError || 'Verification failed',
  };
}

// ============================================================================
// PAYMENT STATUS
// ============================================================================

/**
 * Get payment status from database
 * Used to check current state of a payment
 * 
 * @param reference - Payment reference
 * @returns Payment status from database
 */
export async function getPaymentStatus(reference: string): Promise<PaymentStatus> {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('payments')
      .select('id, reference, status, verified, amount, paid_at')
      .eq('reference', reference)
      .maybeSingle();

    if (error) {
      console.error('[Payment Status] Database error:', error);
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: 'Payment not found' };
    }

    return { success: true, payment: data };
  } catch (error) {
    console.error('[Payment Status] Exception:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch payment status'),
    };
  }
}
