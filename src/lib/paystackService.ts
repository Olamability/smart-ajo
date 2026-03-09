/**
 * Paystack Payment Service (Clean Implementation)
 *
 * Handles Paystack inline popup integration.
 * The frontend NEVER verifies payments — it only opens the popup and
 * redirects to the success page where the backend edge function verifies.
 *
 * Correct production flow:
 *   User → Paystack popup → Paystack → Webhook → Edge Function → DB update → UI refresh
 */

declare global {
  interface Window {
    PaystackPop: {
      setup: (config: PaystackPopupConfig) => { openIframe: () => void };
    };
  }
}

export interface PaystackPopupConfig {
  key: string;
  email: string;
  amount: number;
  ref: string;
  currency?: string;
  metadata?: Record<string, unknown>;
  callback_url?: string;
  onSuccess: (response: PaystackSuccessResponse) => void;
  onCancel?: () => void;
  onClose?: () => void;
}

export interface PaystackSuccessResponse {
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
  contributionId?: string;
  cycleNumber?: number;
}

class PaystackService {
  private readonly publicKey: string;
  private scriptLoaded = false;

  constructor() {
    this.publicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY ?? '';
    if (!this.publicKey) {
      console.error('[PaystackService] VITE_PAYSTACK_PUBLIC_KEY is not set');
    }
  }

  /** Convert Naira to Kobo (Paystack requires amount in kobo) */
  toKobo(naira: number): number {
    return Math.round(naira * 100);
  }

  /** Convert Kobo to Naira */
  toNaira(kobo: number): number {
    return kobo / 100;
  }

  /** Generate a unique payment reference */
  generateReference(): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `ajo_txn_${ts}_${rand}`;
  }

  private async loadScript(): Promise<void> {
    if (this.scriptLoaded || document.querySelector('script[src*="paystack"]')) {
      this.scriptLoaded = true;
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
      script.onerror = () => reject(new Error('Failed to load Paystack script'));
      document.body.appendChild(script);
    });
  }

  /**
   * Open the Paystack inline popup.
   * On success the caller should redirect to the PaymentSuccessPage —
   * never attempt inline verification here.
   */
  async openPopup(config: {
    email: string;
    amount: number; // in kobo
    reference: string;
    metadata?: PaymentMetadata;
    onSuccess: (response: PaystackSuccessResponse) => void;
    onClose?: () => void;
  }): Promise<void> {
    if (!this.publicKey) {
      throw new Error('Paystack public key not configured. Set VITE_PAYSTACK_PUBLIC_KEY.');
    }

    await this.loadScript();

    if (!window.PaystackPop) {
      throw new Error('Paystack script failed to initialize');
    }

    // Track completion so onClose does not fire a false cancellation.
    let paymentCompleted = false;

    const handler = window.PaystackPop.setup({
      key: this.publicKey,
      email: config.email,
      amount: config.amount,
      ref: config.reference,
      currency: 'NGN',
      metadata: config.metadata as unknown as Record<string, unknown>,
      onSuccess: (response: PaystackSuccessResponse) => {
        console.log('[PaystackService] Payment successful', {
          reference: response.reference,
          status: response.status,
        });
        paymentCompleted = true;
        config.onSuccess(response);
      },
      onClose: () => {
        // Paystack also triggers onClose after a successful payment — ignore that.
        if (!paymentCompleted) {
          console.log('[PaystackService] Popup closed by user without completing payment');
          config.onClose?.();
        }
      },
    });

    handler.openIframe();
  }
}

export const paystackService = new PaystackService();
export default paystackService;
