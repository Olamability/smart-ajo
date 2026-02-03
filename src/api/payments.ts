/**
 * Payments API Service
 * 
 * Handles all payment-related operations for the Smart Ajo platform.
 * Integrates with Paystack for payment processing and Supabase for verification.
 * 
 * Payment Flow:
 * 1. Initialize payment (frontend)
 * 2. User completes payment with Paystack
 * 3. Verify payment via Supabase Edge Function (backend)
 * 4. Activate membership/update records
 */

import { createClient } from '@/lib/client/supabase';
import { paystackService, PaystackResponse, PaymentMetadata } from '@/lib/paystack';
import { getErrorMessage } from '@/lib/utils';

export interface PaymentInitializationResult {
  success: boolean;
  reference?: string;
  error?: string;
}

export interface PaymentVerificationResult {
  success: boolean;
  verified?: boolean;
  data?: any;
  error?: string;
}

/**
 * Initialize payment for group creation (creator's initial payment)
 * Creator must pay contribution + service fee + security deposit
 */
export const initializeGroupCreationPayment = async (params: {
  groupId: string;
  slotNumber: number;
  contributionAmount: number;
  serviceFeePercentage: number;
  securityDepositAmount: number;
}): Promise<PaymentInitializationResult> => {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Calculate total amount
    const serviceFee = (params.contributionAmount * params.serviceFeePercentage) / 100;
    const totalAmount = params.contributionAmount + serviceFee + params.securityDepositAmount;

    // Generate payment reference
    const reference = paystackService.generateReference();

    // Create payment metadata
    const metadata: PaymentMetadata = {
      userId: user.id,
      groupId: params.groupId,
      paymentType: 'group_creation',
      slotNumber: params.slotNumber,
      customFields: [
        {
          display_name: 'Contribution Amount',
          variable_name: 'contribution_amount',
          value: params.contributionAmount,
        },
        {
          display_name: 'Service Fee',
          variable_name: 'service_fee',
          value: serviceFee,
        },
        {
          display_name: 'Security Deposit',
          variable_name: 'security_deposit',
          value: params.securityDepositAmount,
        },
        {
          display_name: 'Slot Number',
          variable_name: 'slot_number',
          value: params.slotNumber,
        },
      ],
    };

    // Record payment intent in database
    const { error: recordError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        group_id: params.groupId,
        amount: totalAmount,
        payment_type: 'group_creation',
        status: 'pending',
        reference: reference,
        metadata: metadata,
      });

    if (recordError) {
      console.error('Error recording payment intent:', recordError);
      return { success: false, error: 'Failed to initialize payment' };
    }

    // Initialize Paystack payment
    await paystackService.initializePayment({
      key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
      email: user.email!,
      amount: paystackService.toKobo(totalAmount),
      ref: reference,
      metadata: metadata,
      onSuccess: async (response: PaystackResponse) => {
        // Payment successful - verify on backend
        await verifyPaymentAndActivateMembership(response.reference);
      },
      onCancel: async () => {
        // Update payment status to cancelled
        await supabase
          .from('payments')
          .update({ status: 'cancelled' })
          .eq('reference', reference);
      },
    });

    return { success: true, reference };
  } catch (error) {
    console.error('Error initializing group creation payment:', error);
    return { success: false, error: getErrorMessage(error) };
  }
};

/**
 * Initialize payment for joining a group (after approval)
 * Member must pay contribution + service fee + security deposit
 */
export const initializeGroupJoinPayment = async (params: {
  groupId: string;
  joinRequestId: string;
  slotNumber: number;
  contributionAmount: number;
  serviceFeePercentage: number;
  securityDepositAmount: number;
}): Promise<PaymentInitializationResult> => {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Calculate total amount
    const serviceFee = (params.contributionAmount * params.serviceFeePercentage) / 100;
    const totalAmount = params.contributionAmount + serviceFee + params.securityDepositAmount;

    // Generate payment reference
    const reference = paystackService.generateReference();

    // Create payment metadata
    const metadata: PaymentMetadata = {
      userId: user.id,
      groupId: params.groupId,
      paymentType: 'group_join',
      slotNumber: params.slotNumber,
      customFields: [
        {
          display_name: 'Join Request ID',
          variable_name: 'join_request_id',
          value: params.joinRequestId,
        },
        {
          display_name: 'Contribution Amount',
          variable_name: 'contribution_amount',
          value: params.contributionAmount,
        },
        {
          display_name: 'Service Fee',
          variable_name: 'service_fee',
          value: serviceFee,
        },
        {
          display_name: 'Security Deposit',
          variable_name: 'security_deposit',
          value: params.securityDepositAmount,
        },
        {
          display_name: 'Slot Number',
          variable_name: 'slot_number',
          value: params.slotNumber,
        },
      ],
    };

    // Record payment intent in database
    const { error: recordError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        group_id: params.groupId,
        amount: totalAmount,
        payment_type: 'group_join',
        status: 'pending',
        reference: reference,
        metadata: metadata,
      });

    if (recordError) {
      console.error('Error recording payment intent:', recordError);
      return { success: false, error: 'Failed to initialize payment' };
    }

    // Initialize Paystack payment
    await paystackService.initializePayment({
      key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
      email: user.email!,
      amount: paystackService.toKobo(totalAmount),
      ref: reference,
      metadata: metadata,
      onSuccess: async (response: PaystackResponse) => {
        // Payment successful - verify on backend
        await verifyPaymentAndActivateMembership(response.reference);
      },
      onCancel: async () => {
        // Update payment status to cancelled
        await supabase
          .from('payments')
          .update({ status: 'cancelled' })
          .eq('reference', reference);
      },
    });

    return { success: true, reference };
  } catch (error) {
    console.error('Error initializing group join payment:', error);
    return { success: false, error: getErrorMessage(error) };
  }
};

