/**
 * Payout Schedule Component
 * 
 * Displays the rotation order and payout status for group members
 */

import { useState, useEffect } from 'react';
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

export default function PayoutSchedule({
  groupId,
  currentCycle,
  totalCycles,
  netPayoutAmount,
}: PayoutScheduleProps) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);

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

  const getPayoutStatus = (position: number) => {
    if (position < currentCycle) {
      return { label: 'Completed', color: 'bg-green-500', icon: <CheckCircle className="w-4 h-4" /> };
    } else if (position === currentCycle) {
      return { label: 'Current', color: 'bg-blue-500', icon: <TrendingUp className="w-4 h-4" /> };
    } else {
      return { label: 'Upcoming', color: 'bg-gray-500', icon: <Clock className="w-4 h-4" /> };
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
            return (
              <div
                key={member.userId}
                className={`flex items-center gap-3 p-4 border rounded-lg ${
                  member.rotationPosition === currentCycle ? 'bg-blue-50 border-blue-200' : ''
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
              </div>
            );
          })}
        </div>
        
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
