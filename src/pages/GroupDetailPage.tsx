import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { 
  getGroupById, 
  getGroupMembers, 
  joinGroup,
  getPendingJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  getUserJoinRequestStatus,
} from '@/api';
import {
  initializeGroupCreationPayment,
  initializeGroupJoinPayment,
} from '@/api/payments';
import type { Group, GroupMember } from '@/types';
import { paystackService, PaystackResponse } from '@/lib/paystack';
import ContributionsList from '@/components/ContributionsList';
import PayoutSchedule from '@/components/PayoutSchedule';
import SlotSelector from '@/components/SlotSelector';
import PaymentBreakdown from '@/components/PaymentBreakdown';
import { Button } from '@/components/ui/button';
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Shield,
  ArrowLeft,
  Users,
  DollarSign,
  Calendar,
  Loader2,
  UserPlus,
  Clock,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  UserCheck,
  UserX,
  Phone,
  User,
  CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// Constants
const DEFAULT_SLOT_POSITION = 1;

interface JoinRequest {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_phone: string | null;
  user_avatar_url: string | null;
  preferred_slot: number | null;
  message: string | null;
  created_at: string;
}

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreator, setIsCreator] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [currentUserMember, setCurrentUserMember] = useState<GroupMember | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  
  // State for join request status tracking
  const [userJoinRequest, setUserJoinRequest] = useState<any>(null);

  // Initial load effect
  useEffect(() => {
    if (id) {
      loadGroupDetails();
      loadMembers();
      loadJoinRequests();
      loadUserJoinRequestStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Handle reload parameter from payment success page
  // This ensures data is refetched after payment verification
  useEffect(() => {
    const shouldReload = searchParams.get('reload');
    if (id && shouldReload === 'true') {
      if (import.meta.env.DEV) {
        console.log('Reloading data after payment verification...');
      }
      
      // Reset payment processing state
      setIsProcessingPayment(false);
      
      // Reload all data to reflect updated membership status
      loadGroupDetails();
      loadMembers();
      loadJoinRequests();
      loadUserJoinRequestStatus();
      
      // Remove the reload parameter from URL to avoid reloading on every render
      navigate(`/groups/${id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, id]);

  const loadGroupDetails = async () => {
    if (!id) return;

    setLoading(true);
    try {
      const result = await getGroupById(id);
      if (result.success && result.group) {
        setGroup(result.group);
        setIsCreator(result.group.createdBy === user?.id);
      } else {
        toast.error(result.error || 'Failed to load group details');
        navigate('/groups');
      }
    } catch (error) {
      console.error('Error loading group:', error);
      toast.error('Failed to load group details');
      navigate('/groups');
    } finally {
      setLoading(false);
    }
  };

  const loadMembers = async () => {
    if (!id) return;

    try {
      const result = await getGroupMembers(id);
      if (result.success && result.members) {
        setMembers(result.members);
        // Find current user's membership
        const userMembership = result.members.find(m => m.userId === user?.id);
        setCurrentUserMember(userMembership || null);
      }
    } catch (error) {
      console.error('Error loading members:', error);
    }
  };

  const loadJoinRequests = async () => {
    if (!id) return;

    try {
      const result = await getPendingJoinRequests(id);
      if (result.success && result.requests) {
        setJoinRequests(result.requests);
      }
    } catch (error) {
      console.error('Error loading join requests:', error);
    }
  };

  const loadUserJoinRequestStatus = async () => {
    if (!id) return;

    try {
      const result = await getUserJoinRequestStatus(id);
      if (result.success && result.request) {
        setUserJoinRequest(result.request);
        // If user has an approved request and is not a member, show payment option
        if (result.request.status === 'approved' && !currentUserMember) {
          // User can now pay to join
        }
      }
    } catch (error) {
      console.error('Error loading user join request status:', error);
    }
  };

  const handleApproveRequest = async (requestId: string, preferredSlot: number) => {
    setProcessingRequestId(requestId);
    try {
      const result = await approveJoinRequest(requestId, preferredSlot);
      if (result.success) {
        toast.success('Join request approved! User can now pay security deposit.');
        // Reload join requests and members
        await loadJoinRequests();
        await loadMembers();
        await loadGroupDetails();
      } else {
        toast.error(result.error || 'Failed to approve request');
      }
    } catch (error) {
      console.error('Error approving request:', error);
      toast.error('Failed to approve request');
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    setProcessingRequestId(requestId);
    try {
      const result = await rejectJoinRequest(requestId, 'Request rejected by group admin');
      if (result.success) {
        toast.success('Join request rejected');
        // Reload join requests
        await loadJoinRequests();
      } else {
        toast.error(result.error || 'Failed to reject request');
      }
    } catch (error) {
      console.error('Error rejecting request:', error);
      toast.error('Failed to reject request');
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handlePaySecurityDeposit = async () => {
    // For creators: require selectedSlot, for members: require currentUserMember
    if (!group || !user || !id) return;
    
    if (isCreator && !selectedSlot) {
      toast.error('Please select a payout slot before making payment');
      return;
    }
    
    if (!isCreator && !currentUserMember) {
      toast.error('Unable to process payment. Please try again or contact support.');
      return;
    }

    setIsProcessingPayment(true);
    try {
      // Calculate total amount (security deposit + first contribution + service fee)
      const serviceFeePercentage = group.serviceFeePercentage || 2;
      const serviceFee = (group.contributionAmount * serviceFeePercentage) / 100;
      const totalAmount = group.securityDepositAmount + group.contributionAmount + serviceFee;

      // Initialize payment record based on whether user is creator or regular member
      // For joiners: pass the preferred_slot from their join request to ensure metadata consistency
      const initResult = isCreator 
        ? await initializeGroupCreationPayment(id, totalAmount, selectedSlot)
        : await initializeGroupJoinPayment(id, totalAmount, userJoinRequest?.preferred_slot);
      
      if (!initResult.success || !initResult.reference) {
        toast.error(initResult.error || 'Failed to initialize payment');
        setIsProcessingPayment(false);
        return;
      }

      // Get preferred slot for Paystack metadata: from selectedSlot for creators, from join request for joiners
      // CRITICAL: For joiners, they're not yet members, so we get the slot from their join request
      const preferredSlot = isCreator ? selectedSlot : (userJoinRequest?.preferred_slot || 1);

      // Open Paystack payment popup
      // Note: callback_url parameter is provided but doesn't work with Paystack's popup/inline flow
      // Manual navigation is handled in the onSuccess callback instead
      await paystackService.initializePayment({
        email: user.email!,
        amount: paystackService.toKobo(totalAmount), // Convert to kobo
        reference: initResult.reference,
        metadata: {
          type: isCreator ? 'group_creation' : 'group_join',
          group_id: id,
          user_id: user.id,
          preferred_slot: preferredSlot,
        },
        callback_url: `${import.meta.env.VITE_APP_URL}/payment/success?reference=${initResult.reference}&group=${id}`,
        onSuccess: (response: PaystackResponse) => {
          // Payment modal closed - redirect to verification page
          // The PaymentSuccessPage will handle verification with proper session management
          setIsProcessingPayment(false);
          if (response.status === 'success') {
            toast.info('Payment received! Redirecting to verification...', {
              duration: 3000,
            });
            // Navigate to payment success page for verification
            // Note: callback_url doesn't work with Paystack popup, must navigate manually
            navigate(`/payment/success?reference=${initResult.reference}&group=${id}`);
          } else {
            // Payment was not successful or user closed modal without completing
            toast.error('Payment was not completed. Please try again.');
          }
        },
        onClose: () => {
          // User closed payment modal without completing
          toast.info('Payment cancelled');
          setIsProcessingPayment(false);
        },
      });
    } catch (error) {
      console.error('Payment error:', error);
      toast.error('Failed to initialize payment');
      setIsProcessingPayment(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
    }).format(amount);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Not set';
    return new Date(dateString).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500';
      case 'forming':
        return 'bg-yellow-500';
      case 'pending':
        return 'bg-yellow-500';
      case 'completed':
        return 'bg-blue-500';
      case 'cancelled':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getMembershipProgress = () => {
    if (!group) return 0;
    return (group.currentMembers / group.totalMembers) * 100;
  };

  const calculateTotalPool = () => {
    if (!group) return 0;
    return group.contributionAmount * group.totalMembers;
  };

  const calculateServiceFee = () => {
    if (!group) return 0;
    const totalPool = calculateTotalPool();
    // Use the service fee percentage from the group
    const feePercentage = group.serviceFeePercentage || 2;
    return totalPool * (feePercentage / 100);
  };

  const calculateNetPayout = () => {
    const totalPool = calculateTotalPool();
    const serviceFee = calculateServiceFee();
    return totalPool - serviceFee;
  };

  const handleJoinGroup = async () => {
    if (!id) return;

    if (!selectedSlot) {
      toast.error('Please select a payout slot');
      return;
    }

    setIsJoining(true);
    try {
      const result = await joinGroup(id, selectedSlot);
      if (result.success) {
        toast.success('Join request sent! Please wait for group admin approval.');
        setShowJoinDialog(false);
        setSelectedSlot(null);
        // Reload join requests to show the new request status
        await loadJoinRequests();
      } else {
        toast.error(result.error || 'Failed to send join request');
      }
    } catch (error) {
      console.error('Error joining group:', error);
      toast.error('Failed to send join request');
    } finally {
      setIsJoining(false);
    }
  };

  const openJoinDialog = () => {
    setShowJoinDialog(true);
    setSelectedSlot(null);
  };

  // Helper function to determine if user should see join button
  const shouldShowJoinButton = () => {
    return (
      group?.status === 'forming' &&
      !currentUserMember &&
      !userJoinRequest &&
      !isCreator // Don't show join button to group creator
    );
  };

  // Helper function to check if creator needs to complete payment
  const shouldShowCreatorPaymentPrompt = () => {
    return isCreator && !currentUserMember?.securityDepositPaid && group?.status === 'forming';
  };

  // Helper function to determine if user has approved join request (for future use)
  const _hasApprovedJoinRequest = () => {
    return (
      userJoinRequest &&
      userJoinRequest.status === 'approved' &&
      !currentUserMember
    );
  };

  // Helper function to determine if user has pending join request
  const hasPendingJoinRequest = () => {
    return (
      userJoinRequest &&
      userJoinRequest.status === 'pending' &&
      !currentUserMember
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Group Not Found</h2>
          <Button onClick={() => navigate('/groups')}>Back to Groups</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/groups')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-hero flex items-center justify-center flex-shrink-0">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold truncate">{group.name}</h1>
                <Badge className={getStatusColor(group.status)}>
                  {group.status}
                </Badge>
                {isCreator && (
                  <Badge variant="outline">Creator</Badge>
                )}
              </div>
              <p className="text-muted-foreground">{group.description}</p>
            </div>
          </div>
        </div>

        {/* Status Alert - Show payment prompt for group creator who hasn't paid */}
        {shouldShowCreatorPaymentPrompt() && (
          <div className="space-y-4">
            <Alert className="bg-orange-50 border-orange-200">
              <AlertCircle className="h-4 w-4 text-orange-600" />
              <AlertDescription>
                <div>
                  <span className="text-orange-900 font-semibold">
                    Complete Your Group Setup
                  </span>
                  <p className="text-sm text-orange-700 mt-1">
                    As the group creator, select your payout position and complete your payment to activate the group.
                  </p>
                </div>
              </AlertDescription>
            </Alert>
            
            {/* Slot Selection for Creator */}
            <Card>
              <CardHeader>
                <CardTitle>Select Your Payout Position</CardTitle>
                <CardDescription>
                  Choose when you'd like to receive your payout in the rotation cycle
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SlotSelector
                  groupId={id}
                  selectedSlot={selectedSlot}
                  onSlotSelect={setSelectedSlot}
                  disabled={isProcessingPayment}
                  isCreator={isCreator}
                  totalMembers={group.totalMembers}
                />
                
                {selectedSlot && (
                  <div className="mt-4 space-y-3">
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle className="w-5 h-5 text-blue-600" />
                        <span className="text-blue-900 font-semibold">
                          Position #{selectedSlot} Selected
                        </span>
                      </div>
                      <p className="text-sm text-blue-700">
                        You will receive your payout during cycle {selectedSlot}
                      </p>
                    </div>

                    <PaymentBreakdown
                      securityDepositAmount={group.securityDepositAmount}
                      contributionAmount={group.contributionAmount}
                      formatCurrency={formatCurrency}
                    />

                    <Button
                      onClick={handlePaySecurityDeposit}
                      disabled={isProcessingPayment}
                      className="w-full"
                      size="lg"
                    >
                      {isProcessingPayment ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Processing Payment...
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-4 h-4 mr-2" />
                          Pay {formatCurrency(
                            group.securityDepositAmount + 
                            group.contributionAmount + 
                            (group.contributionAmount * (group.serviceFeePercentage || 2) / 100)
                          )} to Activate Group
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Status Alert - Show payment prompt for approved members who haven't paid */}
        {currentUserMember && !currentUserMember.securityDepositPaid && !isCreator && group?.status === 'forming' && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription>
              <div className="space-y-3">
                <div>
                  <span className="text-green-900 font-semibold">
                    ✅ Your request has been approved!
                  </span>
                  <p className="text-sm text-green-700 mt-1">
                    Complete your payment to activate your membership and secure your payout position.
                  </p>
                </div>
                
                <div className="p-3 bg-white border border-green-200 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">Your Payout Position:</span>
                    <Badge className="bg-primary text-lg">
                      #{currentUserMember.rotationPosition}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-600">
                    You will receive your payout during cycle {currentUserMember.rotationPosition}
                  </p>
                </div>

                <div className="border-green-200">
                  <PaymentBreakdown
                    securityDepositAmount={group.securityDepositAmount}
                    contributionAmount={group.contributionAmount}
                    formatCurrency={formatCurrency}
                  />
                </div>

                <Button
                  onClick={handlePaySecurityDeposit}
                  disabled={isProcessingPayment}
                  className="w-full"
                  size="lg"
                >
                  {isProcessingPayment ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing Payment...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4 mr-2" />
                      Pay {formatCurrency(
                        group.securityDepositAmount + 
                        group.contributionAmount + 
                        (group.contributionAmount * (group.serviceFeePercentage || 2) / 100)
                      )} to Join
                    </>
                  )}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Status Alert - Show join button for non-members in forming groups */}
        {shouldShowJoinButton() && (
          <Alert className="bg-blue-50 border-blue-200">
            <UserPlus className="h-4 w-4 text-blue-600" />
            <AlertDescription className="flex items-center justify-between">
              <span className="text-blue-900">
                This group is accepting new members. Join now to start saving together!
              </span>
              <Button
                onClick={openJoinDialog}
                disabled={isJoining}
                size="sm"
                className="ml-4"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Join Group
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Status Alert - Show pending request notice */}
        {hasPendingJoinRequest() && (
          <Alert className="bg-yellow-50 border-yellow-200">
            <Clock className="h-4 w-4 text-yellow-600" />
            <AlertDescription>
              <span className="text-yellow-900 font-semibold">
                Your join request is pending approval
              </span>
              <p className="text-sm text-yellow-700 mt-1">
                The group admin will review your request soon. You'll be notified once it's approved.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Join Group Dialog with Slot Selection */}
        <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
            <DialogHeader>
              <DialogTitle>Join {group.name}</DialogTitle>
              <DialogDescription>
                Select your preferred payout position. Your position determines when you'll
                receive your payout during the rotation cycle.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {id && group && (
                <SlotSelector
                  groupId={id}
                  selectedSlot={selectedSlot}
                  onSlotSelect={setSelectedSlot}
                  disabled={isJoining}
                  isCreator={false}
                  totalMembers={group.totalMembers}
                />
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowJoinDialog(false)}
                disabled={isJoining}
              >
                Cancel
              </Button>
              <Button
                onClick={handleJoinGroup}
                disabled={isJoining || !selectedSlot}
              >
                {isJoining ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Sending Request...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Request to Join
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Status Alert for members */}
        {group.status === 'forming' && currentUserMember && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This group is still forming. Invite members to join and pay security deposits to activate the group.
              {isCreator && ' Once all members have joined and paid their security deposits, you can activate the group.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Members</p>
                  <p className="text-2xl font-bold">
                    {group.currentMembers}/{group.totalMembers}
                  </p>
                </div>
                <Users className="w-8 h-8 text-muted-foreground" />
              </div>
              <Progress value={getMembershipProgress()} className="mt-2" />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Contribution</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(group.contributionAmount)}
                  </p>
                </div>
                <DollarSign className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-2 capitalize">
                {group.frequency}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Current Cycle</p>
                  <p className="text-2xl font-bold">
                    {group.currentCycle}/{group.totalCycles}
                  </p>
                </div>
                <TrendingUp className="w-8 h-8 text-muted-foreground" />
              </div>
              <Progress
                value={(group.currentCycle / group.totalCycles) * 100}
                className="mt-2"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Start Date</p>
                  <p className="text-lg font-bold">
                    {formatDate(group.startDate)}
                  </p>
                </div>
                <Calendar className="w-8 h-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="contributions">Contributions</TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Group Financial Summary</CardTitle>
                <CardDescription>
                  Overview of financial details per cycle
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-muted-foreground">Total Pool per Cycle</span>
                  <span className="text-xl font-semibold">
                    {formatCurrency(calculateTotalPool())}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b">
                  <span className="text-muted-foreground">
                    Service Fee ({group.serviceFeePercentage || 2}%)
                  </span>
                  <span className="text-xl font-semibold text-orange-600">
                    -{formatCurrency(calculateServiceFee())}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="font-semibold">Net Payout per Member</span>
                  <span className="text-2xl font-bold text-green-600">
                    {formatCurrency(calculateNetPayout())}
                  </span>
                </div>
                
                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <strong>Service Fee Model:</strong> The platform fee of {group.serviceFeePercentage || 2}% is
                    calculated as a percentage of the total pool and is deducted once per cycle
                    when the payout is disbursed. This ensures fair scaling regardless of group size.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Security Deposit</CardTitle>
                <CardDescription>
                  Required upfront payment for participation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {group.securityDepositPercentage}% of contribution
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Refunded at the end if all contributions are made on time
                    </p>
                  </div>
                  <span className="text-2xl font-bold">
                    {formatCurrency(group.securityDepositAmount)}
                  </span>
                </div>
                
                {/* Security Deposit Payment Status */}
                {currentUserMember && (
                  <div className="pt-4 border-t">
                    {currentUserMember.securityDepositPaid ? (
                      <div className="flex items-center gap-2 text-green-600">
                        <CheckCircle className="w-5 h-5" />
                        <span className="font-medium">You have paid your security deposit</span>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            You need to pay your security deposit to participate in this group.
                          </AlertDescription>
                        </Alert>
                        <Button
                          onClick={handlePaySecurityDeposit}
                          disabled={isProcessingPayment}
                          className="w-full"
                        >
                          {isProcessingPayment ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <Shield className="mr-2 h-4 w-4" />
                              Pay Security Deposit ({formatCurrency(group.securityDepositAmount)})
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Creator Information Card */}
            {(group.creatorProfileImage || group.creatorPhone) && (
              <Card>
                <CardHeader>
                  <CardTitle>Group Creator</CardTitle>
                  <CardDescription>
                    Information about the person who created this group
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <Avatar className="w-16 h-16">
                      <AvatarImage src={group.creatorProfileImage || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary text-xl">
                        <User className="w-8 h-8" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="bg-primary/5">
                          Group Admin
                        </Badge>
                      </div>
                      {group.creatorPhone && (
                        <div className="flex items-center gap-2 text-sm">
                          <Phone className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{group.creatorPhone}</span>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        Contact the admin for questions about this group
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {group.status === 'forming' && (
              <Card>
                <CardHeader>
                  <CardTitle>Next Steps</CardTitle>
                  <CardDescription>
                    What needs to happen before the group starts
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                      group.currentMembers === group.totalMembers ? 'bg-green-500' : 'bg-yellow-500'
                    }`}>
                      {group.currentMembers === group.totalMembers ? '✓' : '•'}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Fill all member positions</p>
                      <p className="text-sm text-muted-foreground">
                        {group.currentMembers}/{group.totalMembers} members joined
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center bg-gray-300">
                      •
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">All members pay security deposit</p>
                      <p className="text-sm text-muted-foreground">
                        Required before group activation
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center bg-gray-300">
                      •
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Activate the group</p>
                      <p className="text-sm text-muted-foreground">
                        Start date: {formatDate(group.startDate)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Members Tab */}
          <TabsContent value="members" className="space-y-4">
            {/* Join Requests - Only visible to group creator */}
            {isCreator && joinRequests.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Pending Join Requests</CardTitle>
                  <CardDescription>
                    Review and approve or reject join requests
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {joinRequests.map((request) => (
                      <div key={request.id} className="flex items-start gap-3 p-4 border rounded-lg bg-yellow-50 border-yellow-200">
                        {/* User Avatar */}
                        <Avatar className="w-12 h-12 flex-shrink-0">
                          <AvatarImage src={request.user_avatar_url || undefined} />
                          <AvatarFallback className="bg-yellow-100 text-yellow-700">
                            {request.user_name && request.user_name.length >= 2 
                              ? request.user_name.substring(0, 2).toUpperCase()
                              : request.user_name?.charAt(0).toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        
                        <div className="flex-1 min-w-0">
                          {/* User Info */}
                          <div className="space-y-1">
                            <p className="font-semibold text-gray-900">{request.user_name}</p>
                            <div className="flex flex-col gap-1 text-sm text-gray-600">
                              <span className="truncate">{request.user_email}</span>
                              {request.user_phone && (
                                <div className="flex items-center gap-1">
                                  <Phone className="w-3 h-3" />
                                  <span>{request.user_phone}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {/* Requested Slot */}
                          {request.preferred_slot && (
                            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-white border border-yellow-300 rounded-md">
                              <span className="text-sm font-medium text-yellow-800">
                                Requested Position:
                              </span>
                              <Badge className="bg-yellow-600">
                                #{request.preferred_slot}
                              </Badge>
                            </div>
                          )}
                          
                          {/* Message */}
                          {request.message && (
                            <div className="mt-2 p-2 bg-white border border-yellow-200 rounded text-sm text-gray-700 italic">
                              "{request.message}"
                            </div>
                          )}
                        </div>
                        
                        {/* Action Buttons */}
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handleApproveRequest(request.id, request.preferred_slot || DEFAULT_SLOT_POSITION)}
                            disabled={processingRequestId === request.id}
                            className="whitespace-nowrap"
                          >
                            {processingRequestId === request.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <UserCheck className="w-4 h-4 mr-1" />
                                Accept
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleRejectRequest(request.id)}
                            disabled={processingRequestId === request.id}
                            className="whitespace-nowrap"
                          >
                            {processingRequestId === request.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <UserX className="w-4 h-4 mr-1" />
                                Reject
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Group Members</CardTitle>
                    <CardDescription>
                      {group.currentMembers} of {group.totalMembers} positions filled
                    </CardDescription>
                  </div>
                  {isCreator && group.status === 'forming' && (
                    <Button size="sm" className="gap-2">
                      <UserPlus className="w-4 h-4" />
                      Invite Members
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {members.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No members yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {members.map((member) => (
                      <div key={member.userId} className="flex items-center gap-3 p-3 border rounded-lg">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="font-semibold text-primary">
                            {member.rotationPosition}
                          </span>
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">{member.userName}</p>
                          <p className="text-sm text-muted-foreground">
                            Position {member.rotationPosition}
                            {member.userId === group.createdBy && ' • Creator'}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={member.status === 'active' ? 'default' : 'outline'}>
                            {member.status}
                          </Badge>
                          {member.securityDepositPaid ? (
                            <div className="flex items-center gap-1 text-xs text-green-600">
                              <CheckCircle className="w-3 h-3" />
                              <span>Deposit Paid</span>
                            </div>
                          ) : (
                            <span className="text-xs text-orange-600">Deposit Pending</span>
                          )}
                        </div>
                      </div>
                    ))}
                    
                    {/* Empty slots */}
                    {Array.from({ length: group.totalMembers - members.length }).map((_, i) => (
                      <div key={`empty-${i}`} className="flex items-center gap-3 p-3 border border-dashed rounded-lg opacity-50">
                        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                          <span className="font-semibold text-gray-400">
                            {members.length + i + 1}
                          </span>
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-muted-foreground">Empty Slot</p>
                          <p className="text-sm text-muted-foreground">
                            Position {members.length + i + 1}
                          </p>
                        </div>
                        <Badge variant="outline">Available</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contributions Tab */}
          <TabsContent value="contributions" className="space-y-4">
            {group.status === 'forming' ? (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center">
                    <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">
                      Contributions will start once the group is activated
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <ContributionsList
                groupId={group.id}
                groupName={group.name}
                contributionAmount={group.contributionAmount}
              />
            )}
          </TabsContent>

          {/* Payouts Tab */}
          <TabsContent value="payouts" className="space-y-4">
            {group.status === 'forming' ? (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center">
                    <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">
                      Payout schedule will be available once the group is activated
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <PayoutSchedule
                groupId={group.id}
                currentCycle={group.currentCycle}
                totalCycles={group.totalCycles}
                netPayoutAmount={calculateNetPayout()}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
