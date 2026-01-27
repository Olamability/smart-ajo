/**
 * Paystack Frontend Integration - Clean Implementation
 * 
 * This module handles ONLY payment initialization using Paystack's inline.js popup.
 * 
 * CRITICAL SECURITY RULES:
 * ✅ Frontend ONLY initializes payment (opens Paystack modal)
 * ✅ Frontend NEVER marks payment as successful
 * ✅ Frontend NEVER updates database or business logic
 * ✅ All verification and business logic happens on backend via Edge Functions
 * ✅ Frontend only uses public key - secret key NEVER exposed
 * 
 * Flow:
 * 1. Frontend calls initializePayment() with email, amount, reference
 * 2. Paystack popup opens for user to complete payment
 * 3. On success callback, frontend redirects to payment success page
 * 4. Payment success page calls backend to verify payment
 * 5. Backend verifies with Paystack, updates DB, executes business logic
 */

// ============================================================================
// TYPES
// ============================================================================

interface PaystackConfig {
  publicKey: string;
}

interface PaystackPopupData {
  email: string;
  amount: number; // Amount in kobo (smallest currency unit)
  reference: string;
  metadata?: Record<string, any>;
  callback_url?: string; // Redirect URL after payment
  onSuccess?: (response: PaystackResponse) => void;
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

// ============================================================================
// PAYSTACK SERVICE
// ============================================================================

class PaystackService {
  private config: PaystackConfig;
  private scriptLoaded: boolean = false;

  constructor() {
    this.config = {
      publicKey: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || '',
    };
  }

  /**
   * Load Paystack inline.js script
   * Script is loaded from Paystack CDN on demand
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
        console.log('[Paystack] Script loaded successfully');
        resolve();
      };
      script.onerror = () => {
        console.error('[Paystack] Failed to load script');
        reject(new Error('Failed to load Paystack script'));
      };
      document.body.appendChild(script);
    });
  }

  /**
   * Initialize and open Paystack payment popup
   * 
   * This ONLY opens the payment modal. It does NOT verify or process the payment.
   * After payment, the callback_url is used to redirect to verification page.
   * 
   * @param data - Payment data including email, amount, reference
   * @throws Error if public key not configured or script fails to load
   */
  async initializePayment(data: PaystackPopupData): Promise<void> {
    // Validate public key is configured
    if (!this.config.publicKey || this.config.publicKey === 'pk_test_your_paystack_public_key_here') {
      throw new Error(
        'Paystack public key not configured. Please set VITE_PAYSTACK_PUBLIC_KEY in your environment variables.'
      );
    }

    console.log('[Paystack] Initializing payment for reference:', data.reference);

    // Load Paystack script if not already loaded
    await this.loadScript();

    if (!window.PaystackPop) {
      throw new Error('Paystack script not available');
    }

    // Setup payment handler
    const handler = window.PaystackPop.setup({
      key: this.config.publicKey,
      email: data.email,
      amount: data.amount, // Amount should be in kobo
      ref: data.reference,
      metadata: data.metadata || {},
      callback_url: data.callback_url, // Redirect URL after payment
      callback: (response: PaystackResponse) => {
        console.log('[Paystack] Payment callback received:', response.reference);
        // Frontend callback does NOT mean payment is verified!
        // This just means Paystack returned a response.
        // Verification MUST happen on backend.
        if (data.onSuccess) {
          data.onSuccess(response);
        }
      },
      onClose: () => {
        console.log('[Paystack] Payment modal closed');
        if (data.onClose) {
          data.onClose();
        }
      },
    });

    // Open payment modal
    console.log('[Paystack] Opening payment modal');
    handler.openIframe();
  }

  /**
   * Convert amount from Naira to Kobo
   * Paystack expects amounts in the smallest currency unit (kobo for NGN)
   * 
   * @param naira - Amount in Naira
   * @returns Amount in Kobo
   */
  toKobo(naira: number): number {
    return Math.round(naira * 100);
  }

  /**
   * Generate a unique payment reference
   * Reference format: PREFIX_TIMESTAMP_RANDOM
   * 
   * @param prefix - Prefix for the reference (default: 'PAY')
   * @returns Unique payment reference
   */
  generateReference(prefix: string = 'PAY'): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    return `${prefix}_${timestamp}_${random}`;
  }
}

// Export singleton instance
export const paystackService = new PaystackService();

// Export types
export type { PaystackResponse, PaystackPopupData };
