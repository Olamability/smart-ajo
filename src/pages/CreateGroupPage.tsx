import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { createGroup } from '@/api';
import { DEFAULT_SERVICE_FEE_PERCENTAGE } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ArrowLeft, Loader2, Shield, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';

const createGroupSchema = z.object({
  name: z.string().min(3, 'Group name must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  contributionAmount: z.number().min(1000, 'Minimum contribution is ₦1,000'),
  frequency: z.enum(['daily', 'weekly', 'monthly'], {
    required_error: 'Please select a frequency',
  }),
  totalMembers: z.number().min(2, 'Minimum 2 members').max(50, 'Maximum 50 members'),
  securityDepositPercentage: z.number().min(0, 'Security deposit percentage cannot be negative').max(100, 'Maximum 100%'),
  startDate: z.string().min(1, 'Start date is required'),
});

type CreateGroupForm = z.infer<typeof createGroupSchema>;

export default function CreateGroupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [frequency, setFrequency] = useState<string>('');

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateGroupForm>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: {
      securityDepositPercentage: 20, // Default 20%
      startDate: new Date().toISOString().split('T')[0],
    },
  });

  const contributionAmount = watch('contributionAmount');
  const totalMembers = watch('totalMembers');
  const securityDepositPercentage = watch('securityDepositPercentage');

  // Calculate security deposit amount from percentage
  const securityDepositAmount = contributionAmount && securityDepositPercentage
    ? Math.round((contributionAmount * securityDepositPercentage) / 100)
    : 0;

  // Calculate total pool per cycle
  const totalPool = contributionAmount && totalMembers 
    ? contributionAmount * totalMembers 
    : 0;

  // Calculate service fee (percentage-based, default from constants)
  const serviceFeePercentage = DEFAULT_SERVICE_FEE_PERCENTAGE; // Using same constant as API layer
  const serviceFee = totalPool ? Math.round(totalPool * (serviceFeePercentage / 100)) : 0;

  // Calculate net payout per member
  const netPayout = totalPool ? totalPool - serviceFee : 0;

  const onSubmit = async (data: CreateGroupForm) => {
    if (!user) {
      toast.error('You must be logged in to create a group');
      return;
    }

    setIsLoading(true);
    try {
      const result = await createGroup({
        name: data.name,
        description: data.description,
        contributionAmount: data.contributionAmount,
        frequency: data.frequency,
        totalMembers: data.totalMembers,
        securityDepositPercentage: data.securityDepositPercentage,
        startDate: data.startDate,
      });

      if (result.success && result.group) {
        toast.success('Group created successfully! You are now the admin. Please make your security deposit payment to activate the group.');
        // Navigate to the group detail page where creator can make payment
        navigate(`/groups/${result.group.id}`);
      } else {
        toast.error(result.error || 'Failed to create group');
      }
    } catch (error) {
      console.error('Error creating group:', error);
      toast.error('Failed to create group');
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/groups')}
            disabled={isLoading}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-hero flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Create New Group</h1>
              <p className="text-muted-foreground">
                Set up your Ajo savings group
              </p>
            </div>
          </div>
        </div>

        {/* Info Alert */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>How it works:</strong> Members contribute regularly to a shared pool. 
            Each cycle, one member receives the full payout (minus 2% service fee). 
            Security deposits ensure commitment.
          </AlertDescription>
        </Alert>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Group Details</CardTitle>
              <CardDescription>
                Basic information about your group
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Group Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Friends Savings Circle"
                  {...register('name')}
                  disabled={isLoading}
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  placeholder="Describe the purpose and goals of this group..."
                  rows={3}
                  {...register('description')}
                  disabled={isLoading}
                />
                {errors.description && (
                  <p className="text-sm text-destructive">
                    {errors.description.message}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contribution Settings</CardTitle>
              <CardDescription>
                Define how much and how often members contribute
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contributionAmount">
                    Contribution Amount (₦) *
                  </Label>
                  <Input
                    id="contributionAmount"
                    type="number"
                    placeholder="5000"
                    {...register('contributionAmount', { valueAsNumber: true })}
                    disabled={isLoading}
                  />
                  {errors.contributionAmount && (
                    <p className="text-sm text-destructive">
                      {errors.contributionAmount.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="frequency">Frequency *</Label>
                  <Select
                    value={frequency}
                    onValueChange={(value) => {
                      setFrequency(value);
                      setValue('frequency', value as 'daily' | 'weekly' | 'monthly');
                    }}
                    disabled={isLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.frequency && (
                    <p className="text-sm text-destructive">
                      {errors.frequency.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="totalMembers">Total Members *</Label>
                <Input
                  id="totalMembers"
                  type="number"
                  placeholder="5"
                  {...register('totalMembers', { valueAsNumber: true })}
                  disabled={isLoading}
                />
                {errors.totalMembers && (
                  <p className="text-sm text-destructive">
                    {errors.totalMembers.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Total number of members in the group (including you)
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>
                Ensure commitment with a security deposit
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="securityDepositPercentage">
                  Security Deposit (% of Contribution) *
                </Label>
                <Input
                  id="securityDepositPercentage"
                  type="number"
                  placeholder="20"
                  {...register('securityDepositPercentage', { valueAsNumber: true })}
                  disabled={isLoading}
                />
                {errors.securityDepositPercentage && (
                  <p className="text-sm text-destructive">
                    {errors.securityDepositPercentage.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Amount: {formatCurrency(securityDepositAmount)} ({securityDepositPercentage || 0}% of contribution)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date *</Label>
                <Input
                  id="startDate"
                  type="date"
                  {...register('startDate')}
                  disabled={isLoading}
                />
                {errors.startDate && (
                  <p className="text-sm text-destructive">
                    {errors.startDate.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Date when the first contribution cycle begins
                </p>
              </div>

              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Security deposits are refunded at the end of the cycle if all 
                  contributions are made on time. Late or missed payments result 
                  in penalties deducted from the deposit.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Summary Card */}
          {totalPool > 0 && (
            <Card className="bg-primary/5">
              <CardHeader>
                <CardTitle>Group Summary</CardTitle>
                <CardDescription>
                  Overview of your group's finances per cycle
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Pool:</span>
                  <span className="font-semibold">{formatCurrency(totalPool)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Service Fee ({serviceFeePercentage}%):
                  </span>
                  <span className="font-semibold text-orange-600">
                    -{formatCurrency(serviceFee)}
                  </span>
                </div>
                <div className="flex justify-between text-lg border-t pt-2">
                  <span className="font-semibold">Net Payout:</span>
                  <span className="font-bold text-green-600">
                    {formatCurrency(netPayout)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground pt-2">
                  Each member will receive {formatCurrency(netPayout)} when it's their 
                  turn in the rotation.
                </p>
                <Alert className="mt-3">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <strong>Service Fee:</strong> The {serviceFeePercentage}% platform fee
                    is deducted once per cycle from the total pool when payouts are made.
                    This scales fairly with group size and ensures sustainable operations.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex gap-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => navigate('/groups')}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Group'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
