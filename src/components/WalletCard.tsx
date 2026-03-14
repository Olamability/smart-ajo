/**
 * WalletCard Component
 *
 * Displays the user's wallet summary:
 *   • Available balance
 *   • Locked (escrow) balance
 *   • Total balance
 *   • Recent wallet transactions
 *
 * Uses the useWallet hook which is backed by React Query and Supabase
 * real-time so the card updates automatically when the backend changes.
 */

import { useWallet } from '@/hooks/useWallet';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Wallet, Lock, TrendingUp, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);

const txnLabel: Record<string, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  payout: 'Payout',
  fee: 'Service Fee',
  penalty: 'Penalty',
  refund: 'Refund',
};

export default function WalletCard() {
  const { available, locked, total, transactions, isLoading, error } = useWallet();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="py-6">
          <p className="text-sm text-red-700 text-center">
            Unable to load wallet data. Please refresh the page.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-primary" />
          <div>
            <CardTitle>My Wallet</CardTitle>
            <CardDescription>Your Ajo savings balance</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Balance summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Available
              </span>
            </div>
            <p className="text-xl font-bold text-green-700">{formatCurrency(available)}</p>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="w-4 h-4 text-amber-600" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Locked
              </span>
            </div>
            <p className="text-xl font-bold text-amber-700">{formatCurrency(locked)}</p>
            <p className="text-xs text-muted-foreground mt-1">Held in escrow</p>
          </div>

          <div className="rounded-lg border bg-primary/5 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Total
              </span>
            </div>
            <p className="text-xl font-bold text-primary">{formatCurrency(total)}</p>
          </div>
        </div>

        {/* Recent transactions */}
        {transactions.length > 0 && (
          <div>
            <p className="text-sm font-semibold mb-3">Recent Activity</p>
            <div className="space-y-2">
              {transactions.map((txn) => {
                const isInflow = txn.transaction_type === 'payout' || txn.transaction_type === 'refund';
                return (
                  <div
                    key={txn.id}
                    className="flex items-center gap-3 p-3 border rounded-lg"
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isInflow ? 'bg-green-100' : 'bg-red-100'
                      }`}
                    >
                      {isInflow ? (
                        <ArrowDownLeft className="w-4 h-4 text-green-600" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-red-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {txnLabel[txn.transaction_type] ?? txn.transaction_type}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Ref: {txn.reference}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-sm font-semibold ${
                          isInflow ? 'text-green-700' : 'text-red-700'
                        }`}
                      >
                        {isInflow ? '+' : '-'}
                        {formatCurrency(txn.amount)}
                      </p>
                      <Badge variant="outline" className="text-xs">
                        {txn.transaction_type}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {transactions.length === 0 && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">No recent wallet activity</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
