/**
 * Contributions Component
 *
 * Displays contribution cycles (upcoming, paid, overdue) and lets users
 * pay via Paystack.  Backed by useContributions which uses React Query
 * and a Supabase real-time subscription so the list refreshes
 * automatically after a payment is verified.
 */

import { useContributions } from '@/hooks/useContributions';
import type { Contribution } from '@/types';
import { usePayment } from '@/hooks/usePayment';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Calendar, Loader2, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';

interface ContributionsListProps {
  groupId: string;
  groupName: string;
}

export default function ContributionsList({
  groupId,
  groupName,
}: ContributionsListProps) {
  const { user } = useAuth();
  const { initiatePayment, isProcessing } = usePayment();
  const { contributions, isLoading: loading } = useContributions({ groupId });
  // Track which contribution is being paid so only its button shows loading
  const [payingContributionId, setPayingContributionId] = useState<string | null>(null);

  const handlePayContribution = async (contribution: Contribution) => {
    if (!user || isProcessing) return;

    setPayingContributionId(contribution.id);
    await initiatePayment({
      type: 'contribution',
      groupId,
      contributionId: contribution.id,
      amount: contribution.amount,
      cycleNumber: contribution.cycleNumber,
    });
    // Clear the per-contribution indicator once the hook finishes
    // (fires when popup closes without payment; on success the page redirects away)
    setPayingContributionId(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-500';
      case 'pending':
        return 'bg-yellow-500';
      case 'overdue':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-4 h-4" />;
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'overdue':
        return <AlertCircle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'MMM dd, yyyy');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (contributions.length === 0) {
    return (
      <div className="text-center py-8">
        <DollarSign className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No contributions yet</p>
        <p className="text-sm text-muted-foreground mt-2">
          Contributions will appear here once the group is activated
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {contributions.map((contribution) => (
        <Card key={contribution.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-lg">
                  Cycle {contribution.cycleNumber}
                </CardTitle>
                <CardDescription>
                  {groupName}
                </CardDescription>
              </div>
              <Badge className={getStatusColor(contribution.status)}>
                {getStatusIcon(contribution.status)}
                <span className="ml-1 capitalize">{contribution.status}</span>
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Amount</p>
                <p className="text-lg font-semibold">
                  {formatCurrency(contribution.amount)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Due Date</p>
                <p className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  {formatDate(contribution.dueDate)}
                </p>
              </div>
            </div>

            {contribution.paidDate && (
              <div className="pt-3 border-t">
                <p className="text-sm text-muted-foreground">Paid on</p>
                <p className="text-sm font-medium text-green-600">
                  {formatDate(contribution.paidDate)}
                </p>
              </div>
            )}

            {contribution.status === 'pending' && (
              <Button
                onClick={() => handlePayContribution(contribution)}
                disabled={isProcessing}
                className="w-full"
              >
                {isProcessing && payingContributionId === contribution.id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <DollarSign className="mr-2 h-4 w-4" />
                    Pay {formatCurrency(contribution.amount)}
                  </>
                )}
              </Button>
            )}

            {contribution.status === 'overdue' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  <span>This payment is overdue. Penalties may apply.</span>
                </div>
                <Button
                  onClick={() => handlePayContribution(contribution)}
                  disabled={isProcessing}
                  variant="destructive"
                  className="w-full"
                >
                  {isProcessing && payingContributionId === contribution.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <DollarSign className="mr-2 h-4 w-4" />
                      Pay Now {formatCurrency(contribution.amount)}
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
