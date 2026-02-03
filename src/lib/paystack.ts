/**
 * Paystack Payment Service
 * 
 * Handles all Paystack payment integrations for the Smart Ajo platform.
 * Uses Paystack Inline JS for popup checkout experience.
 * 
 * SECURITY NOTE:
 * - Only uses public key on frontend
 * - Payment verification happens on backend (Supabase Edge Functions)
 * - Never expose secret key in frontend code
 */

// Extend Window interface to include PaystackPop
declare global {
  interface Window {
    PaystackPop: {
      setup: (config: PaystackConfig) => {
        openIframe: () => void;
      };
    };
  }
}

export interface PaystackConfig {
  key?: string;
  email: string;
  amount: number; // Amount in kobo (smallest currency unit)
  ref?: string; // Unique transaction reference
  reference?: string; // Alternative to ref
  currency?: string;
  metadata?: Record<string, any>;
  callback_url?: string; // Callback URL (note: doesn't work with popup mode)
  onSuccess?: (response: PaystackResponse) => void;
  onCancel?: () => void;
  onClose?: () => void;
}

export interface PaystackResponse {
  reference: string;
  status: string;
  message: string;
  transaction: string;
  trxref: string;
}

export interface PaymentMetadata {
  userId: string;
  groupId: string;
  paymentType: 'group_creation' | 'group_join' | 'contribution' | 'security_deposit';
  slotNumber?: number;
  cycleId?: string;
  customFields?: Array<{
    display_name: string;
    variable_name: string;
    value: string | number;
  }>;
}

/**
 * Paystack Service Class
 */
class PaystackService {
  private publicKey: string;
  private scriptLoaded: boolean = false;

  constructor() {
    this.publicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || '';
    
    if (!this.publicKey) {
      console.error('Paystack public key not configured');
    }
  }

  /**
   * Load Paystack Inline JS script
   */
  private async loadPaystackScript(): Promise<void> {
    if (this.scriptLoaded) {
      return;
    }

    return new Promise((resolve, reject) => {
      // Check if script already exists
      if (document.querySelector('script[src*="paystack"]')) {
        this.scriptLoaded = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://js.paystack.co/v1/inline.js';
      script.async = true;
      script.onload = () => {
        this.scriptLoaded = true;
        resolve();
      };
      script.onerror = () => {
        reject(new Error('Failed to load Paystack script'));
      };
      document.body.appendChild(script);
    });
  }

  /**
   * Convert Naira to Kobo (Paystack requires amount in smallest currency unit)
   * @param naira Amount in Naira
   * @returns Amount in Kobo
   */
  public toKobo(naira: number): number {
    return Math.round(naira * 100);
  }

  /**
   * Convert Kobo to Naira
   * @param kobo Amount in Kobo
   * @returns Amount in Naira
   */
  public toNaira(kobo: number): number {
    return kobo / 100;
  }

  /**
   * Generate a unique transaction reference
   */
  public generateReference(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    return `AJO-${timestamp}-${random}`;
  }

  /**
   * Initialize Paystack payment
   * @param config Payment configuration
   * @returns Promise that resolves when payment is completed or rejected
   */
  public async initializePayment(
    config: PaystackConfig
  ): Promise<PaystackResponse> {
    const publicKey = config.key || this.publicKey;
    
    if (!publicKey) {
      throw new Error('Paystack public key not configured. Please set VITE_PAYSTACK_PUBLIC_KEY in your environment variables.');
    }

    // Load Paystack script if not already loaded
    await this.loadPaystackScript();

    // Check if PaystackPop is available
    if (!window.PaystackPop) {
      throw new Error('Paystack script not loaded properly');
    }

    return new Promise((resolve, reject) => {
      try {
        const handler = window.PaystackPop.setup({
          key: publicKey,
          email: config.email,
          amount: config.amount,
          ref: config.ref || config.reference || this.generateReference(),
          currency: config.currency || 'NGN',
          metadata: config.metadata || {},
          callback_url: config.callback_url,
          onSuccess: (response: PaystackResponse) => {
            if (config.onSuccess) {
              config.onSuccess(response);
            }
            resolve(response);
          },
          onCancel: () => {
            if (config.onCancel) {
              config.onCancel();
            }
            reject(new Error('Payment cancelled by user'));
          },
          onClose: () => {
            if (config.onClose) {
              config.onClose();
            }
            // Note: onClose is called after both success and cancel
          },
        });

        handler.openIframe();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Quick helper to initiate payment with common defaults
   */
  public async initiatePayment(params: {
    email: string;
    amount: number; // In Naira
    metadata: PaymentMetadata;
    reference?: string;
    onSuccess: (response: PaystackResponse) => void;
    onCancel?: () => void;
    onClose?: () => void;
  }): Promise<PaystackResponse> {
    return this.initializePayment({
      key: this.publicKey,
      email: params.email,
      amount: this.toKobo(params.amount),
      ref: params.reference,
      metadata: params.metadata,
      onSuccess: params.onSuccess,
      onCancel: params.onCancel,
      onClose: params.onClose,
    });
  }

  /**
   * Verify payment (should be done on backend for security)
   * This is a placeholder - actual verification happens via Supabase Edge Function
   */
  public async verifyPayment(reference: string): Promise<Record<string, unknown>> {
    // This will be handled by Supabase Edge Function
    // Frontend should call the edge function endpoint
    console.warn('Payment verification should be done on backend via Edge Function');
    return { reference, verified: false };
  }
}

// Export singleton instance
export const paystackService = new PaystackService();

/**
 * Quick helper function for initiating Paystack payments
 */
export const initiatePaystackPayment = async (params: {
  email: string;
  amount: number;
  metadata?: PaymentMetadata;
  reference?: string;
  onSuccess: (response?: PaystackResponse) => void;
  onCancel?: () => void;
  onClose?: () => void;
}): Promise<PaystackResponse> => {
  // Ensure metadata has required fields
  const defaultMetadata: PaymentMetadata = {
    userId: '',
    groupId: '',
    paymentType: 'contribution',
    ...params.metadata,
  };
  
  return paystackService.initializePayment({
    key: paystackService['publicKey'], // Access private field for consistency
    email: params.email,
    amount: paystackService.toKobo(params.amount),
    ref: params.reference,
    metadata: defaultMetadata,
    onSuccess: params.onSuccess,
    onCancel: params.onCancel,
    onClose: params.onClose,
  });
};

export default paystackService;
