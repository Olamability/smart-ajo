/**
 * Payment Success Page
 *
 * Handles payment verification after a successful Paystack payment.
 * Supports two payment types via the `?type=` URL parameter:
 *   - (default) membership payments: group_creation / group_join
 *   - contribution payments: ?type=contribution
 *
 * Note: After Paystack redirect, session restoration may take a moment.
 * We wait for auth context to be ready before attempting verification.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  verifyPaymentAndActivateMembership,
  verifyPaymentAndRecordContribution,
} from '@/api/payments';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, Loader2, XCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [canRetry, setCanRetry] = useState(false);

  const reference = searchParams.get('reference');
  const groupId = searchParams.get('group');
  const paymentType = searchParams.get('type'); // 'contribution' or absent for membership

  const isContribution = paymentType === 'contribution';

  useEffect(() => {
    const verifyPayment = async () => {
      if (!reference) {
        setError('No payment reference provided');
        setVerifying(false);
        setCanRetry(false);
        return;
      }

      // Wait for auth context to be ready after redirect.
      // This ensures session is fully restored before attempting verification.
      if (authLoading) {
        console.log('PaymentSuccessPage: Waiting for auth context to be ready...');
        return;
      }

      if (!isAuthenticated) {
        setError('Please log in to verify your payment');
        setVerifying(false);
        setCanRetry(true);
        return;
      }

      try {
        console.log('PaymentSuccessPage: Verifying payment with reference:', reference, 'type:', paymentType);
        setVerifying(true);
        setError(null);

        // Route to the correct verification function based on payment type
        const result = isContribution
          ? await verifyPaymentAndRecordContribution(reference)
          : await verifyPaymentAndActivateMembership(reference);

        if (result.success && result.verified) {
          setVerified(true);
          setCanRetry(false);
          console.log('[PAYMENT TRACE] React state update after verification', {
            reference,
            verified: true,
            error: null,
            paymentType,
          });
          const successMsg = isContribution
            ? 'Payment verified! Your contribution has been recorded.'
            : 'Payment verified successfully! Membership activated.';
          toast.success(successMsg);
        } else {
          setError(result.error || 'Payment verification failed');
          setCanRetry(true);
          console.log('[PAYMENT TRACE] React state update after verification', {
            reference,
            verified: false,
            error: result.error || 'Payment verification failed',
            paymentType,
          });

          // Auto-retry once after 2 seconds for transient errors
          if (
            retryCount < 1 &&
            (result.error?.includes('Session not available') ||
              result.error?.includes('network') ||
              result.error?.includes('timeout'))
          ) {
            console.log('PaymentSuccessPage: Auto-retrying verification in 2 seconds...');
            setTimeout(() => {
              setRetryCount((prev) => prev + 1);
            }, 2000);
          }
        }
      } catch (err) {
        console.error('PaymentSuccessPage: Verification error:', err);
        const errorMessage = err instanceof Error ? err.message : 'An error occurred';
        setError(errorMessage);
        setCanRetry(true);

        // Auto-retry once after 2 seconds for network errors
        if (retryCount < 1) {
          console.log('PaymentSuccessPage: Auto-retrying verification in 2 seconds...');
          setTimeout(() => {
            setRetryCount((prev) => prev + 1);
          }, 2000);
        }
      } finally {
        setVerifying(false);
      }
    };

    verifyPayment();
  }, [reference, authLoading, isAuthenticated, retryCount, isContribution, paymentType]);

  const handleContinue = () => {
    if (groupId) {
      // Full page reload so the group page fetches fresh data
      window.location.href = `/groups/${groupId}`;
    } else {
      window.location.href = '/dashboard';
    }
  };

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
  };

  const successDescription = isContribution
    ? 'Your contribution has been recorded'
    : 'Your membership has been activated';

  const successBody = isContribution
    ? 'Your contribution payment has been verified and recorded. Thank you for keeping up with your savings!'
    : 'Your payment has been verified and your membership has been activated. You can now participate in group activities.';

  const continueLabel = groupId
    ? isContribution
      ? 'Back to Group'
      : 'Go to Group'
    : 'Go to Dashboard';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex justify-center mb-4">
            {verifying && <Loader2 className="h-16 w-16 text-blue-500 animate-spin" />}
            {!verifying && verified && <CheckCircle className="h-16 w-16 text-green-500" />}
            {!verifying && !verified && <XCircle className="h-16 w-16 text-red-500" />}
          </div>
          <CardTitle className="text-center">
            {verifying && 'Verifying Payment...'}
            {!verifying && verified && 'Payment Successful!'}
            {!verifying && !verified && 'Payment Verification Failed'}
          </CardTitle>
          <CardDescription className="text-center">
            {verifying && 'Please wait while we verify your payment'}
            {!verifying && verified && successDescription}
            {!verifying && !verified && 'There was an issue verifying your payment'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && !verifying && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {verified && !verifying && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">{successBody}</p>
            </div>
          )}

          {!verifying && (
            <>
              <Button
                onClick={handleContinue}
                className="w-full"
                variant={verified ? 'default' : 'outline'}
              >
                {verified ? continueLabel : 'Return to Dashboard'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>

              {!verified && canRetry && (
                <Button
                  onClick={handleRetry}
                  className="w-full mt-2"
                  variant="secondary"
                  disabled={verifying}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry Verification
                </Button>
              )}
            </>
          )}

          {verifying && (
            <div className="text-center text-sm text-muted-foreground">
              <p>This may take a few moments...</p>
              <p className="mt-2">Reference: {reference}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
