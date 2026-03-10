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

      // Retrieve the current session so we can attach the JWT to edge function calls.
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

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

      // Step 4: Open the Paystack popup.
      // On success:
      //   a) Fire an inline verify-payment call in the background (non-blocking).
      //      This ensures the DB is updated even if the success page redirect fails or
      //      the user closes the browser tab immediately after payment.
      //   b) Redirect to PaymentSuccessPage regardless — it shows the confirmed result.
      // The webhook independently records the payment server-side (primary layer).
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

          // Layer 2: inline verification — fire-and-forget, do not block the redirect.
          // Even if this fails, the webhook (layer 1) and success page (layer 3) act as fallback.
          // Reuse the supabase client from the outer scope — it already has the user's session.
          const verifyFn =
            params.type === 'contribution' ? 'verify-contribution' : 'verify-payment';
          supabase.functions
            .invoke(verifyFn, { body: { reference: resolvedRef }, headers: authHeaders })
            .then(({ data, error: fnErr }) => {
              if (fnErr || !data?.success) {
                console.warn(
                  '[usePayment] Inline verification attempt failed — webhook and success page will handle it',
                  fnErr?.message ?? data?.error
                );
              } else {
                console.log('[usePayment] Inline verification succeeded', { reference: resolvedRef });
              }
            })
            .catch((err: unknown) => {
              console.warn('[usePayment] Inline verification error (non-critical):', err);
            });

          // Layer 3: always redirect to success page for user-facing confirmation.
          setIsProcessing(false);
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