/**
 * Initialize payment for contribution cycle
 * Member pays their contribution for the current cycle
 */
export const initializeContributionPayment = async (params: {
  groupId: string;
  cycleId: string;
  contributionAmount: number;
}): Promise<PaymentInitializationResult> => {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Generate payment reference
    const reference = paystackService.generateReference();

    // Create payment metadata
    const metadata: PaymentMetadata = {
      userId: user.id,
      groupId: params.groupId,
      paymentType: 'contribution',
      cycleId: params.cycleId,
      customFields: [
        {
          display_name: 'Contribution Amount',
          variable_name: 'contribution_amount',
          value: params.contributionAmount,
        },
        {
          display_name: 'Cycle ID',
          variable_name: 'cycle_id',
          value: params.cycleId,
        },
      ],
    };

    // Record payment intent in database
    const { error: recordError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        group_id: params.groupId,
        cycle_id: params.cycleId,
        amount: params.contributionAmount,
        payment_type: 'contribution',
        status: 'pending',
        reference: reference,
        metadata: metadata,
      });

    if (recordError) {
      console.error('Error recording payment intent:', recordError);
      return { success: false, error: 'Failed to initialize payment' };
    }

    // Initialize Paystack payment
    await paystackService.initializePayment({
      key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
      email: user.email!,
      amount: paystackService.toKobo(params.contributionAmount),
      ref: reference,
      metadata: metadata,
      onSuccess: async (response: PaystackResponse) => {
        // Payment successful - verify on backend
        await verifyPaymentAndRecordContribution(response.reference);
      },
      onCancel: async () => {
        // Update payment status to cancelled
        await supabase
          .from('payments')
          .update({ status: 'cancelled' })
          .eq('reference', reference);
      },
    });

    return { success: true, reference };
  } catch (error) {
    console.error('Error initializing contribution payment:', error);
    return { success: false, error: getErrorMessage(error) };
  }
};

/**
 * Verify payment and activate membership
 * This calls the Supabase Edge Function for secure verification
 */
export const verifyPaymentAndActivateMembership = async (
  reference: string
): Promise<PaymentVerificationResult> => {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Call Supabase Edge Function to verify payment
    const { data, error } = await supabase.functions.invoke('verify-payment', {
      body: { reference },
    });

    if (error) {
      console.error('Error verifying payment:', error);
      return { success: false, error: error.message };
    }

    if (!data.success) {
      return { success: false, error: data.error || 'Payment verification failed' };
    }

    return { success: true, verified: true, data: data.data };
  } catch (error) {
    console.error('Error in payment verification:', error);
    return { success: false, error: getErrorMessage(error) };
  }
};

/**
 * Verify payment and record contribution
 * This calls the Supabase Edge Function for secure verification
 */
export const verifyPaymentAndRecordContribution = async (
  reference: string
): Promise<PaymentVerificationResult> => {
  try {
    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Call Supabase Edge Function to verify payment
    const { data, error } = await supabase.functions.invoke('verify-payment', {
      body: { reference },
    });

    if (error) {
      console.error('Error verifying payment:', error);
      return { success: false, error: error.message };
    }

    if (!data.success) {
      return { success: false, error: data.error || 'Payment verification failed' };
    }

    return { success: true, verified: true, data: data.data };
  } catch (error) {
    console.error('Error in payment verification:', error);
    return { success: false, error: getErrorMessage(error) };
  }
};

/**
 * Get payment history for a user
 */
export const getUserPayments = async (): Promise<any[]> => {
  try {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Not authenticated');
    }

    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching user payments:', error);
    throw error;
  }
};

/**
 * Get payment by reference
 */
export const getPaymentByReference = async (reference: string): Promise<any | null> => {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('reference', reference)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found
        return null;
      }
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error fetching payment by reference:', error);
    throw error;
  }
};
