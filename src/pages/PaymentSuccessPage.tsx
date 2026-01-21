import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { verifyPayment } from '@/api/payments';
import { createClient } from '@/lib/client/supabase';
import { toast } from 'sonner';

type VerificationStatus = 'idle' | 'verifying' | 'processing' | 'verified' | 'failed';

// Default messages for different states
const DEFAULT_VERIFYING_MESSAGE = 'Please wait while we verify your payment and process your membership...';

/**
 * PaymentSuccessPage - Callback URL page for payment redirects
 * 
 * This page is ONLY responsible for:
 * 1. Receiving the payment callback from Paystack
 * 2. Calling the backend verify-payment Edge Function
 * 3. Waiting for webhook to process business logic
 * 4. Displaying the verification result
 * 
 * NO BUSINESS LOGIC is executed here. All business logic (adding members,
 * creating contributions, etc.) happens in the backend webhook.
 */
export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('idle');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [memberPosition, setMemberPosition] = useState<number | null>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get payment reference and group ID from URL query params
  // Paystack may send either 'reference' or 'trxref' depending on callback configuration
  const reference = searchParams.get('reference') || searchParams.get('trxref');
  const groupId = searchParams.get('group');

  /**
   * Check if webhook has processed the payment by verifying business logic completion
   * This polls the database to check if the member was added to the group
   */
  const checkWebhookProcessing = useCallback(async (
    userId: string,
    maxAttempts: number = 10,
    intervalMs: number = 2000
  ): Promise<{ success: boolean; position?: number }> => {
    const supabase = createClient();
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (import.meta.env.DEV) {
        console.log(`Checking webhook processing (attempt ${attempt}/${maxAttempts})...`);
      }
      
      // Check if user is a member with payment processed
      const { data: member, error } = await supabase
        .from('group_members')
        .select('id, position, has_paid_security_deposit, status')
        .eq('group_id', groupId!)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (error) {
        console.error('Error checking member status:', error);
        if (attempt === maxAttempts) {
          return { success: false };
        }
      } else if (member?.has_paid_security_deposit && member.status === 'active') {
        // Business logic has been processed!
        if (import.meta.env.DEV) {
          console.log('Webhook processing confirmed! Member found:', member);
        }
        return { success: true, position: member.position };
      }
      
      // Wait before next attempt
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    
    // Exhausted all attempts
    return { success: false };
  }, [groupId]);

  const handleVerifyPayment = useCallback(async () => {
    if (!reference) {
      setVerificationStatus('failed');
      setVerificationMessage('No payment reference provided');
      return;
    }

    setVerificationStatus('verifying');
    
    // Only log in development
    if (import.meta.env.DEV) {
      console.log('Verifying payment with reference:', reference);
    }

    try {
      // Step 1: Call backend verify-payment Edge Function
      // This verifies with Paystack and stores the payment record
      const result = await verifyPayment(reference);
      
      if (result.verified && result.success) {
        // Payment verified with Paystack successfully
        // Now wait for webhook to process business logic
        setVerificationStatus('processing');
        setVerificationMessage('Payment verified! Processing your membership...');
        
        if (import.meta.env.DEV) {
          console.log('Payment verified, waiting for webhook processing...');
        }
        
        // Step 2: Get current user to check webhook processing
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          setVerificationStatus('failed');
          setVerificationMessage('Authentication error. Please log in again.');
          return;
        }
        
        // Step 3: Poll database to confirm webhook has processed the payment
        const webhookResult = await checkWebhookProcessing(user.id);
        
        if (webhookResult.success) {
          setVerificationStatus('verified');
          setVerificationMessage(result.message || 'Payment verified successfully!');
          setMemberPosition(webhookResult.position || result.position || null);
          toast.success('Payment verified! Your membership is now active.');
        } else {
          // Webhook hasn't processed yet or failed
          // This could mean: webhook not configured, webhook failed, or just slow
          setVerificationStatus('verified');
          setVerificationMessage(
            'Payment verified! Your membership is being processed. Please refresh if you don\'t see updates shortly.'
          );
          toast.success('Payment verified! Processing membership...', { duration: 5000 });
        }
      } else {
        // Check if the error is due to session expiration
        // Use the specific payment_status field to avoid fragile string matching
        if (result.payment_status === 'unauthorized') {
          setVerificationStatus('verifying'); // Keep showing verifying state during refresh
          setVerificationMessage(
            'Your payment was successful! Refreshing your session to complete verification...'
          );
          toast.success('Payment completed! Reconnecting to verify...', { duration: 3000 });
          
          // Auto-refresh the page after 2 seconds to get a fresh session
          // Using navigate(0) for a cleaner refresh with React Router
          refreshTimeoutRef.current = setTimeout(() => {
            navigate(0);
          }, 2000);
        } else {
          setVerificationStatus('failed');
          setVerificationMessage(result.message || result.error || 'Payment verification failed');
          toast.error(result.message || 'Payment verification failed');
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Verification error:', error);
      }
      setVerificationStatus('failed');
      setVerificationMessage('Failed to verify payment. Please contact support.');
      toast.error('Failed to verify payment');
    }
  }, [reference, navigate, checkWebhookProcessing]);


  useEffect(() => {
    // Auto-verify payment if reference is provided
    if (reference && verificationStatus === 'idle') {
      handleVerifyPayment();
    }
  }, [reference, verificationStatus, handleVerifyPayment]);

  // Cleanup timeouts and intervals on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      if (pollingIntervalRef.current) {
        clearTimeout(pollingIntervalRef.current);
      }
    };
  }, []);

  const handleNavigation = () => {
    // Navigate to group page if group ID is provided, otherwise to dashboard
    // Pass state to trigger data reload
    if (groupId) {
      navigate(`/groups/${groupId}`, { state: { fromPayment: true } });
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
              : verificationStatus === 'processing'
              ? 'Processing Payment'
              : 'Payment Received'}
          </CardTitle>
          <CardDescription className="text-center">
            {verificationStatus === 'verifying' 
              ? 'Verifying your payment...' 
              : verificationStatus === 'processing'
              ? 'Processing your membership...'
              : verificationStatus === 'verified'
              ? 'Your payment has been successfully verified.'
              : 'Your payment has been received.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          {/* Status Icon */}
          {(verificationStatus === 'verifying' || verificationStatus === 'processing') && (
            <Loader2 className="h-12 w-12 text-primary animate-spin" />
          )}
          {verificationStatus === 'verified' && (
            <CheckCircle2 className="h-12 w-12 text-green-600" />
          )}
          {verificationStatus === 'failed' && (
            <AlertCircle className="h-12 w-12 text-red-600" />
          )}
          {verificationStatus === 'idle' && (
            <CheckCircle2 className="h-12 w-12 text-green-600" />
          )}

          {/* Status Message */}
          {(verificationStatus === 'verifying' || verificationStatus === 'processing') && (
            <p className="text-sm text-muted-foreground text-center">
              {verificationMessage || DEFAULT_VERIFYING_MESSAGE}
            </p>
          )}
          {verificationStatus === 'verified' && (
            <>
              <p className="text-sm text-muted-foreground text-center">
                {memberPosition 
                  ? `Thank you! Your transaction has been verified and you have been added to the group at position ${memberPosition}.`
                  : verificationMessage || 'Thank you! Your transaction has been verified and processed successfully.'}
              </p>
            </>
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
            <p className="text-sm text-muted-foreground text-center">
              Thank you for your payment! Your transaction is being processed.
            </p>
          )}

          {/* Payment Reference */}
          {reference && (
            <p className="text-xs text-muted-foreground text-center font-mono">
              Reference: {reference}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 w-full mt-4">
            {verificationStatus === 'failed' && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleVerifyPayment}
              >
                Retry Verification
              </Button>
            )}
            <Button
              className="flex-1"
              onClick={handleNavigation}
              disabled={verificationStatus === 'verifying' || verificationStatus === 'processing'}
            >
              {groupId ? 'Go to Group' : 'Go to Dashboard'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
