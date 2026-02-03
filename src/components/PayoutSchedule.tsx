/**
 * PayoutSchedule Component
 * 
 * Displays the payout schedule for a group showing when each member
 * will receive their payout based on their slot position.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, TrendingUp, CheckCircle, Clock, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, addMonths, addWeeks, addYears } from 'date-fns';

export interface PayoutSlot {
  position: number;
  userName?: string;
  userId?: string;
  payoutDate: Date;
  isPaid?: boolean;
  isCurrentUser?: boolean;
}

interface PayoutScheduleProps {
  frequency: 'weekly' | 'monthly' | 'yearly';
  startDate: Date;
  totalSlots: number;
  occupiedSlots?: PayoutSlot[];
  contributionAmount: number;
  serviceFeePercentage: number;
  currentUserId?: string;
  className?: string;
}

export default function PayoutSchedule({
  frequency,
  startDate,
  totalSlots,
  occupiedSlots = [],
  contributionAmount,
  serviceFeePercentage,
  currentUserId,
  className,
}: PayoutScheduleProps) {
  // Calculate payout amount (total contributions minus service fee)
  const totalContributions = contributionAmount * totalSlots;
  const serviceFee = (totalContributions * serviceFeePercentage) / 100;
  const payoutAmount = totalContributions - serviceFee;

  // Generate payout dates for all slots
  const generatePayoutDate = (position: number): Date => {
    const start = new Date(startDate);
    const periodsToAdd = position - 1;

    switch (frequency) {
      case 'weekly':
        return addWeeks(start, periodsToAdd);
      case 'monthly':
        return addMonths(start, periodsToAdd);
      case 'yearly':
        return addYears(start, periodsToAdd);
      default:
        return start;
    }
  };

  // Build complete schedule
  const schedule: PayoutSlot[] = [];
  for (let i = 1; i <= totalSlots; i++) {
    const existingSlot = occupiedSlots.find((s) => s.position === i);
    const payoutDate = generatePayoutDate(i);
    
    schedule.push({
      position: i,
      userName: existingSlot?.userName,
      userId: existingSlot?.userId,
      payoutDate,
      isPaid: existingSlot?.isPaid || false,
      isCurrentUser: existingSlot?.userId === currentUserId,
    });
  }

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Get frequency label
  const getFrequencyLabel = () => {
    switch (frequency) {
      case 'weekly':
        return 'week';
      case 'monthly':
        return 'month';
      case 'yearly':
        return 'year';
      default:
        return 'period';
    }
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Payout Schedule
        </CardTitle>
        <CardDescription>
          {frequency.charAt(0).toUpperCase() + frequency.slice(1)} rotation schedule - {formatCurrency(payoutAmount)} per payout
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {schedule.map((slot) => {
            const today = new Date();
            const isPast = slot.payoutDate < today;
            const isUpcoming = !isPast && !slot.isPaid;

            return (
              <div
                key={slot.position}
                className={cn(
                  'p-4 rounded-lg border-2 transition-all',
                  slot.isCurrentUser
                    ? 'border-primary bg-primary/5'
                    : slot.isPaid
                    ? 'border-green-200 bg-green-50'
                    : slot.userName
                    ? 'border-gray-200 bg-gray-50'
                    : 'border-dashed border-gray-300'
                )}
              >
                <div className="flex items-start justify-between">
                  {/* Left side - Position and user info */}
                  <div className="flex items-start gap-3">
                    {/* Position number */}
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary font-bold">
                      {slot.position}
                    </div>

                    {/* User and date info */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {slot.userName ? (
                          <>
                            <User className="h-4 w-4 text-gray-500" />
                            <span className="font-medium">
                              {slot.userName}
                              {slot.isCurrentUser && ' (You)'}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground italic">
                            Position available
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {format(slot.payoutDate, 'MMM dd, yyyy')}
                        </span>
                        {isUpcoming && (
                          <Badge variant="outline" className="ml-1">
                            <Clock className="h-3 w-3 mr-1" />
                            Upcoming
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <TrendingUp className="h-3 w-3 text-green-600" />
                        <span className="font-semibold text-green-600">
                          {formatCurrency(payoutAmount)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right side - Status badge */}
                  <div>
                    {slot.isPaid ? (
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Paid
                      </Badge>
                    ) : slot.userName ? (
                      <Badge variant="secondary">
                        Reserved
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Open
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary footer */}
        <div className="mt-6 pt-4 border-t space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total Positions:</span>
            <span className="font-medium">{totalSlots}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Occupied Positions:</span>
            <span className="font-medium">
              {occupiedSlots.filter((s) => s.userName).length}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Payout Frequency:</span>
            <span className="font-medium capitalize">
              Every {getFrequencyLabel()}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Payout Amount:</span>
            <span className="font-semibold text-primary">
              {formatCurrency(payoutAmount)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
