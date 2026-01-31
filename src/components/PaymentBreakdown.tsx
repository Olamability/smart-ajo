import React, { useState } from "react";

// Helper to get Paystack public key from env
const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

// Load Paystack script from CDN
const loadPaystackScriptFromCDN = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    // Check if script is already loaded
    if (window.PaystackPop) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Paystack script'));
    document.body.appendChild(script);
  });
};

interface PaymentBreakdownProps {
  amount: number; // Amount in Naira
  email: string; // User email
  reference: string; // Unique payment reference
  onPaymentSuccess?: (ref: string) => void;
  onPaymentError?: (error: any) => void;
}
export const PaystackPaymentBreakdown: React.FC<PaymentBreakdownProps> = ({
  amount,
  email,
  reference,
  onPaymentSuccess,
  onPaymentError,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  const handlePaystackPayment = async () => {
    setError(null);
    setVerificationError(null);
    setLoading(true);
    setVerifying(false);
    setVerified(false);
    try {
      // Load Paystack script from CDN
      await loadPaystackScriptFromCDN();

      // @ts-ignore
      const handler = window.PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email,
        amount: amount * 100, // Paystack expects kobo
        ref: reference,
        callback: async (response: any) => {
          setLoading(false);
          setVerifying(true);
          try {
            // Call Supabase Edge Function to verify payment and activate membership
            const verifyRes = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-payment`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reference: response.reference }),
              }
            );
            if (verifyRes.ok) {
              setVerified(true);
              setVerifying(false);
              if (onPaymentSuccess) onPaymentSuccess(response.reference);
            } else {
              setVerificationError('Payment made, but verification failed.');
              setVerifying(false);
              if (onPaymentError) onPaymentError('Verification failed');
            }
          } catch (e) {
            setVerificationError('Payment made, but verification failed.');
            setVerifying(false);
            if (onPaymentError) onPaymentError(e);
          }
        },
        onCancel: () => {
          setLoading(false);
          setError("Payment window closed.");
        },
      });

      // Open the payment modal
      handler.openIframe();
    } catch (err: any) {
      setLoading(false);
      setError("Failed to load Paystack. Please try again.");
      if (onPaymentError) onPaymentError(err);
    }
  };

  return (
    <div className="payment-breakdown">
      {/* ...existing breakdown UI... */}
      <button
        className="paystack-btn"
        onClick={handlePaystackPayment}
        disabled={loading || verifying || verified}
      >
        {loading
          ? "Processing..."
          : verifying
          ? "Verifying..."
          : verified
          ? "Payment Verified"
          : "Pay with Paystack"}
      </button>
      {error && <div className="text-red-500 mt-2">{error}</div>}
      {verificationError && <div className="text-red-500 mt-2">{verificationError}</div>}
      {verified && <div className="text-green-600 mt-2">Payment successful and membership activated!</div>}
    </div>
  );
};
// ...existing code...
// ...existing code...
/**
 * Payment Breakdown Component
 * 
 * Displays a detailed breakdown of payment amounts for group membership
 * Shows security deposit, first contribution, and total amount
 */

interface PaymentBreakdownDetailsProps {
  securityDepositAmount: number;
  contributionAmount: number;
  formatCurrency: (amount: number) => string;
}

export default function PaymentBreakdown({
  securityDepositAmount,
  contributionAmount,
  formatCurrency,
}: PaymentBreakdownDetailsProps) {
  const totalAmount = securityDepositAmount + contributionAmount;

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg">
      <h4 className="font-semibold text-gray-900 mb-3">Payment Breakdown</h4>
      <div className="flex justify-between items-center text-sm mb-2">
        <span className="text-gray-600">Security Deposit:</span>
        <span className="font-semibold">{formatCurrency(securityDepositAmount)}</span>
      </div>
      <div className="flex justify-between items-center text-sm mb-2">
        <span className="text-gray-600">First Contribution:</span>
        <span className="font-semibold">{formatCurrency(contributionAmount)}</span>
      </div>
      <div className="flex justify-between items-center pt-2 border-t border-gray-200">
        <span className="font-bold text-gray-900">Total Amount:</span>
        <span className="font-bold text-primary">
          {formatCurrency(totalAmount)}
        </span>
      </div>
    </div>
  );
}
