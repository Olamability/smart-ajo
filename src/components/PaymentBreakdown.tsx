/**
 * PaymentBreakdown Component
 * 
 * Displays a detailed breakdown of payment amounts including:
 * - Contribution amount
 * - Service fee
 * - Security deposit
 * - Total amount
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { DollarSign, Shield, CreditCard, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaymentBreakdownProps {
  contributionAmount: number;
  serviceFeePercentage: number;
  securityDepositAmount: number;
  showSecurityDeposit?: boolean;
  className?: string;
}

export default function PaymentBreakdown({
  contributionAmount,
  serviceFeePercentage,
  securityDepositAmount,
  showSecurityDeposit = true,
  className,
}: PaymentBreakdownProps) {
  // Calculate amounts
  const serviceFee = (contributionAmount * serviceFeePercentage) / 100;
  const totalAmount = showSecurityDeposit
    ? contributionAmount + serviceFee + securityDepositAmount
    : contributionAmount + serviceFee;

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Payment Breakdown
        </CardTitle>
        <CardDescription>
          Here's what you'll be paying
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Contribution Amount */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <DollarSign className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="font-medium">Contribution Amount</p>
              <p className="text-xs text-muted-foreground">
                Your contribution for this cycle
              </p>
            </div>
          </div>
          <p className="font-semibold">{formatCurrency(contributionAmount)}</p>
        </div>

        {/* Service Fee */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <TrendingUp className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="font-medium">Service Fee</p>
              <p className="text-xs text-muted-foreground">
                {serviceFeePercentage}% platform service fee
              </p>
            </div>
          </div>
          <p className="font-semibold">{formatCurrency(serviceFee)}</p>
        </div>

        {/* Security Deposit */}
        {showSecurityDeposit && (
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Shield className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="font-medium">Security Deposit</p>
                <p className="text-xs text-muted-foreground">
                  Refundable at completion
                </p>
              </div>
            </div>
            <p className="font-semibold">{formatCurrency(securityDepositAmount)}</p>
          </div>
        )}

        <Separator />

        {/* Total Amount */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <p className="text-lg font-bold">Total Amount</p>
            <p className="text-xs text-muted-foreground">
              Amount to be charged
            </p>
          </div>
          <p className="text-2xl font-bold text-primary">
            {formatCurrency(totalAmount)}
          </p>
        </div>

        {/* Important Notes */}
        <div className="pt-4 space-y-2 border-t">
          <p className="text-sm font-medium">Important Notes:</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>
              Service fee ({serviceFeePercentage}%) helps maintain the platform and ensure security
            </li>
            {showSecurityDeposit && (
              <li>
                Security deposit of {formatCurrency(securityDepositAmount)} will be refunded after successful completion of the group cycle
              </li>
            )}
            <li>
              Payment is processed securely through Paystack
            </li>
            <li>
              You will receive email confirmation after successful payment
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
