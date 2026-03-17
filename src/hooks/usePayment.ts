/**
 * usePayment Hook
 *
 * Handles the Paystack payment flow with Supabase edge functions.
 * Uses the singleton Supabase client (src/lib/client/supabase.ts) to ensure
 * the in-memory auth session is shared with AuthContext, avoiding the 401
 * Unauthorized errors that occurred when fresh client instances hadn't yet
 * loaded the session from cookies before invoking Edge Functions.
 *
 * Auth approach: we call supabase.auth.getUser() (a server-side validation)
 * to confirm the session is current before payment, then let the Supabase
 * client attach the Authorization header automatically in functions.invoke().
 * Manually extracting getSession().access_token and passing it as a header
 * was the original source of 401 errors: getSession() can return a cached
 * (expired) token that overrides the client's auto-refreshed header.
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
import { logger } from '@/utils/logger';

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

      // Validate the current session via the auth server (server-side check).
      // getUser() is preferred over getSession() here: getSession() returns
      // the cached (potentially stale) access token, which – when forwarded
      // manually as an Authorization header – can override the Supabase
      // client's auto-refreshed header and trigger a 401 from the Edge
      // Function's JWT verification.  getUser() performs a live validation so
      // we know the session is genuine before we start the payment flow.
      const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();

      if (userError || !currentUser) {
        toast.error('Session expired. Please log in again.');
        setIsProcessing(false);
        return;
      }

      // Step 1: Create pending transaction via initialize-payment
      // No manual Authorization header is passed; the singleton Supabase
      // client attaches the fresh session token automatically inside invoke().
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

      logger.log('[usePayment] Calling initialize-payment edge function');

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
      logger.log('[usePayment] Pending transaction created');

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

          logger.log('[usePayment] Payment successful');
          toast.success('Payment completed! Verifying…');

          // Layer 2: inline fire-and-forget verification
          const verifyFn =
            params.type === 'contribution' ? 'verify-contribution' : 'verify-payment';
          supabase.functions
            .invoke(verifyFn, { body: { reference: resolvedRef } })
            .then(({ data, error: fnErr }) => {
              if (fnErr || !data?.success) {
                logger.warn(
                  '[usePayment] Inline verification failed — webhook & success page fallback'
                );
              } else {
                logger.log('[usePayment] Inline verification succeeded');
              }
            })
            .catch((_err: unknown) => {
              logger.warn('[usePayment] Inline verification non-critical issue');
            });

          // Layer 3: redirect to success page
          setIsProcessing(false);
          window.location.href = resolvedPath;
        },
        onClose: () => {
          logger.log('[usePayment] Payment popup closed by user');
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
