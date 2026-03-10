/**
 * usePayment Hook
 *
 * Handles the Paystack payment flow with Supabase edge functions.
 * Fixes previous 401 unauthorized errors by attaching the user's JWT
 * to all edge function calls (initialize-payment and verify-payment/verify-contribution).
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

      // Get the current user's session token
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

      // Step 1: Create pending transaction via initialize-payment
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
        { body: initBody, headers: authHeaders }
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

      const typeParam = params.type === 'contribution' ? '&type=contribution' : '';

      // Build Paystack metadata
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

      // Step 2: Open Paystack popup
      await paystackService.openPopup({
        email: user.email,
        amount: paystackService.toKobo(params.amount),
        reference,
        metadata,
        onSuccess: (response) => {
          const resolvedRef = response.reference ?? reference;
          const resolvedPath = `/payment/success?reference=${resolvedRef}&group=${params.groupId}${typeParam}`;

          console.log('[usePayment] Payment successful', { reference: resolvedRef });
          toast.success('Payment completed! Verifying…');

          // Layer 2: inline fire-and-forget verification
          const verifyFn =
            params.type === 'contribution' ? 'verify-contribution' : 'verify-payment';
          supabase.functions
            .invoke(verifyFn, { body: { reference: resolvedRef }, headers: authHeaders })
            .then(({ data, error: fnErr }) => {
              if (fnErr || !data?.success) {
                console.warn(
                  '[usePayment] Inline verification failed — webhook & success page fallback',
                  fnErr?.message ?? data?.error
                );
              } else {
                console.log('[usePayment] Inline verification succeeded', { reference: resolvedRef });
              }
            })
            .catch((err: unknown) => {
              console.warn('[usePayment] Inline verification error (non-critical):', err);
            });

          // Layer 3: redirect to success page
          setIsProcessing(false);
          window.location.href = resolvedPath;
        },
        onClose: () => {
          console.log('[usePayment] Payment popup closed by user');
          toast.info('Payment cancelled');
          setIsProcessing(false);
        },
      });
    } catch (error) {
      console.error('[usePayment] Unexpected payment error:', error);
      toast.error('Failed to initialize payment. Please try again.');
      setIsProcessing(false);
    }
  };

  return { initiatePayment, isProcessing };
}
