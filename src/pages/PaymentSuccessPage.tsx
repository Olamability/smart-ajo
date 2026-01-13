import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Get payment reference from URL query params (if provided by Paystack)
  // Paystack may send either 'reference' or 'trxref' depending on callback configuration
  const reference = searchParams.get('reference') || searchParams.get('trxref');

  useEffect(() => {
    // Log payment callback for debugging (development only)
    if (reference && import.meta.env.DEV) {
      console.log('Payment callback received with reference:', reference);
    }
  }, [reference]);

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
            Payment Successful
          </CardTitle>
          <CardDescription className="text-center">
            Your payment has been received and is being processed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          <CheckCircle2 className="h-12 w-12 text-green-600" />
          <p className="text-sm text-muted-foreground text-center">
            Thank you for your payment! Your transaction is being verified.
          </p>
          {reference && (
            <p className="text-xs text-muted-foreground text-center font-mono">
              Reference: {reference}
            </p>
          )}

          <div className="flex gap-2 w-full mt-4">
            <Button
              className="flex-1"
              onClick={() => navigate('/dashboard')}
            >
              Go to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
