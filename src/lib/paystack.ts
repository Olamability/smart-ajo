/**
 * Paystack Payment Integration
 * 
 * This module handles payment initialization using Paystack.
 * Only the public key is used on the frontend. Payment verification happens
 * on the backend via Supabase Edge Functions.
 * 
 * CRITICAL SECURITY RULES (per Paystack steup.md):
 * - Frontend MUST NOT mark payment as successful
 * - Frontend MUST NOT update wallet, subscription, or access rights
 * - Frontend only initializes payment and collects email
 * - All payment verification MUST happen via backend Edge Functions
 * - Backend authority rule: Frontend success ≠ payment success
 */

interface PaystackConfig {
  publicKey: string;
}

interface PaystackPaymentData {
  email: string;
  amount: number; // Amount in kobo (smallest currency unit)
  reference: string;
  metadata?: Record<string, any>;
  callback?: (response: PaystackResponse) => void;
  onClose?: () => void;
}

interface PaystackResponse {
  reference: string;
  status: string;
  trans: string;
  transaction: string;
  trxref: string;
  message?: string;
}

// Extend Window interface for Paystack
declare global {
  interface Window {
    PaystackPop?: {
      setup: (config: any) => {
        openIframe: () => void;
      };
    };
  }
}

class PaystackService {
  private config: PaystackConfig;
  private scriptLoaded: boolean = false;

  constructor() {
    this.config = {
      publicKey: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || '',
    };
  }

  /**
   * Load Paystack inline script
   */
  private async loadScript(): Promise<void> {
    if (this.scriptLoaded && window.PaystackPop) {
      return;
    }

    return new Promise((resolve, reject) => {
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
   * Generate a unique payment reference
   */
  generateReference(prefix: string = 'PAY'): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Convert amount from Naira to Kobo
   */
  private toKobo(amount: number): number {
    return Math.round(amount * 100);
  }

  /**
   * Initialize a payment
   */
  async initializePayment(data: PaystackPaymentData): Promise<void> {
    if (!this.config.publicKey || this.config.publicKey === 'pk_test_your_paystack_public_key_here') {
      throw new Error(
        'Paystack public key not configured. Please set VITE_PAYSTACK_PUBLIC_KEY in your .env file. ' +
        'See ENVIRONMENT_SETUP.md for detailed setup instructions.'
      );
    }

    // Ensure script is loaded
    await this.loadScript();

    if (!window.PaystackPop) {
      throw new Error('Paystack script not loaded');
    }

    // Setup payment handler
    const handler = window.PaystackPop.setup({
      key: this.config.publicKey,
      email: data.email,
      amount: data.amount, // Amount should already be in kobo
      ref: data.reference,
      metadata: data.metadata || {},
      callback: (response: PaystackResponse) => {
        if (data.callback) {
          data.callback(response);
        }
      },
      onClose: () => {
        if (data.onClose) {
          data.onClose();
        }
      },
    });

    // Open payment modal
    handler.openIframe();
  }

  /**
   * Pay security deposit
   */
  async paySecurityDeposit(
    email: string,
    amount: number,
    groupId: string,
    userId: string,
    callback?: (response: PaystackResponse) => void
  ): Promise<void> {
    const reference = this.generateReference('SEC_DEP');
    
    return this.initializePayment({
      email,
      amount: this.toKobo(amount),
      reference,
      metadata: {
        // MANDATORY metadata per Paystack steup.md specification
        app: 'smartajo',
        user_id: userId,
        purpose: 'security_deposit',
        entity_id: groupId,
        // Backward compatibility fields
        type: 'security_deposit',
        group_id: groupId,
        custom_fields: [
          {
            display_name: 'Payment Type',
            variable_name: 'payment_type',
            value: 'Security Deposit',
          },
          {
            display_name: 'Group ID',
            variable_name: 'group_id',
            value: groupId,
          },
        ],
      },
      callback,
    });
  }

  /**
   * Pay contribution
   */
  async payContribution(
    email: string,
    amount: number,
    groupId: string,
    userId: string,
    cycleNumber: number,
    callback?: (response: PaystackResponse) => void
  ): Promise<void> {
    const reference = this.generateReference('CONTRIB');
    
    return this.initializePayment({
      email,
      amount: this.toKobo(amount),
      reference,
      metadata: {
        // MANDATORY metadata per Paystack steup.md specification
        app: 'smartajo',
        user_id: userId,
        purpose: 'contribution',
        entity_id: groupId,
        // Backward compatibility fields
        type: 'contribution',
        group_id: groupId,
        cycle_number: cycleNumber,
        custom_fields: [
          {
            display_name: 'Payment Type',
            variable_name: 'payment_type',
            value: 'Contribution',
          },
          {
            display_name: 'Group ID',
            variable_name: 'group_id',
            value: groupId,
          },
          {
            display_name: 'Cycle',
            variable_name: 'cycle',
            value: cycleNumber.toString(),
          },
        ],
      },
      callback,
    });
  }
}

// Export singleton instance
export const paystackService = new PaystackService();

// Export types
export type { PaystackResponse, PaystackPaymentData };
