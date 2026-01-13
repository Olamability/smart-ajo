import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { verifyPayment } from '@/api/payments';
import { toast } from 'sonner';

type VerificationStatus = 'idle' | 'verifying' | 'verified' | 'failed';

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('idle');
  const [verificationMessage, setVerificationMessage] = useState('');
  
  // Get payment reference and group ID from URL query params
  // Paystack may send either 'reference' or 'trxref' depending on callback configuration
  const reference = searchParams.get('reference') || searchParams.get('trxref');
  const groupId = searchParams.get('group');

  useEffect(() => {
    // Auto-verify payment if reference is provided
    if (reference && verificationStatus === 'idle') {
      handleVerifyPayment();
    }
  }, [reference, verificationStatus]);

  const handleVerifyPayment = async () => {
    if (!reference) {
      setVerificationStatus('failed');
      setVerificationMessage('No payment reference provided');
      return;
    }

    setVerificationStatus('verifying');
    console.log('Verifying payment with reference:', reference);

    try {
      const result = await verifyPayment(reference);
      
      if (result.verified && result.success) {
        setVerificationStatus('verified');
        setVerificationMessage('Payment verified successfully!');
        toast.success('Payment verified! Your transaction is complete.');
      } else {
        setVerificationStatus('failed');
        setVerificationMessage(result.message || 'Payment verification failed');
        toast.error(result.message || 'Payment verification failed');
      }
    } catch (error) {
      console.error('Verification error:', error);
      setVerificationStatus('failed');
      setVerificationMessage('Failed to verify payment. Please contact support.');
      toast.error('Failed to verify payment');
    }
  };

  const handleNavigation = () => {
    // Navigate to group page if group ID is provided, otherwise to dashboard
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
            {verificationStatus === 'verified' ? 'Payment Verified' : 'Payment Received'}
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
          {verificationStatus === 'verifying' && (
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
              Please wait while we verify your payment with our payment provider...
            </p>
          )}
          {verificationStatus === 'verified' && (
            <p className="text-sm text-muted-foreground text-center">
              Thank you! Your transaction has been verified and processed successfully.
            </p>
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
                disabled={verificationStatus === 'verifying'}
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
