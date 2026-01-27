/**
 * Contributions Component
 * 
 * Displays contribution schedule and allows users to make payments
 */

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getGroupContributions, initializeContributionPayment } from '@/api';
import type { Contribution } from '@/types';
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
import { toast } from 'sonner';
import { format } from 'date-fns';

interface ContributionsListProps {
  groupId: string;
  groupName: string;
  contributionAmount: number;
}

export default function ContributionsList({
  groupId,
  groupName,
  contributionAmount,
}: ContributionsListProps) {
  const { user } = useAuth();
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingPayment, setProcessingPayment] = useState<string | null>(null);

  useEffect(() => {
    loadContributions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const loadContributions = async () => {
    setLoading(true);
    try {
      const result = await getGroupContributions(groupId);
      if (result.success && result.contributions) {
        // Filter for current user's contributions
        const userContributions = result.contributions.filter(
          (c) => c.userId === user?.id
        );
        setContributions(userContributions);
      }
    } catch (error) {
      console.error('Error loading contributions:', error);
      toast.error('Failed to load contributions');
    } finally {
      setLoading(false);
    }
  };

  const handlePayContribution = async (contribution: Contribution) => {
    if (!user) return;

    setProcessingPayment(contribution.id);
    
    try {
      // Initialize payment record in database
      const result = await initializeContributionPayment(
        contribution.id,
        groupId,
        contribution.amount
      );
      
      if (!result.success || !result.reference) {
        toast.error(result.error || 'Failed to initialize payment');
        setProcessingPayment(null);
        return;
      }

      // Get Paystack public key from environment
      const paystackKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
      
      if (!paystackKey) {
        toast.error('Payment configuration error. Please contact support.');
        setProcessingPayment(null);
        return;
      }

      // Prepare Paystack config
      const config = {
        reference: result.reference,
        email: user.email || '',
        amount: Math.round(contribution.amount * 100), // Convert to kobo
        publicKey: paystackKey,
        onSuccess: () => {
          // Redirect to payment success page for verification
          window.location.href = `/payment-success?reference=${result.reference}&type=contribution`;
        },
        onClose: () => {
          toast.info('Payment cancelled');
          setProcessingPayment(null);
        },
      };

      // Initialize Paystack and open payment modal
      const PaystackPop = (window as { PaystackPop?: { setup: (config: any) => { openIframe: () => void } } }).PaystackPop;
      
      if (PaystackPop) {
        const handler = PaystackPop.setup(config);
        handler.openIframe();
      } else {
        toast.error('Payment system not loaded. Please refresh the page.');
        setProcessingPayment(null);
      }
      
    } catch (error) {
      console.error('Payment error:', error);
      toast.error('Failed to initialize payment');
      setProcessingPayment(null);
    }
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
                disabled={processingPayment === contribution.id}
                className="w-full"
              >
                {processingPayment === contribution.id ? (
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
                  disabled={processingPayment === contribution.id}
                  variant="destructive"
                  className="w-full"
                >
                  {processingPayment === contribution.id ? (
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
