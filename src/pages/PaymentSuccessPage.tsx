/**
 * Payment Success Page - Enhanced Implementation
 * 
 * This page handles the payment callback from Paystack and verifies payment
 * securely with the backend.
 * 
 * SECURITY MODEL - How Payment Verification Works:
 * ================================================
 * 
 * 1. USER COMPLETES PAYMENT
 *    - User pays on Paystack's secure platform
 *    - Paystack redirects to this page with payment reference
 * 
 * 2. FRONTEND CALLS BACKEND (this page)
 *    - Automatically calls verifyPayment(reference)
 *    - Shows loading spinner
 *    - Frontend DOES NOT trust payment success from URL params
 * 
 * 3. BACKEND VERIFIES WITH PAYSTACK (verify-payment Edge Function)
 *    - Authenticates user via JWT token
 *    - Calls Paystack API with SECRET KEY (secure, server-side only)
 *    - Validates payment was actually successful
 *    - Stores payment record in database
 *    - EXECUTES BUSINESS LOGIC: Adds member to group, activates membership
 *    - Returns verification result
 * 
 * 4. MEMBERSHIP ACTIVATED IMMEDIATELY
 *    - Backend adds user to group_members table
 *    - Sets has_paid_security_deposit = true
 *    - Sets status = 'active'
 *    - Assigns payout position/slot
 *    - Creates first contribution record
 * 
 * 5. USER SEES SUCCESS
 *    - Frontend receives confirmation from backend
 *    - Displays success message with assigned position
 *    - User can navigate to group and access membership features
 * 
 * BACKUP: Paystack also sends webhook to our backend as backup verification
 * 
 * Responsibilities:
 * ✅ Receive payment reference from Paystack callback
 * ✅ Call backend verify-payment Edge Function
 * ✅ Display verification result from backend
 * ✅ Show loading state during verification
 * ✅ Handle errors and retry logic
 * 
 * NOT responsible for:
 * ❌ Determining if payment was successful (backend only)
 * ❌ Updating database or business logic (backend only)
 * ❌ Trusting payment status from URL parameters (security risk)
 * 
 * Flow (with Realtime updates):
 * 1. User completes payment on Paystack
 * 2. Paystack redirects to this page with reference in URL
 * 3. Page subscribes to Realtime updates for payment record
 * 4. Page calls verifyPayment() which invokes backend Edge Function
 * 5. Backend verifies with Paystack API, updates DB, executes business logic
 * 6. If synchronous verification succeeds → display success
 * 7. If synchronous verification fails (e.g., auth expired):
 *    - Payment record is stored by backend
 *    - Webhook processes payment asynchronously
 *    - Realtime subscription receives update
 *    - Page automatically updates with success
 * 8. User navigates to group/dashboard
 * 
 * Fallback: If Realtime fails, polling mechanism checks payment status
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { verifyPayment, getPaymentStatus } from '@/api/payments';
import { createClient } from '@/lib/client/supabase';
import { toast } from 'sonner';

type VerificationStatus = 'idle' | 'verifying' | 'verified' | 'failed' | 'session_expired' | 'waiting_webhook';

const DEFAULT_VERIFYING_MESSAGE = 'Please wait while we verify your payment and process your membership...';
const WEBHOOK_WAIT_MESSAGE = 'Payment verified! Waiting for membership activation...';
const POLLING_INTERVAL_MS = 3000; // Poll every 3 seconds
const MAX_POLLING_ATTEMPTS = 20; // Poll for up to 60 seconds
const MAX_REFRESH_ATTEMPTS = 2; // Limit refresh attempts to prevent infinite loops
const REFRESH_ATTEMPT_KEY = 'payment_refresh_attempts';

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('idle');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [memberPosition, setMemberPosition] = useState<number | null>(null);
  const [isListeningRealtime, setIsListeningRealtime] = useState(false);
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingAttemptsRef = useRef(0);
  const realtimeChannelRef = useRef<any>(null);
  
  // Get payment reference from URL
  // Paystack may send either 'reference' or 'trxref'
  const reference = searchParams.get('reference') || searchParams.get('trxref');
  const groupId = searchParams.get('group');

  // Track refresh attempts to prevent infinite loops
  const getRefreshAttempts = useCallback(() => {
    const stored = sessionStorage.getItem(REFRESH_ATTEMPT_KEY);
    return stored ? parseInt(stored, 10) : 0;
  }, []);

  const incrementRefreshAttempts = useCallback(() => {
    const current = getRefreshAttempts();
    sessionStorage.setItem(REFRESH_ATTEMPT_KEY, String(current + 1));
  }, [getRefreshAttempts]);

  const clearRefreshAttempts = useCallback(() => {
    sessionStorage.removeItem(REFRESH_ATTEMPT_KEY);
  }, []);

  // Cleanup function for polling and realtime
  const cleanup = useCallback(() => {
    // Clear polling timeout
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
    
    // Unsubscribe from Realtime channel
    if (realtimeChannelRef.current) {
      console.log('[Payment Success] Unsubscribing from Realtime channel');
      realtimeChannelRef.current.unsubscribe();
      realtimeChannelRef.current = null;
    }
  }, []); // No dependencies needed - refs are stable

  /**
   * Setup Realtime subscription to listen for payment updates
   * This allows the page to automatically update when webhook processes payment
   */
  const setupRealtimeSubscription = useCallback(() => {
    if (!reference || isListeningRealtime) {
      return;
    }

    console.log('[Payment Success] Setting up Realtime subscription for reference:', reference);
    
    try {
      const supabase = createClient();
      
      // Subscribe to payment updates
      const channel = supabase
        .channel(`payment-${reference}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'payments',
            filter: `reference=eq.${reference}`,
          },
          (payload) => {
            console.log('[Payment Success] Realtime payment update received:', payload);
            
            const updatedPayment = payload.new;
            
            // Check if payment is now verified
            if (updatedPayment.verified && updatedPayment.status === 'success') {
              console.log('[Payment Success] Payment verified via Realtime!');
              
              // Check membership activation by querying group_members
              const checkMembershipActivation = async () => {
                const userId = updatedPayment.user_id;
                const metadata = updatedPayment.metadata;
                const groupIdFromPayment = metadata?.group_id;
                
                if (!userId || !groupIdFromPayment) {
                  console.warn('[Payment Success] Missing userId or groupId in payment metadata', {
                    userId,
                    groupIdFromPayment,
                    metadata
                  });
                  // Payment is verified but can't check membership
                  // This is not an error - webhook will still process correctly
                  // Just update status to show payment is verified
                  cleanup();
                  setVerificationStatus('verified');
                  setVerificationMessage('Payment verified! Please check your membership status.');
                  toast.success('Payment verified!');
                  clearRefreshAttempts();
                  return;
                }
                
                const { data: member } = await supabase
                    .from('group_members')
                    .select('position, has_paid_security_deposit, status')
                    .eq('user_id', userId)
                    .eq('group_id', groupIdFromPayment)
                    .maybeSingle();
                  
                  console.log('[Payment Success] Member status:', member);
                  
                  if (member?.has_paid_security_deposit && member?.status === 'active') {
                    console.log('[Payment Success] Membership activated! Position:', member.position);
                    cleanup();
                    setVerificationStatus('verified');
                    setMemberPosition(member.position);
                    setVerificationMessage('Payment verified and membership activated!');
                    toast.success('Payment verified! Your membership is now active.');
                    clearRefreshAttempts();
                  }
              };
              
              checkMembershipActivation();
            }
          }
        )
        .subscribe((status) => {
          console.log('[Payment Success] Realtime subscription status:', status);
          
          if (status === 'SUBSCRIBED') {
            console.log('[Payment Success] Successfully subscribed to Realtime updates');
            setIsListeningRealtime(true);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[Payment Success] Realtime subscription failed, falling back to polling');
            setIsListeningRealtime(false);
            // Fallback to polling
            startPolling();
          }
        });
      
      realtimeChannelRef.current = channel;
    } catch (error) {
      console.error('[Payment Success] Failed to setup Realtime subscription:', error);
      // Fallback to polling
      startPolling();
    }
  }, [reference, isListeningRealtime]); // Removed cleanup and clearRefreshAttempts from deps

  /**
   * Polling fallback mechanism
   * Polls payment status every few seconds if Realtime is unavailable
   */
  const pollPaymentStatus = useCallback(async () => {
    if (!reference) return;
    
    pollingAttemptsRef.current += 1;
    console.log(`[Payment Success] Polling attempt ${pollingAttemptsRef.current}/${MAX_POLLING_ATTEMPTS}`);
    
    try {
      const result = await getPaymentStatus(reference);
      
      if (result.success && result.payment) {
        console.log('[Payment Success] Poll result:', result.payment);
        
        // Check if payment is verified
        if (result.payment.verified && result.payment.status === 'success') {
          console.log('[Payment Success] Payment verified via polling!');
          
          // Check membership activation
          const supabase = createClient();
          const { data: { user } } = await supabase.auth.getUser();
          
          if (user && groupId) {
            const { data: member } = await supabase
              .from('group_members')
              .select('position, has_paid_security_deposit, status')
              .eq('user_id', user.id)
              .eq('group_id', groupId)
              .maybeSingle();
            
            console.log('[Payment Success] Member status:', member);
            
            if (member?.has_paid_security_deposit && member?.status === 'active') {
              console.log('[Payment Success] Membership activated! Position:', member.position);
              cleanup();
              setVerificationStatus('verified');
              setMemberPosition(member.position);
              setVerificationMessage('Payment verified and membership activated!');
              toast.success('Payment verified! Your membership is now active.');
              clearRefreshAttempts();
              return; // Stop polling
            }
          }
        }
      }
      
      // Continue polling if not verified yet and haven't exceeded max attempts
      if (pollingAttemptsRef.current < MAX_POLLING_ATTEMPTS) {
        pollingTimeoutRef.current = setTimeout(() => {
          pollPaymentStatus();
        }, POLLING_INTERVAL_MS);
      } else {
        console.warn('[Payment Success] Max polling attempts reached');
        setVerificationMessage('Payment verification is taking longer than expected. Your payment will be processed automatically. Please check back in a few minutes.');
      }
    } catch (error) {
      console.error('[Payment Success] Polling error:', error);
      
      // Retry polling if not exceeded max attempts
      if (pollingAttemptsRef.current < MAX_POLLING_ATTEMPTS) {
        pollingTimeoutRef.current = setTimeout(() => {
          pollPaymentStatus();
        }, POLLING_INTERVAL_MS);
      }
    }
  }, [reference, groupId, cleanup, clearRefreshAttempts]);

  const startPolling = useCallback(() => {
    console.log('[Payment Success] Starting polling mechanism');
    pollingAttemptsRef.current = 0;
    pollPaymentStatus();
  }, [pollPaymentStatus]);

  const handleVerifyPayment = useCallback(async () => {
    if (!reference) {
      console.error('[Payment Success] ERROR: No payment reference provided');
      console.error('[Payment Success] URL params:', window.location.search);
      setVerificationStatus('failed');
      setVerificationMessage('No payment reference provided. Please check your payment status or contact support.');
      toast.error('Missing payment reference');
      return;
    }

    // Validate reference format
    if (reference.trim().length === 0) {
      console.error('[Payment Success] ERROR: Invalid payment reference (empty)');
      setVerificationStatus('failed');
      setVerificationMessage('Invalid payment reference. Please contact support.');
      toast.error('Invalid payment reference');
      return;
    }

    setVerificationStatus('verifying');
    setVerificationMessage(DEFAULT_VERIFYING_MESSAGE);
    
    console.log('=== PAYMENT VERIFICATION START ===');
    console.log('[Payment Success] Reference:', reference);
    console.log('[Payment Success] Group ID:', groupId);
    console.log('[Payment Success] Timestamp:', new Date().toISOString());

    // Setup Realtime subscription to listen for updates
    setupRealtimeSubscription();

    try {
      // Call backend verify-payment Edge Function
      // This verifies with Paystack, stores payment, AND executes business logic
      console.log('[Payment Success] Calling verifyPayment API...');
      const result = await verifyPayment(reference);
      
      console.log('[Payment Success] Verification result:', {
        success: result.success,
        verified: result.verified,
        status: result.payment_status,
        position: result.position,
        amount: result.amount,
      });
      
      if (result.verified && result.success) {
        // Payment verified AND business logic completed
        console.log('[Payment Success] SUCCESS: Payment verified successfully');
        console.log('[Payment Success] Membership activated');
        if (result.position) {
          console.log('[Payment Success] Assigned position:', result.position);
        }
        
        // Clear refresh attempts and cleanup
        clearRefreshAttempts();
        cleanup();
        
        setVerificationStatus('verified');
        setVerificationMessage(
          result.message || 'Payment verified successfully! Your membership is now active.'
        );
        setMemberPosition(result.position || null);
        toast.success('Payment verified! Your membership is active.');
      } else if (result.verified && result.payment_status === 'verified_pending_activation') {
        // Payment verified but authentication expired
        // Instead of auto-refresh, wait for webhook + Realtime/polling
        console.log('[Payment Success] PENDING: Payment verified, waiting for webhook activation...');
        
        setVerificationStatus('waiting_webhook');
        setVerificationMessage(WEBHOOK_WAIT_MESSAGE);
        toast.info('Payment verified! Activating membership...');
        
        // Realtime subscription is already active
        // If Realtime fails, polling will be started automatically
      } else {
        // Verification failed or pending
        console.error('[Payment Success] ERROR: Verification failed');
        console.error('[Payment Success] Status:', result.payment_status);
        console.error('[Payment Success] Error:', result.error || result.message);
        
        cleanup(); // Stop listening since verification failed
        
        if (result.payment_status === 'unauthorized') {
          setVerificationStatus('failed');
          setVerificationMessage(
            'Session expired. Please refresh the page to retry verification. Your payment was received.'
          );
          toast.error('Session expired. Please refresh to retry.');
        } else {
          setVerificationStatus('failed');
          setVerificationMessage(
            result.message || result.error || 'Payment verification failed'
          );
          toast.error(result.message || 'Payment verification failed');
        }
      }
    } catch (error) {
      console.error('[Payment Success] ERROR: Exception during verification');
      console.error('[Payment Success] Error:', error);
      cleanup();
      setVerificationStatus('failed');
      setVerificationMessage('Failed to verify payment. Please contact support.');
      toast.error('Failed to verify payment');
    } finally {
      console.log('=== PAYMENT VERIFICATION END ===');
    }
  }, [reference, groupId, setupRealtimeSubscription]); // Removed cleanup and clearRefreshAttempts from deps

  useEffect(() => {
    // Auto-verify when reference is available
    if (reference && verificationStatus === 'idle') {
      handleVerifyPayment();
    }
    
    // Cleanup on unmount
    return () => {
      cleanup();
    };
  }, [reference, verificationStatus, handleVerifyPayment, cleanup]);

  const handleNavigation = () => {
    // Navigate to group page if group ID provided, otherwise dashboard
    if (groupId) {
      navigate(`/groups/${groupId}`);
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-hero flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl text-center">
            {verificationStatus === 'verified' 
              ? 'Payment Verified' 
              : verificationStatus === 'waiting_webhook'
              ? 'Activating Membership'
              : 'Payment Received'}
          </CardTitle>
          <CardDescription className="text-center">
            {verificationStatus === 'verifying' 
              ? 'Verifying your payment...' 
              : verificationStatus === 'verified'
              ? 'Your payment has been successfully verified.'
              : verificationStatus === 'waiting_webhook'
              ? 'Payment verified. Activating your membership...'
              : 'Your payment has been received.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          {/* Status Icon */}
          {(verificationStatus === 'verifying' || verificationStatus === 'waiting_webhook') && (
            <Loader2 className="h-12 w-12 text-primary animate-spin" />
          )}
          {verificationStatus === 'verified' && (
            <CheckCircle2 className="h-12 w-12 text-green-600" />
          )}
          {verificationStatus === 'session_expired' && (
            <AlertCircle className="h-12 w-12 text-yellow-600" />
          )}
          {verificationStatus === 'failed' && (
            <AlertCircle className="h-12 w-12 text-red-600" />
          )}
          {verificationStatus === 'idle' && (
            <CheckCircle2 className="h-12 w-12 text-green-600" />
          )}

          {/* Status Message */}
          {(verificationStatus === 'verifying' || verificationStatus === 'waiting_webhook') && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground text-center">
                {verificationMessage || (
                  verificationStatus === 'waiting_webhook' 
                    ? WEBHOOK_WAIT_MESSAGE 
                    : DEFAULT_VERIFYING_MESSAGE
                )}
              </p>
              <p className="text-xs text-muted-foreground text-center">
                {verificationStatus === 'waiting_webhook' ? (
                  <>
                    <span className="inline-block mr-1" role="img" aria-label="clock">⏳</span>
                    This usually takes just a few seconds...
                  </>
                ) : (
                  <>
                    <span className="inline-block mr-1" role="img" aria-label="lock">🔐</span>
                    Securely verifying your payment with our backend...
                  </>
                )}
              </p>
            </div>
          )}
          {verificationStatus === 'verified' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground text-center">
                {memberPosition 
                  ? `Your transaction has been verified and you have been added to the group at position ${memberPosition}.`
                  : verificationMessage || 'Your transaction has been verified and processed successfully.'}
              </p>
              <p className="text-xs text-green-600 text-center">
                <span className="inline-block mr-1" role="img" aria-label="check">✅</span>
                Your membership is now active!
              </p>
            </div>
          )}
          {verificationStatus === 'session_expired' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {verificationMessage || 'Session expired. Please log in again to complete activation.'}
                <div className="mt-2 text-xs">
                  💡 Your payment was successful and will be activated automatically within a few minutes. You can also log in to complete activation immediately.
                </div>
              </AlertDescription>
            </Alert>
          )}
          {verificationStatus === 'failed' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {verificationMessage || 'Payment verification failed. Please contact support.'}
              </AlertDescription>
            </Alert>
          )}
          {verificationStatus === 'idle' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground text-center">
                Your payment is being processed...
              </p>
              <p className="text-xs text-muted-foreground text-center">
                Please wait while we verify your payment.
              </p>
            </div>
          )}

          {/* Payment Reference */}
          {reference && (
            <p className="text-xs text-muted-foreground text-center font-mono">
              Reference: {reference}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 w-full mt-4">
            {verificationStatus === 'session_expired' && (
              <>
                <Button
                  variant="default"
                  className="flex-1"
                  onClick={() => {
                    // Store current reference to retry after login
                    sessionStorage.setItem('pending_payment_reference', reference || '');
                    sessionStorage.setItem('pending_payment_group', groupId || '');
                    // Redirect to login
                    navigate(`/login?redirect=/payment-success?reference=${reference}&group=${groupId}`);
                  }}
                >
                  Login and Retry
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleNavigation}
                >
                  {groupId ? 'Back to Group' : 'Go to Dashboard'}
                </Button>
              </>
            )}
            {verificationStatus === 'failed' && (
              <>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleVerifyPayment}
                >
                  Retry Verification
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate('/transactions')}
                >
                  View Transactions
                </Button>
              </>
            )}
            <Button
              className="flex-1"
              onClick={handleNavigation}
              disabled={verificationStatus === 'verifying' || verificationStatus === 'waiting_webhook'}
            >
              {groupId ? 'Go to Group' : 'Go to Dashboard'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
