import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getUserGroups } from '@/api';
import type { Group as ApiGroup } from '@/types';
import AvailableGroupsSection from '@/components/AvailableGroupsSection';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Shield, Plus, Users, DollarSign, Calendar, Loader2, CreditCard, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export default function GroupsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<ApiGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadGroups = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const result = await getUserGroups();
      if (result.success && result.groups) {
        setGroups(result.groups);
      } else {
        toast.error(result.error || 'Failed to load groups');
      }
    } catch (error) {
      console.error('Error loading groups:', error);
      toast.error('Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-green-600 bg-green-50';
      case 'pending':
        return 'text-yellow-600 bg-yellow-50';
      case 'completed':
        return 'text-blue-600 bg-blue-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  // Check if user needs to make payment for a group
  const needsPayment = (group: ApiGroup): boolean => {
    if (!user) return false;
    
    // Check if user is a member who hasn't paid security deposit
    const currentUserMember = group.members?.find(m => m.userId === user.id);
    if (currentUserMember && !currentUserMember.securityDepositPaid && group.status === 'forming') {
      return true;
    }
    
    // Check if user is the creator who hasn't paid
    const isCreator = group.createdBy === user.id;
    if (isCreator && !currentUserMember?.securityDepositPaid && group.status === 'forming') {
      return true;
    }
    
    return false;
  };

  const handlePaymentClick = (e: React.MouseEvent, groupId: string) => {
    e.stopPropagation(); // Prevent card click navigation
    navigate(`/groups/${groupId}#payment`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-hero flex items-center justify-center flex-shrink-0">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold truncate">My Groups</h1>
              <p className="text-sm sm:text-base text-muted-foreground truncate">
                Welcome back, {user?.fullName}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => navigate('/dashboard')} className="flex-1 sm:flex-initial">
              Dashboard
            </Button>
            <Button onClick={handleLogout} variant="outline" className="flex-1 sm:flex-initial">
              Logout
            </Button>
          </div>
        </div>

        {/* Create Group Button */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold">Your Ajo Groups</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Manage your savings groups and track contributions
            </p>
          </div>
          <Button onClick={() => navigate('/groups/create')} className="gap-2 w-full sm:w-auto">
            <Plus className="w-4 h-4" />
            <span className="sm:inline">Create New Group</span>
          </Button>
        </div>

        {/* Pending Payments Alert - Show groups requiring payment */}
        {groups.filter(needsPayment).length > 0 && (
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-6 h-6 text-orange-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-orange-900 mb-1">
                    Payment Required
                  </h3>
                  <p className="text-sm text-orange-700 mb-3">
                    You have {groups.filter(needsPayment).length} {groups.filter(needsPayment).length === 1 ? 'group' : 'groups'} waiting for payment. 
                    Complete your security deposit to activate your membership.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {groups.filter(needsPayment).map((group) => (
                      <Badge
                        key={group.id}
                        variant="outline"
                        className="cursor-pointer bg-white hover:bg-orange-100 border-orange-300"
                        onClick={() => navigate(`/groups/${group.id}`)}
                      >
                        {group.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Groups List */}
        {groups.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 sm:py-16 px-4">
              <Users className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground mb-4" />
              <h3 className="text-base sm:text-lg font-semibold mb-2">No Groups Yet</h3>
              <p className="text-xs sm:text-sm text-muted-foreground text-center mb-4 max-w-sm">
                Create or join a group to start saving together
              </p>
              <Button onClick={() => navigate('/groups/create')} className="gap-2 w-full sm:w-auto">
                <Plus className="w-4 h-4" />
                Create Your First Group
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {groups.map((group) => (
              <Card
                key={group.id}
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => navigate(`/groups/${group.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="line-clamp-1 text-base sm:text-lg">{group.name}</CardTitle>
                      <CardDescription className="line-clamp-2 mt-1 text-xs sm:text-sm">
                        {group.description}
                      </CardDescription>
                    </div>
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${getStatusColor(
                        group.status
                      )}`}
                    >
                      {group.status}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 sm:space-y-3">
                    {/* Payment Alert - Show if user needs to pay */}
                    {needsPayment(group) && (
                      <div className="mb-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-orange-900 mb-1">Payment Required</p>
                            <p className="text-xs text-orange-700 mb-2">
                              Complete your security deposit to activate membership
                            </p>
                            <Button
                              size="sm"
                              onClick={(e) => handlePaymentClick(e, group.id)}
                              className="w-full gap-2"
                            >
                              <CreditCard className="w-3 h-3" />
                              Pay Now - {formatCurrency(group.securityDepositAmount + group.contributionAmount)}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <DollarSign className="w-3 h-3 sm:w-4 sm:h-4" />
                        Contribution
                      </span>
                      <span className="font-semibold">
                        {formatCurrency(group.contributionAmount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Shield className="w-3 h-3 sm:w-4 sm:h-4" />
                        Security Deposit
                      </span>
                      <span className="font-semibold">
                        {formatCurrency(group.securityDepositAmount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Users className="w-3 h-3 sm:w-4 sm:h-4" />
                        Members
                      </span>
                      <span className="font-semibold">
                        {group.currentMembers} / {group.totalMembers}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="w-3 h-3 sm:w-4 sm:h-4" />
                        Frequency
                      </span>
                      <span className="font-semibold capitalize">
                        {group.frequency}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Available Groups to Join Section */}
        <div className="mt-8">
          <AvailableGroupsSection onJoinSuccess={loadGroups} />
        </div>
      </div>
    </div>
  );
}
