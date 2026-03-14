/**
 * Payment Success Page
 *
 * Landed on after a successful Paystack payment popup.
 * Calls the verify-payment edge function which:
 *   - Verifies the payment with Paystack API (server-side, secret key)
 *   - Updates the transactions table to 'completed'
 *   - For contributions: marks the contribution as paid and updates group balance
 *   - For memberships: activates the group_members record
 *
 * Supports two payment types via the `?type=` URL parameter:
 *   - (default) membership payments: group_creation / group_join
 *   - contribution payments: ?type=contribution
 *
 * Note: The paystack-webhook edge function runs independently and also records
 * the payment — so even if this page fails, the payment is still recorded.
 */

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createClient } from '@/lib/client/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, Loader2, XCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verificationAttempted = useRef(false);

  const reference = searchParams.get('reference');
  const groupId = searchParams.get('group');
  const paymentType = searchParams.get('type'); // 'contribution' or null (membership)
  const isContribution = paymentType === 'contribution';

  const runVerification = async () => {
    if (!reference) {
      setError('No payment reference found in URL');
      setVerifying(false);
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      const supabase = createClient();

      // Layer 1 check: poll the transactions table to see whether the payment was
      // already recorded by the webhook or the inline verification in usePayment.
      // Retry a few times with short delays — the webhook may still be in-flight when
      // the user lands on this page, so give it a moment before falling back.
      console.log('[PaymentSuccessPage] Polling DB for transaction status', { reference });
      const DB_POLL_ATTEMPTS = 3;
      const DB_POLL_DELAY_MS = 600;
      let txnStatus: string | null = null;

      for (let attempt = 0; attempt < DB_POLL_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          await new Promise<void>((res) => setTimeout(res, DB_POLL_DELAY_MS));
        }
        const { data: txn } = await supabase
          .from('transactions')
          .select('status')
          .eq('reference', reference)
          .maybeSingle();
        txnStatus = txn?.status ?? null;
        if (txnStatus === 'completed') break;
      }

      if (txnStatus === 'completed') {
        console.log('[PaymentSuccessPage] Payment already recorded (webhook/inline)', { reference });
        setVerified(true);
        const msg = isContribution
          ? 'Payment verified! Your contribution has been recorded.'
          : 'Payment verified! Your membership has been activated.';
        toast.success(msg);
        setVerifying(false);
        return;
      }

      // Layer 2 fallback: DB still not updated — call the appropriate verify edge function directly.
      // Contributions use verify-contribution; membership payments use verify-payment.
      // This covers slow webhooks or cases where the inline verification didn't complete.
      const verifyFn = isContribution ? 'verify-contribution' : 'verify-payment';
      console.log(`[PaymentSuccessPage] Calling ${verifyFn} edge function`, {
        reference,
        currentStatus: txnStatus ?? 'not found',
      });
      const { data, error: fnError } = await supabase.functions.invoke(verifyFn, {
        body: { reference },
      });

      if (fnError) {
        throw new Error(fnError.message ?? 'Verification request failed');
      }

      if (!data?.success) {
        throw new Error(data?.error ?? 'Payment verification failed');
      }

      console.log('[PaymentSuccessPage] Verification successful', data);
      setVerified(true);
      const msg = isContribution
        ? 'Payment verified! Your contribution has been recorded.'
        : 'Payment verified! Your membership has been activated.';
      toast.success(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      console.error('[PaymentSuccessPage] Verification error:', err);
      setError(message);
    } finally {
      setVerifying(false);
    }
  };

  // Run verification once on mount.
  useEffect(() => {
    if (verificationAttempted.current) return;
    verificationAttempted.current = true;
    runVerification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleContinue = () => {
    if (groupId) {
      window.location.href = `/groups/${groupId}`;
    } else {
      window.location.href = '/dashboard';
    }
  };

  const handleRetry = () => {
    verificationAttempted.current = false;
    runVerification();
  };

  const continueLabel = groupId
    ? isContribution
      ? 'Back to Group'
      : 'Go to Group'
    : 'Go to Dashboard';

  const successDescription = isContribution
    ? 'Your contribution has been recorded'
    : 'Your security deposit and first contribution have been received';

  const successBody = isContribution
    ? 'Your contribution payment has been verified and recorded. Thank you for keeping up with your savings!'
    : 'Your payment has been verified. Your security deposit and first contribution are recorded, and your membership is now active.';

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
            {verifying && 'Verifying Payment…'}
            {!verifying && verified && 'Payment Successful!'}
            {!verifying && !verified && 'Payment Verification Failed'}
          </CardTitle>
          <CardDescription className="text-center">
            {verifying && 'Please wait while we confirm your payment'}
            {!verifying && verified && successDescription}
            {!verifying && !verified && 'There was an issue confirming your payment'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {!verifying && error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
              {reference && (
                <p className="text-xs text-red-600 mt-1">Reference: {reference}</p>
              )}
            </div>
          )}

          {!verifying && verified && (
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

              {!verified && (
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
              <p>This may take a few moments…</p>
              {reference && <p className="mt-2">Reference: {reference}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
