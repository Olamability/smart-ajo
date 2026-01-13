import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { createGroup, deleteGroup } from '@/api';
import { 
  initializeGroupCreationPayment, 
  verifyPayment, 
  processGroupCreationPayment,
  pollPaymentStatus,
} from '@/api/payments';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ArrowLeft, Loader2, Shield, Info, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import SlotSelector from '@/components/SlotSelector';
import { paystackService, PaystackResponse } from '@/lib/paystack';

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
  
  // Payment and slot selection state
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [createdGroup, setCreatedGroup] = useState<any>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const paymentCallbackExecutedRef = useRef(false); // Persists across renders to prevent race condition between callback and onClose

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
        // Store the created group and show payment dialog
        setCreatedGroup(result.group);
        setShowPaymentDialog(true);
        toast.success('Group created! Please complete payment to become the admin.');
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

  // Helper function to cleanup (delete) the group if payment fails or is cancelled
  const handleGroupCleanup = async (groupId: string, reason: string) => {
    try {
      const result = await deleteGroup(groupId);
      if (result.success) {
        console.log(`Group ${groupId} deleted due to: ${reason}`);
      } else {
        console.error(`Failed to delete group ${groupId}:`, result.error);
      }
    } catch (error) {
      console.error('Error during group cleanup:', error);
    }
  };

  const handlePayment = async () => {
    if (!createdGroup || !user || !selectedSlot) {
      if (!selectedSlot) {
        toast.error('Please select a payout slot');
      }
      return;
    }

    setIsProcessingPayment(true);
    paymentCallbackExecutedRef.current = false; // Reset callback flag for new payment attempt
    try {
      // Calculate total amount (security deposit + first contribution)
      const totalAmount = createdGroup.securityDepositAmount + createdGroup.contributionAmount;

      // Initialize payment record
      const initResult = await initializeGroupCreationPayment(createdGroup.id, totalAmount);
      
      if (!initResult.success || !initResult.reference) {
        toast.error(initResult.error || 'Failed to initialize payment');
        setIsProcessingPayment(false);
        // Delete group since payment initialization failed
        await handleGroupCleanup(createdGroup.id, 'Payment initialization failed');
        setShowPaymentDialog(false);
        navigate('/groups');
        return;
      }

      // Open Paystack payment popup
      await paystackService.initializePayment({
        email: user.email!,
        amount: totalAmount * 100, // Convert to kobo
        reference: initResult.reference,
        metadata: {
          type: 'group_creation',
          group_id: createdGroup.id,
          user_id: user.id,
          preferred_slot: selectedSlot,
        },
        callback_url: `${import.meta.env.VITE_APP_URL}/payment/success?reference=${initResult.reference}&group=${createdGroup.id}`,
        callback: async (response: PaystackResponse) => {
          try {
            paymentCallbackExecutedRef.current = true; // Mark callback as executed
            // Payment successful, verify on backend
            if (response.status === 'success') {
              toast.info('Payment received! Verifying with backend...', {
                duration: 5000,
              });
              
              // Verify payment with backend (with retry logic)
              const verifyResult = await verifyPayment(response.reference);
              
              console.log('Verification result:', verifyResult);
              
              if (verifyResult.verified) {
                toast.success('Payment verified! Processing your membership...');
                
                // Process payment and add creator as member with selected slot
                const processResult = await processGroupCreationPayment(
                  response.reference,
                  createdGroup.id,
                  selectedSlot
                );
                
                if (processResult.success) {
                  toast.success('Payment verified! You are now the group admin.');
                  setShowPaymentDialog(false);
                  // Navigate to group detail page
                  navigate(`/groups/${createdGroup.id}`);
                } else {
                  console.error('Payment processing failed after verification:', processResult.error);
                  toast.error(
                    `Failed to complete membership setup: ${processResult.error}. Please contact support with reference: ${response.reference}`,
                    { duration: 10000 }
                  );
                  // CRITICAL FIX: Delete group since membership couldn't be established
                  // Even though payment was verified, the group has no members
                  // User can retry the entire flow with a new group
                  console.log('Cleaning up group due to processing failure');
                  await handleGroupCleanup(createdGroup.id, 'Payment processing failed after verification');
                  setShowPaymentDialog(false);
                  navigate('/groups');
                }
              } else {
                console.error('Payment verification failed:', verifyResult);
                
                // Try fallback: poll payment status from database
                // This handles cases where Edge Function fails but webhook might have processed it
                toast.info('Verification failed. Checking payment status...', {
                  duration: 5000,
                });
                
                const pollResult = await pollPaymentStatus(response.reference);
                
                if (pollResult.verified) {
                  console.log('Payment verified via polling fallback');
                  toast.success('Payment verified! Processing your membership...');
                  
                  // Process payment and add creator as member with selected slot
                  const processResult = await processGroupCreationPayment(
                    response.reference,
                    createdGroup.id,
                    selectedSlot
                  );
                  
                  if (processResult.success) {
                    toast.success('Payment verified! You are now the group admin.');
                    setShowPaymentDialog(false);
                    navigate(`/groups/${createdGroup.id}`);
                  } else {
                    console.error('Payment processing failed after verification:', processResult.error);
                    toast.error(
                      `Failed to complete membership setup: ${processResult.error}. Please contact support with reference: ${response.reference}`,
                      { duration: 10000 }
                    );
                    // Delete group since membership couldn't be established
                    await handleGroupCleanup(createdGroup.id, 'Payment processing failed after verification');
                    setShowPaymentDialog(false);
                    navigate('/groups');
                  }
                } else {
                  // Both verification and polling failed
                  // Provide detailed error message based on verification result
                  let errorMessage = 'Payment verification failed.';
                  if (verifyResult.payment_status === 'verification_failed') {
                    errorMessage = 'Unable to verify payment with Paystack. Please contact support with reference: ' + response.reference;
                  } else if (verifyResult.payment_status === 'failed') {
                    errorMessage = 'Payment was declined by your bank. Please try again.';
                  } else if (verifyResult.error) {
                    errorMessage = `Verification error: ${verifyResult.error}. Reference: ${response.reference}`;
                  } else {
                    errorMessage = `Payment status: ${verifyResult.payment_status}. Please contact support with reference: ${response.reference}`;
                  }
                  
                  toast.error(errorMessage, { duration: 10000 });
                  
                  // CRITICAL FIX: Delete the group to prevent orphaned groups in the database
                  // If payment was successful but verification failed, user can retry
                  // This prevents groups with 0 members from accumulating in the system
                  console.log('Cleaning up group due to verification failure');
                  await handleGroupCleanup(createdGroup.id, 'Payment verification failed after all retries');
                  setShowPaymentDialog(false);
                  navigate('/groups');
                }
              }
            } else {
              toast.error('Payment was not successful');
              // Delete group since payment was not successful
              await handleGroupCleanup(createdGroup.id, 'Payment not successful');
              setShowPaymentDialog(false);
              navigate('/groups');
            }
          } catch (error) {
            console.error('Error in payment callback:', error);
            toast.error(
              'An error occurred while processing your payment. Please contact support with reference: ' + response.reference,
              { duration: 10000 }
            );
            // CRITICAL FIX: Delete group when payment callback fails
            // This prevents orphaned groups from accumulating in the system
            // User can retry with a new group creation
            console.log('Cleaning up group due to payment callback error');
            await handleGroupCleanup(createdGroup.id, 'Payment callback error');
            setShowPaymentDialog(false);
            navigate('/groups');
          } finally {
            setIsProcessingPayment(false);
          }
        },
        onClose: () => {
          // Only clean up if payment callback hasn't been executed
          // This prevents deleting group if user closes popup after successful payment
          if (!paymentCallbackExecutedRef.current) {
            toast.info('Payment cancelled');
            setIsProcessingPayment(false);
            // Delete group since payment was cancelled by user
            handleGroupCleanup(createdGroup.id, 'Payment cancelled by user');
            setShowPaymentDialog(false);
            navigate('/groups');
          } else {
            // Callback was executed, so just close the dialog
            console.log('Payment callback already executed, not cleaning up group');
            setIsProcessingPayment(false);
          }
        },
      });
    } catch (error) {
      console.error('Payment error:', error);
      toast.error('Failed to initialize payment');
      setIsProcessingPayment(false);
      // Delete group since there was an error
      if (createdGroup) {
        await handleGroupCleanup(createdGroup.id, 'Payment error');
        setShowPaymentDialog(false);
        navigate('/groups');
      }
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

        {/* Payment Dialog */}
        <Dialog open={showPaymentDialog} onOpenChange={(open) => {
          if (!open && !isProcessingPayment && createdGroup) {
            setShowPaymentDialog(false);
            // If user closes dialog without paying, delete group and navigate back
            handleGroupCleanup(createdGroup.id, 'User closed payment dialog')
              .then(() => navigate('/groups'))
              .catch((error) => {
                console.error('Error during cleanup:', error);
                navigate('/groups');
              });
          }
        }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
            <DialogHeader>
              <DialogTitle>Complete Your Payment</DialogTitle>
              <DialogDescription>
                Select your preferred payout position and pay the security deposit 
                + first contribution to become the group admin.
              </DialogDescription>
            </DialogHeader>

            {createdGroup && (
              <div className="space-y-6">
                {/* Payment Summary */}
                <Card className="bg-primary/5">
                  <CardHeader>
                    <CardTitle className="text-lg">Payment Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Security Deposit:</span>
                      <span className="font-semibold">
                        {formatCurrency(createdGroup.securityDepositAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">First Contribution:</span>
                      <span className="font-semibold">
                        {formatCurrency(createdGroup.contributionAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-lg border-t pt-2 mt-2">
                      <span className="font-semibold">Total Amount:</span>
                      <span className="font-bold text-green-600">
                        {formatCurrency(
                          createdGroup.securityDepositAmount + createdGroup.contributionAmount
                        )}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Slot Selection */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">Select Your Payout Position</h3>
                  <SlotSelector
                    groupId={createdGroup.id}
                    selectedSlot={selectedSlot}
                    onSlotSelect={setSelectedSlot}
                    disabled={isProcessingPayment}
                  />
                </div>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Important:</strong> Your selected position determines when you'll 
                    receive your payout during the rotation cycle. Position 1 receives payout 
                    in the first cycle, position 2 in the second cycle, and so on.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  if (!isProcessingPayment && createdGroup) {
                    setShowPaymentDialog(false);
                    // Delete group since user cancelled
                    handleGroupCleanup(createdGroup.id, 'User cancelled payment dialog')
                      .then(() => navigate('/groups'))
                      .catch((error) => {
                        console.error('Error during cleanup:', error);
                        navigate('/groups');
                      });
                  }
                }}
                disabled={isProcessingPayment}
              >
                Cancel
              </Button>
              <Button
                onClick={handlePayment}
                disabled={isProcessingPayment || !selectedSlot}
              >
                {isProcessingPayment ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Pay {createdGroup && formatCurrency(
                      createdGroup.securityDepositAmount + createdGroup.contributionAmount
                    )}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
