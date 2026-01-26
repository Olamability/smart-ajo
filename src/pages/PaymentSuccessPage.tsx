import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { verifyPayment } from '@/api/payments';
import { getGroupMembers, getGroupById } from '@/api';
import { toast } from 'sonner';

type VerificationStatus = 'idle' | 'verifying' | 'verified' | 'failed';

// Constants
const DEFAULT_VERIFYING_MESSAGE = 'Please wait while we verify your payment and process your membership...';

/**
 * PaymentSuccessPage - Callback URL page for payment redirects
 * 
 * This page is ONLY responsible for:
 * 1. Receiving the payment callback from Paystack
 * 2. Calling the backend verify-payment Edge Function
 * 3. Displaying the verification result
 * 
 * Business logic is executed synchronously in the verify-payment Edge Function,
 * so activation happens immediately - no polling needed.
 */
export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('idle');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [memberPosition, setMemberPosition] = useState<number | null>(null);
  const [isRefetchingData, setIsRefetchingData] = useState(false);
  
  // Get payment reference and group ID from URL query params
  // Paystack may send either 'reference' or 'trxref' depending on callback configuration
  const reference = searchParams.get('reference') || searchParams.get('trxref');
  const groupId = searchParams.get('group');

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
      // Call backend verify-payment Edge Function
      // This verifies with Paystack, stores payment, AND executes business logic immediately
      const result = await verifyPayment(reference);
      
      if (result.verified && result.success) {
        // Payment verified AND business logic completed successfully
        setVerificationStatus('verified');
        setVerificationMessage(result.message || 'Payment verified successfully!');
        setMemberPosition(result.position || null);
        toast.success('Payment verified! Your membership is now active.');
        
        // CRITICAL: After successful verification, explicitly refetch membership data
        // to ensure the database has been updated and we have the latest state
        if (groupId) {
          if (import.meta.env.DEV) {
            console.log('Refetching membership data after successful verification...');
          }
          setIsRefetchingData(true);
          
          try {
            // Refetch group details and members to ensure database consistency
            await Promise.all([
              getGroupById(groupId),
              getGroupMembers(groupId)
            ]);
            
            if (import.meta.env.DEV) {
              console.log('Membership data refetched successfully');
            }
          } catch (refetchError) {
            if (import.meta.env.DEV) {
              console.error('Error refetching membership data:', refetchError);
            }
            // Don't fail the verification if refetch fails - data will be loaded on navigation
          } finally {
            setIsRefetchingData(false);
          }
        }
      } else {
        // Check if the error is due to session expiration
        if (result.payment_status === 'unauthorized') {
          setVerificationStatus('failed');
          setVerificationMessage(
            'Your session has expired. Please refresh this page to complete verification. Your payment was successful and will be verified once you reconnect.'
          );
          toast.error('Session expired. Please refresh the page to retry.');
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
  }, [reference, groupId]);


  useEffect(() => {
    // Auto-verify payment if reference is provided
    if (reference && verificationStatus === 'idle') {
      handleVerifyPayment();
    }
  }, [reference, verificationStatus, handleVerifyPayment]);

  const handleNavigation = () => {
    // Navigate to group page if group ID is provided, otherwise to dashboard
    if (groupId) {
      // Add a reload query parameter to signal GroupDetailPage to refresh its data
      // This ensures the UI reflects the updated membership status
      navigate(`/groups/${groupId}?reload=true`);
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
              : 'Payment Received'}
          </CardTitle>
          <CardDescription className="text-center">
            {verificationStatus === 'verifying' 
              ? 'Verifying your payment...' 
              : verificationStatus === 'verified'
              ? 'Your payment has been successfully verified.'
              : 'Your payment has been received.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          {/* Status Icon */}
          {(verificationStatus === 'verifying' || isRefetchingData) && (
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
          {verificationStatus === 'verifying' && (
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
              disabled={verificationStatus === 'verifying'}
            >
              {groupId ? 'Go to Group' : 'Go to Dashboard'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
