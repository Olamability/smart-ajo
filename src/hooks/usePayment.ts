/**
 * usePayment Hook
 *
 * Orchestrates the full Paystack payment flow:
 * 1. Call the initialize-payment edge function to create a pending transaction
 * 2. Open the Paystack inline popup
 * 3. On success, redirect to PaymentSuccessPage — the backend does the verification
 *
 * The UI is NEVER the source of truth for payment success.
 * Verification happens in the verify-payment edge function called by PaymentSuccessPage.
 * The paystack-webhook edge function provides a fallback that records payment even
 * if the user closes their browser before reaching the success page.
 *
 * Usage:
 *   const { initiatePayment, isProcessing } = usePayment();
 *   await initiatePayment({ type: 'group_creation', groupId, amount, slotNumber });
 */

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { paystackService } from '@/lib/paystackService';
import type { PaymentMetadata } from '@/lib/paystackService';
import { createClient } from '@/lib/client/supabase';
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
      const supabase = createClient();

      // Step 1: Create a pending transaction via the initialize-payment edge function.
      // The edge function is the authoritative source for the reference and amount.
      const initBody =
        params.type === 'contribution'
          ? {
              groupId: params.groupId,
              amount: paystackService.toKobo(params.amount),
              paymentType: params.type,
              contributionId: params.contributionId,
              cycleNumber: params.cycleNumber,
            }
          : {
              groupId: params.groupId,
              amount: paystackService.toKobo(params.amount),
              paymentType: params.type,
              slotNumber: params.slotNumber,
            };

      console.log('[usePayment] Calling initialize-payment edge function', initBody);
      const { data: initData, error: initError } = await supabase.functions.invoke(
        'initialize-payment',
        { body: initBody }
      );

      if (initError || !initData?.reference) {
        const message = initData?.error ?? initError?.message ?? 'Failed to initialize payment';
        console.error('[usePayment] initialize-payment failed:', message);
        toast.error(message);
        setIsProcessing(false);
        return;
      }

      const { reference } = initData as { reference: string };
      console.log('[usePayment] Pending transaction created', { reference });

      // Step 2: Build the type query param used in the success URL.
      const typeParam = params.type === 'contribution' ? '&type=contribution' : '';

      // Step 3: Build metadata to pass to Paystack (the webhook also reads this).
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

      // Step 4: Open the Paystack popup. On success, redirect immediately — do NOT
      // attempt inline verification here to avoid UI getting stuck in a loading state.
      await paystackService.openPopup({
        email: user.email,
        amount: paystackService.toKobo(params.amount),
        reference,
        metadata,
        onSuccess: (response) => {
          const resolvedRef = response.reference ?? reference;
          const resolvedPath = `/payment/success?reference=${resolvedRef}&group=${params.groupId}${typeParam}`;
          console.log('[usePayment] Payment successful, redirecting to success page', {
            reference: resolvedRef,
          });
          toast.success('Payment completed! Verifying…');
          window.location.href = resolvedPath;
        },
        onClose: () => {
          console.log('[usePayment] Payment popup closed by user');
          toast.info('Payment cancelled');
          setIsProcessing(false);
        },
      });

      // Note: if openPopup resolves without onSuccess being called (popup closed),
      // setIsProcessing(false) was already called in onClose.
    } catch (error) {
      console.error('[usePayment] Unexpected payment error:', error);
      toast.error('Failed to initialize payment. Please try again.');
      setIsProcessing(false);
    }
  };

  return { initiatePayment, isProcessing };
}
