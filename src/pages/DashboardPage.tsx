import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserStats, getUserGroups, getUserTransactions } from '@/api';
import type { UserStats } from '@/api/stats';
import type { Group, Transaction } from '@/types';
import NotificationCenter from '@/components/NotificationCenter';
import AvailableGroupsSection from '@/components/AvailableGroupsSection';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { 
  Shield, 
  Loader2, 
  Users, 
  DollarSign, 
  TrendingUp, 
  AlertCircle,
  CheckCircle,
  Clock,
  Plus,
  User as UserIcon,
  Building2,
  Mail,
  Phone,
  Edit,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [recentGroups, setRecentGroups] = useState<Group[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (user) {
      loadDashboardData();
    }
  }, [user]);

  const loadDashboardData = async () => {
    setLoadingData(true);
    try {
      // Load stats
      const statsResult = await getUserStats();
      if (statsResult.success && statsResult.stats) {
        setStats(statsResult.stats);
      }

      // Load recent groups (limit 3)
      const groupsResult = await getUserGroups();
      if (groupsResult.success && groupsResult.groups) {
        setRecentGroups(groupsResult.groups.slice(0, 3));
      }

      // Load recent transactions (limit 5)
      const transactionsResult = await getUserTransactions();
      if (transactionsResult.success && transactionsResult.transactions) {
        setRecentTransactions(transactionsResult.transactions.slice(0, 5));
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoadingData(false);
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

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'contribution':
      case 'security_deposit':
        return <DollarSign className="w-4 h-4" />;
      case 'payout':
        return <TrendingUp className="w-4 h-4" />;
      default:
        return <DollarSign className="w-4 h-4" />;
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-hero flex items-center justify-center flex-shrink-0">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold truncate">Dashboard</h1>
              <p className="text-sm sm:text-base text-muted-foreground truncate">
                Welcome back, {user.fullName}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => navigate('/groups/create')} className="flex-1 sm:flex-initial gap-2">
              <Plus className="w-4 h-4" />
              New Group
            </Button>
            <Button onClick={() => navigate('/groups')} variant="outline" className="flex-1 sm:flex-initial">
              My Groups
            </Button>
            <Button onClick={handleLogout} variant="outline" className="flex-1 sm:flex-initial">
              Logout
            </Button>
          </div>
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Groups</p>
                      <p className="text-2xl font-bold">{stats?.totalGroups || 0}</p>
                    </div>
                    <Users className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {stats?.activeGroups || 0} active
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Contributions</p>
                      <p className="text-2xl font-bold">{stats?.totalContributions || 0}</p>
                    </div>
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {stats?.pendingContributions || 0} pending
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Overdue</p>
                      <p className="text-2xl font-bold text-red-600">
                        {stats?.overdueContributions || 0}
                      </p>
                    </div>
                    <AlertCircle className="w-8 h-8 text-red-600" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Requires immediate attention
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Payouts</p>
                      <p className="text-2xl font-bold">{stats?.totalPayouts || 0}</p>
                    </div>
                    <TrendingUp className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {stats?.upcomingPayouts || 0} upcoming
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Profile Summary Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-hero flex items-center justify-center">
                      <UserIcon className="w-5 h-5 text-primary-foreground" />
                    </div>
                    <div>
                      <CardTitle>Your Profile</CardTitle>
                      <CardDescription>Account details and bank information</CardDescription>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => navigate('/profile/settings')}
                    className="gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    Edit Profile
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground">Email</p>
                      <p className="font-medium truncate">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground">Phone</p>
                      <p className="font-medium">{user.phone || 'Not set'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground">Bank Account</p>
                      <p className="font-medium">
                        {user.bankName && user.accountNumber 
                          ? `${user.bankName} - ${'*'.repeat(Math.max(0, user.accountNumber.length - 4))}${user.accountNumber.slice(-4)}`
                          : 'Not set'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground">Account Status</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={user.isVerified ? 'default' : 'secondary'}>
                          {user.isVerified ? 'Verified' : 'Not Verified'}
                        </Badge>
                        {user.kycStatus === 'verified' && (
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            KYC Approved
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Groups and Transactions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Groups */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Recent Groups</CardTitle>
                      <CardDescription>Your latest groups</CardDescription>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => navigate('/groups')}>
                      View All
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {recentGroups.length === 0 ? (
                    <div className="text-center py-8">
                      <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground mb-4">No groups yet</p>
                      <Button onClick={() => navigate('/groups/create')} size="sm">
                        Create Your First Group
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {recentGroups.map((group) => (
                        <div
                          key={group.id}
                          className="flex items-center gap-3 p-3 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                          onClick={() => navigate(`/groups/${group.id}`)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{group.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatCurrency(group.contributionAmount)} • {group.frequency}
                            </p>
                          </div>
                          <Badge variant={group.status === 'active' ? 'default' : 'outline'}>
                            {group.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Transactions */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Activity</CardTitle>
                  <CardDescription>Your latest transactions</CardDescription>
                </CardHeader>
                <CardContent>
                  {recentTransactions.length === 0 ? (
                    <div className="text-center py-8">
                      <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground">No transactions yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {recentTransactions.map((transaction) => (
                        <div
                          key={transaction.id}
                          className="flex items-center gap-3 p-3 border rounded-lg"
                        >
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            {getTransactionIcon(transaction.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm capitalize">
                              {transaction.type.replace('_', ' ')}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {transaction.description}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-sm">
                              {formatCurrency(transaction.amount)}
                            </p>
                            <Badge variant="outline" className="text-xs">
                              {transaction.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Available Groups Section */}
            <div className="mt-6">
              <AvailableGroupsSection onJoinSuccess={loadDashboardData} />
            </div>

            {/* Notifications Section */}
            <div className="mt-6">
              <NotificationCenter />
            </div>

            {/* Action Cards */}
            {stats && stats.overdueContributions > 0 && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-6 h-6 text-red-600 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="font-semibold text-red-900 mb-1">
                        Action Required: Overdue Payments
                      </h3>
                      <p className="text-sm text-red-700 mb-3">
                        You have {stats.overdueContributions} overdue {stats.overdueContributions === 1 ? 'contribution' : 'contributions'}. 
                        Pay now to avoid penalties.
                      </p>
                      <Button size="sm" onClick={() => navigate('/groups')}>
                        View Overdue Payments
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
