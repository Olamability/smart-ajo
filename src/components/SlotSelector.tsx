/**
 * SlotSelector Component
 * 
 * Allows users to select their preferred payout slot/position in an Ajo group.
 * Shows available slots and indicates which are already taken.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, X, Calendar, User } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Slot {
  position: number;
  isAvailable: boolean;
  userName?: string;
  payoutDate?: string;
}

interface SlotSelectorProps {
  totalSlots: number;
  availableSlots: Slot[];
  selectedSlot: number | null;
  onSlotSelect: (slotNumber: number) => void;
  disabled?: boolean;
  className?: string;
}

export default function SlotSelector({
  totalSlots,
  availableSlots,
  selectedSlot,
  onSlotSelect,
  disabled = false,
  className,
}: SlotSelectorProps) {
  const [slots, setSlots] = useState<Slot[]>([]);

  useEffect(() => {
    // Initialize slots array
    const slotsArray: Slot[] = [];
    for (let i = 1; i <= totalSlots; i++) {
      const existingSlot = availableSlots.find((s) => s.position === i);
      if (existingSlot) {
        slotsArray.push(existingSlot);
      } else {
        slotsArray.push({
          position: i,
          isAvailable: true,
        });
      }
    }
    setSlots(slotsArray);
  }, [totalSlots, availableSlots]);

  const handleSlotClick = (slot: Slot) => {
    if (!disabled && slot.isAvailable) {
      onSlotSelect(slot.position);
    }
  };

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Select Your Payout Position
        </CardTitle>
        <CardDescription>
          Choose when you want to receive your payout. Lower numbers receive payouts earlier.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {slots.map((slot) => (
            <button
              key={slot.position}
              onClick={() => handleSlotClick(slot)}
              disabled={disabled || !slot.isAvailable}
              className={cn(
                'relative p-4 rounded-lg border-2 transition-all duration-200',
                'flex flex-col items-center justify-center gap-2',
                'hover:shadow-md disabled:cursor-not-allowed',
                slot.isAvailable
                  ? selectedSlot === slot.position
                    ? 'border-primary bg-primary/10 shadow-md'
                    : 'border-gray-200 hover:border-primary/50 hover:bg-gray-50'
                  : 'border-gray-200 bg-gray-100 opacity-60'
              )}
            >
              {/* Slot number */}
              <div className="flex items-center gap-2">
                {selectedSlot === slot.position && slot.isAvailable && (
                  <Check className="h-4 w-4 text-primary" />
                )}
                <span className="text-2xl font-bold">
                  {slot.position}
                </span>
                {!slot.isAvailable && (
                  <X className="h-4 w-4 text-gray-400" />
                )}
              </div>

              {/* Status badge */}
              <Badge
                variant={slot.isAvailable ? 'outline' : 'secondary'}
                className={cn(
                  'text-xs',
                  slot.isAvailable
                    ? selectedSlot === slot.position
                      ? 'bg-primary text-primary-foreground'
                      : ''
                    : 'bg-gray-200 text-gray-600'
                )}
              >
                {slot.isAvailable ? 'Available' : 'Taken'}
              </Badge>

              {/* User info if taken */}
              {!slot.isAvailable && slot.userName && (
                <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                  <User className="h-3 w-3" />
                  <span className="truncate max-w-[80px]">
                    {slot.userName}
                  </span>
                </div>
              )}

              {/* Payout date if available */}
              {slot.payoutDate && (
                <div className="text-xs text-gray-500 mt-1">
                  {new Date(slot.payoutDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Selected slot info */}
        {selectedSlot && (
          <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <p className="text-sm font-medium text-primary">
              You selected Position #{selectedSlot}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              You will receive your payout in cycle {selectedSlot} (position {selectedSlot} of {totalSlots})
            </p>
          </div>
        )}

        {/* Available slots count */}
        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {slots.filter((s) => s.isAvailable).length}
            </span>{' '}
            of {totalSlots} positions available
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
