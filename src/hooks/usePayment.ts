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

      // Step 3: Open the Paystack inline checkout popup
      await paystackService.initializePayment({
        email: user.email,
        amount: paystackService.toKobo(params.amount),
        reference,
        metadata,
        callback_url: `${import.meta.env.VITE_APP_URL}${successUrl}`,
        onSuccess: () => {
          toast.success('Payment completed! Verifying...', { duration: 2000 });
          // Use a full-page redirect so the session is cleanly restored before verification
          window.location.href = successUrl;
        },
        onClose: () => {
          toast.info('Payment cancelled');
          setIsProcessing(false);
        },
      });
    } catch (error) {
      console.error('Payment error:', error);
      toast.error('Failed to initialize payment');
      setIsProcessing(false);
    }
  };

  return { initiatePayment, isProcessing };
}
