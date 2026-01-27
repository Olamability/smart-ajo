/**
 * Payment Breakdown Component
 * 
 * Displays a detailed breakdown of payment amounts for group membership
 * Shows security deposit, first contribution, and total amount
 */

interface PaymentBreakdownProps {
  securityDepositAmount: number;
  contributionAmount: number;
  formatCurrency: (amount: number) => string;
}

export default function PaymentBreakdown({
  securityDepositAmount,
  contributionAmount,
  formatCurrency,
}: PaymentBreakdownProps) {
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
