/**
 * usePayment Hook
 *
 * Reusable hook that encapsulates the full Paystack payment flow:
 * 1. Initialize a pending payment record in the database
 * 2. Open the Paystack inline checkout popup
 * 3. On success, redirect to PaymentSuccessPage for backend verification
 *
 * Usage:
 *   const { initiatePayment, isProcessing } = usePayment();
 *   await initiatePayment({ type: 'group_creation', groupId, amount, slotNumber });
 */

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  initializeGroupCreationPayment,
  initializeGroupJoinPayment,
  initializeAjoContributionPayment,
  verifyContributionPayment,
  verifyPaymentAndActivateMembership,
} from '@/api/payments';
import { paystackService } from '@/lib/paystack';
import type { PaymentMetadata } from '@/lib/paystack';
import { toast } from 'sonner';

export type PaymentType = 'group_creation' | 'group_join' | 'contribution';

interface GroupCreationParams {
  type: 'group_creation';
  groupId: string;
  amount: number;
  slotNumber: number;
}

interface GroupJoinParams {
  type: 'group_join';
  groupId: string;
  amount: number;
  slotNumber: number;
}

interface ContributionParams {
  type: 'contribution';
  groupId: string;
  contributionId: string;
  amount: number;
  cycleNumber?: number;
}

export type PaymentParams = GroupCreationParams | GroupJoinParams | ContributionParams;

interface UsePaymentReturn {
  initiatePayment: (params: PaymentParams) => Promise<void>;
  isProcessing: boolean;
}

export function usePayment(): UsePaymentReturn {
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  const initiatePayment = async (params: PaymentParams): Promise<void> => {
    if (!user?.email) {
      toast.error('You must be logged in to make a payment');
      return;
    }

    setIsProcessing(true);

    try {
      // Step 1: Create a pending transaction record in the database
      let initResult;
      if (params.type === 'group_creation') {
        initResult = await initializeGroupCreationPayment(
          params.groupId,
          params.amount,
          params.slotNumber
        );
      } else if (params.type === 'group_join') {
        initResult = await initializeGroupJoinPayment(
          params.groupId,
          params.amount,
          params.slotNumber
        );
      } else {
        initResult = await initializeAjoContributionPayment({
          email: user.email,
          amountInKobo: paystackService.toKobo(params.amount),
          ajoGroupId: params.groupId,
          contributionId: params.contributionId,
        });
      }

      if (!initResult.success || !initResult.reference) {
        toast.error(initResult.error || 'Failed to initialize payment');
        setIsProcessing(false);
        return;
      }

      const { reference } = initResult;

      // Step 2: Build metadata for Paystack and the backend edge function
      const metadata: PaymentMetadata =
        params.type === 'contribution'
          ? {
              userId: user.id,
              groupId: params.groupId,
              paymentType: 'contribution',
              contributionId: params.contributionId,
              cycleNumber: params.cycleNumber,
            }
          : {
              userId: user.id,
              groupId: params.groupId,
              paymentType: params.type,
              slotNumber: params.slotNumber,
            };

      // Build success redirect URL (includes type so PaymentSuccessPage shows the right message)
      const typeParam = params.type === 'contribution' ? '&type=contribution' : '';
      const successUrl = `/payment/success?reference=${reference}&group=${params.groupId}${typeParam}`;
      const shouldRedirectAfterVerification = import.meta.env.VITE_ENABLE_PAYMENT_SUCCESS_REDIRECT !== 'false';

      // Step 3: Open the Paystack inline checkout popup
      await paystackService.initializePayment({
        email: user.email,
        amount: paystackService.toKobo(params.amount),
        reference,
        metadata,
        callback_url: `${import.meta.env.VITE_APP_URL}${successUrl}`,
        onSuccess: async (response) => {
          const resolvedReference = response?.reference || reference;
          const resolvedSuccessUrl = `/payment/success?reference=${resolvedReference}&group=${params.groupId}${typeParam}`;
          let shouldNavigateToSuccess = false;
          console.log('usePayment: Paystack onSuccess callback fired', {
            expectedReference: reference,
            paystackReference: response?.reference,
            resolvedReference,
            paymentType: params.type,
          });

          try {
            toast.success('Payment completed! Verifying...', { duration: 2000 });
            console.log('usePayment: Invoking Supabase verification edge function', {
              paymentType: params.type,
              reference: resolvedReference,
            });

            const verificationResult =
              params.type === 'contribution'
                ? await verifyContributionPayment(resolvedReference)
                : await verifyPaymentAndActivateMembership(resolvedReference);

            console.log('usePayment: Verification result', {
              reference: resolvedReference,
              paymentType: params.type,
              success: verificationResult.success,
              verified: verificationResult.verified,
              error: verificationResult.error,
              data: verificationResult.data,
            });

            if (verificationResult.success && verificationResult.verified) {
              console.log('usePayment: Verification succeeded and database updated', {
                reference: resolvedReference,
                paymentType: params.type,
                data: verificationResult.data,
              });
              const successMessage =
                params.type === 'contribution'
                  ? 'Payment verified! Your contribution has been recorded.'
                  : 'Payment verified successfully! Membership activated.';
              toast.success(successMessage);
              shouldNavigateToSuccess = shouldRedirectAfterVerification;
            } else {
              throw new Error(verificationResult.error || 'Payment verification failed');
            }
          } catch (verifyError) {
            console.error('usePayment: Error verifying payment after Paystack success:', verifyError);
            const errorMessage = verifyError instanceof Error ? verifyError.message : 'Payment verification failed';
            const userMessage = `Payment completed but verification could not be confirmed. ${errorMessage} Please retry verification in a moment or contact support with reference ${resolvedReference}.`;
            toast.error(userMessage);
          } finally {
            setIsProcessing(false);
            if (shouldNavigateToSuccess) {
              console.log('usePayment: Redirecting to success page after verification', {
                reference: resolvedReference,
                successUrl: resolvedSuccessUrl,
              });
              window.location.href = resolvedSuccessUrl;
            }
          }
        },
        onClose: () => {
          // onClose is only called when the user closes the popup without paying
          // (paystack.ts suppresses this callback after a successful payment).
          console.log('usePayment: Payment popup closed without completing payment');
          toast.info('Payment cancelled');
          setIsProcessing(false);
        },
      });
    } catch (error) {
      // 'Payment window closed' and 'Payment cancelled by user' are normal user
      // interactions, not errors — the onClose callback already handles UI feedback.
      const isUserClose =
        error instanceof Error &&
        (error.message === 'Payment window closed' ||
          error.message === 'Payment cancelled by user');
      if (!isUserClose) {
        console.error('Payment error:', error);
        toast.error('Failed to initialize payment');
      }
      setIsProcessing(false);
    }
  };

  return { initiatePayment, isProcessing };
}
