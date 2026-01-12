/**
 * Slot Selector Component
 * 
 * Displays available payout slots for a group and allows users to select their preferred slot
 * Shows which slots are available, reserved, or already assigned
 */

import { useState, useEffect } from 'react';
import { getAvailableSlots } from '@/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Calendar, 
  CheckCircle, 
  Clock, 
  Lock, 
  Loader2,
  Info,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';

interface SlotSelectorProps {
  groupId: string;
  selectedSlot: number | null;
  onSlotSelect: (slotNumber: number) => void;
  disabled?: boolean;
}

export default function SlotSelector({
  groupId,
  selectedSlot,
  onSlotSelect,
  disabled = false,
}: SlotSelectorProps) {
  const [slots, setSlots] = useState<
    { slot_number: number; payout_cycle: number; status: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const loadSlots = async () => {
    setLoading(true);
    try {
      const result = await getAvailableSlots(groupId);
      if (result.success && result.slots) {
        setSlots(result.slots);
      } else {
        toast.error(result.error || 'Failed to load available slots');
      }
    } catch (error) {
      console.error('Error loading slots:', error);
      toast.error('Failed to load available slots');
    } finally {
      setLoading(false);
    }
  };

  const getSlotIcon = (status: string, isSelected: boolean) => {
    if (isSelected) {
      return <CheckCircle className="w-4 h-4" />;
    }
    
    switch (status) {
      case 'available':
        return <Calendar className="w-4 h-4" />;
      case 'reserved':
        return <Clock className="w-4 h-4" />;
      case 'assigned':
        return <Lock className="w-4 h-4" />;
      default:
        return <Calendar className="w-4 h-4" />;
    }
  };

  const getSlotBadge = (status: string, isSelected: boolean) => {
    if (isSelected) {
      return <Badge className="bg-blue-500">Selected</Badge>;
    }
    
    switch (status) {
      case 'available':
        return <Badge className="bg-green-500">Available</Badge>;
      case 'reserved':
        return <Badge className="bg-yellow-500">Reserved</Badge>;
      case 'assigned':
        return <Badge className="bg-gray-500">Taken</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  };

  if (loading) {
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

  if (slots.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          No slots available for this group yet.
        </AlertDescription>
      </Alert>
    );
  }

  const availableCount = slots.filter(s => s.status === 'available').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Select Your Payout Position</CardTitle>
        <CardDescription>
          Choose when you'd like to receive your payout. {availableCount} slot
          {availableCount !== 1 ? 's' : ''} available.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert className="mb-4">
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>Important:</strong> Your slot determines when you receive your payout.
            Slot 1 receives payout in the first cycle, Slot 2 in the second cycle, and so on.
            Once assigned, your slot cannot be changed.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {slots.map((slot) => {
            const isSelected = selectedSlot === slot.slot_number;
            const isAvailable = slot.status === 'available';
            const canSelect = !disabled && isAvailable;

            return (
              <Button
                key={slot.slot_number}
                variant={isSelected ? 'default' : 'outline'}
                className={`h-24 flex flex-col gap-2 ${
                  !canSelect && !isSelected ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                onClick={() => {
                  if (canSelect) {
                    onSlotSelect(slot.slot_number);
                  }
                }}
                disabled={!canSelect && !isSelected}
              >
                <div className="flex items-center gap-2">
                  {getSlotIcon(slot.status, isSelected)}
                  <span className="text-lg font-bold">#{slot.slot_number}</span>
                </div>
                <div className="text-xs">
                  Cycle {slot.payout_cycle}
                </div>
                {getSlotBadge(slot.status, isSelected)}
              </Button>
            );
          })}
        </div>

        {selectedSlot && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm font-medium text-blue-900">
              You selected Slot #{selectedSlot}
            </p>
            <p className="text-xs text-blue-700 mt-1">
              You will receive your payout in Cycle {selectedSlot}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
