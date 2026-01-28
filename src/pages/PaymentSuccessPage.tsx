/**
 * Payment Success Page - Clean Implementation
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
 * ❌ Polling or waiting for payment state (backend handles synchronously)
 * 
 * Flow:
 * 1. User completes payment on Paystack
 * 2. Paystack redirects to this page with reference in URL
 * 3. Page calls verifyPayment() which invokes backend Edge Function
 * 4. Backend verifies with Paystack API, updates DB, executes business logic
 * 5. Page displays result from backend
 * 6. User navigates to group/dashboard
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { verifyPayment } from '@/api/payments';
import { toast } from 'sonner';

type VerificationStatus = 'idle' | 'verifying' | 'verified' | 'failed';

const DEFAULT_VERIFYING_MESSAGE = 'Please wait while we verify your payment and process your membership...';

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('idle');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [memberPosition, setMemberPosition] = useState<number | null>(null);
  
  // Get payment reference from URL
  // Paystack may send either 'reference' or 'trxref'
  const reference = searchParams.get('reference') || searchParams.get('trxref');
  const groupId = searchParams.get('group');

  const handleVerifyPayment = useCallback(async () => {
    if (!reference) {
      console.error('[Payment Success] ❌ No payment reference provided');
      console.error('[Payment Success] URL params:', window.location.search);
      setVerificationStatus('failed');
      setVerificationMessage('No payment reference provided. Please check your payment status or contact support.');
      toast.error('Missing payment reference');
      return;
    }

    // Validate reference format
    if (reference.trim().length === 0) {
      console.error('[Payment Success] ❌ Invalid payment reference (empty)');
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
        console.log('[Payment Success] ✅ Payment verified successfully');
        console.log('[Payment Success] Membership activated');
        if (result.position) {
          console.log('[Payment Success] Assigned position:', result.position);
        }
        
        setVerificationStatus('verified');
        setVerificationMessage(
          result.message || 'Payment verified successfully! Your membership is now active.'
        );
        setMemberPosition(result.position || null);
        toast.success('Payment verified! Your membership is active.');
      } else {
        // Verification failed or pending
        console.error('[Payment Success] ❌ Verification failed');
        console.error('[Payment Success] Status:', result.payment_status);
        console.error('[Payment Success] Error:', result.error || result.message);
        
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
      console.error('[Payment Success] ❌ Exception during verification');
      console.error('[Payment Success] Error:', error);
      setVerificationStatus('failed');
      setVerificationMessage('Failed to verify payment. Please contact support.');
      toast.error('Failed to verify payment');
    } finally {
      console.log('=== PAYMENT VERIFICATION END ===');
    }
  }, [reference, groupId]);

  useEffect(() => {
    // Auto-verify when reference is available
    if (reference && verificationStatus === 'idle') {
      handleVerifyPayment();
    }
  }, [reference, verificationStatus, handleVerifyPayment]);

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
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground text-center">
                {verificationMessage || DEFAULT_VERIFYING_MESSAGE}
              </p>
              <p className="text-xs text-muted-foreground text-center">
                🔐 Securely verifying your payment with our backend...
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
                ✅ Your membership is now active!
              </p>
            </div>
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
