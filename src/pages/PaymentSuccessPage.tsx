/**
 * Payment Success Page
 * 
 * Handles payment verification after successful Paystack payment.
 * This page is called after payment completion to verify the transaction
 * and activate user's membership in the group.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { verifyPaymentAndActivateMembership } from '@/api/payments';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, Loader2, XCircle, ArrowRight } from 'lucide-react';

export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const reference = searchParams.get('reference');
  const groupId = searchParams.get('group');

  useEffect(() => {
    const verifyPayment = async () => {
      if (!reference) {
        setError('No payment reference provided');
        setVerifying(false);
        return;
      }

      try {
        const result = await verifyPaymentAndActivateMembership(reference);
        
        if (result.success && result.verified) {
          setVerified(true);
        } else {
          setError(result.error || 'Payment verification failed');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setVerifying(false);
      }
    };

    verifyPayment();
  }, [reference]);

  const handleContinue = () => {
    if (groupId) {
      navigate(`/groups/${groupId}`);
    } else {
      navigate('/dashboard');
    }
  };

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
            {!verifying && verified && 'Your membership has been activated'}
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
              <p className="text-sm text-green-800">
                Your payment has been verified and your membership has been activated.
                You can now participate in group activities.
              </p>
            </div>
          )}

          {!verifying && (
            <Button
              onClick={handleContinue}
              className="w-full"
              variant={verified ? 'default' : 'outline'}
            >
              {verified ? 'Go to Group' : 'Return to Dashboard'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
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
