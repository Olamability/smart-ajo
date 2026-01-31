/**
 * Payout Schedule Component
 * 
 * Displays the rotation order and payout status for group members
 */

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/client/supabase';
import { getGroupMembers } from '@/api';
import type { GroupMember } from '@/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Users, Loader2, CheckCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface PayoutScheduleProps {
  groupId: string;
  currentCycle: number;
  totalCycles: number;
  netPayoutAmount: number;
}

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

export default function PayoutSchedule({
  groupId,
  currentCycle,
  totalCycles,
  netPayoutAmount,
}: PayoutScheduleProps) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'success' | 'error' | 'pending'>('idle');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const loadMembers = async () => {
    setLoading(true);
    try {
      const result = await getGroupMembers(groupId);
      if (result.success && result.members) {
        setMembers(result.members);
      }
    } catch (error) {
      console.error('Error loading members:', error);
      toast.error('Failed to load payout schedule');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
    }).format(amount);
  };

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

  const getPayoutStatus = (position: number) => {
    if (position < currentCycle) {
      return { label: 'Completed', color: 'bg-green-500', icon: <CheckCircle className="w-4 h-4" /> };
    } else if (position === currentCycle) {
      return { label: 'Current', color: 'bg-blue-500', icon: <TrendingUp className="w-4 h-4" /> };
    } else {
      return { label: 'Upcoming', color: 'bg-gray-500', icon: <Clock className="w-4 h-4" /> };
    }
  };

  // Payment handler for current user
  const handlePayNow = async () => {
    setPaymentError(null);
    setPaying(true);
    setPaymentStatus('pending');
    try {
      // Load Paystack script from CDN
      await loadPaystackScriptFromCDN();
      const currentMember = members.find(m => m.rotationPosition === currentCycle);
      if (!currentMember || !user) throw new Error('User not found');
      // @ts-ignore
      const handler = window.PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: user.email,
        amount: netPayoutAmount * 100,
        ref: `${groupId}-${currentCycle}-${user.id}-${Date.now()}`,
        metadata: {
          custom_fields: [
            { display_name: 'Group', variable_name: 'group_id', value: groupId },
            { display_name: 'Cycle', variable_name: 'cycle', value: currentCycle },
            { display_name: 'User', variable_name: 'user_id', value: user.id },
          ],
        },
        callback: async (response: any) => {
          // Call Supabase Edge Function to verify
          try {
            const verifyRes = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-payment`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reference: response.reference }),
              }
            );
            if (verifyRes.ok) {
              setPaymentStatus('success');
              toast.success('Payment successful and verified!');
            } else {
              setPaymentStatus('error');
              setPaymentError('Payment made, but verification failed.');
              toast.error('Payment verification failed.');
            }
          } catch (e) {
            setPaymentStatus('error');
            setPaymentError('Payment made, but verification failed.');
            toast.error('Payment verification failed.');
          }
          setPaying(false);
        },
        onClose: function () {
          setPaying(false);
          setPaymentStatus('idle');
        },
      });
      handler.openIframe();
    } catch (err: any) {
      setPaying(false);
      setPaymentStatus('error');
      setPaymentError('Could not start payment.');
      toast.error('Could not start payment.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No members yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout Rotation Order</CardTitle>
        <CardDescription>
          Members will receive payouts in this order (Cycle {currentCycle} of {totalCycles})
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {members.map((member) => {
            const status = getPayoutStatus(member.rotationPosition);
            const isCurrentUser = user && member.userId === user.id;
            const isCurrentCycle = member.rotationPosition === currentCycle;
            return (
              <div
                key={member.userId}
                className={`flex items-center gap-3 p-4 border rounded-lg ${
                  isCurrentCycle ? 'bg-blue-50 border-blue-200' : ''
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="font-bold text-primary">
                    {member.rotationPosition}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{member.userName}</p>
                  <p className="text-sm text-muted-foreground">
                    Cycle {member.rotationPosition} • {formatCurrency(netPayoutAmount)}
                  </p>
                </div>
                <Badge className={status.color}>
                  {status.icon}
                  <span className="ml-1">{status.label}</span>
                </Badge>
                {/* Pay Now button for current user and current cycle */}
                {isCurrentUser && isCurrentCycle && (
                  <button
                    className="ml-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
                    onClick={handlePayNow}
                    disabled={paying || paymentStatus === 'success'}
                  >
                    {paying ? 'Processing...' : paymentStatus === 'success' ? 'Paid' : 'Pay Now'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Payment status feedback for current user */}
        {paymentStatus === 'pending' && (
          <div className="mt-4 text-blue-700">Payment in progress...</div>
        )}
        {paymentStatus === 'success' && (
          <div className="mt-4 text-green-700">Payment successful and verified!</div>
        )}
        {paymentStatus === 'error' && paymentError && (
          <div className="mt-4 text-red-600">{paymentError}</div>
        )}

        {currentCycle <= totalCycles && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <TrendingUp className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-blue-900">Current Cycle: {currentCycle}</p>
                <p className="text-sm text-blue-700">
                  {members.find(m => m.rotationPosition === currentCycle)?.userName || 'Next member'}
                  {' '}will receive {formatCurrency(netPayoutAmount)} after all contributions are paid.
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
