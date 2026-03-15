import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserStats, getUserGroups, getUserTransactions, getUserContributionSummary } from '@/api';
import type { UserStats } from '@/api/stats';
import type { GroupContributionSummary } from '@/api/contributions';
import type { Group, Transaction } from '@/types';
import NotificationCenter from '@/components/NotificationCenter';
import AvailableGroupsSection from '@/components/AvailableGroupsSection';
import WalletCard from '@/components/WalletCard';
import ContributionSummaryCard from '@/components/ContributionSummaryCard';
import DashboardLayout, { type DashboardSection } from '@/components/DashboardLayout';
import { useNotifications } from '@/hooks/useNotifications';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
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
  ArrowRight,
  LogOut,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<DashboardSection>('overview');
  const [stats, setStats] = useState<UserStats | null>(null);
  const [recentGroups, setRecentGroups] = useState<Group[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [contributionSummaries, setContributionSummaries] = useState<GroupContributionSummary[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const { unreadCount } = useNotifications();

  useEffect(() => {
    if (user) {
      loadDashboardData();
    }
  }, [user]);

  const loadDashboardData = async () => {
    setLoadingData(true);
    try {
      const statsResult = await getUserStats();
      if (statsResult.success && statsResult.stats) {
        setStats(statsResult.stats);
      }

      const groupsResult = await getUserGroups();
      if (groupsResult.success && groupsResult.groups) {
        setRecentGroups(groupsResult.groups.slice(0, 3));
      }

      const transactionsResult = await getUserTransactions();
      if (transactionsResult.success && transactionsResult.transactions) {
        setRecentTransactions(transactionsResult.transactions.slice(0, 5));
      }

      const summaryResult = await getUserContributionSummary();
      if (summaryResult.success && summaryResult.summaries) {
        setContributionSummaries(summaryResult.summaries);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoadingData(false);
    }
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

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case 'security_deposit':
        return 'Security Deposit';
      case 'contribution':
        return 'Contribution';
      case 'payout':
        return 'Payout';
      case 'penalty':
        return 'Penalty';
      case 'refund':
        return 'Refund';
      default:
        return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ─── Section: Overview ───────────────────────────────────────────────────────
  const OverviewSection = (
    <div className="space-y-6 max-w-5xl">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
          Welcome back, {user.fullName} 👋
        </h1>
        <p className="text-muted-foreground mt-1">
          Here's a summary of your Smart Ajo activity.
        </p>
      </div>

      {loadingData ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Overdue alert */}
          {stats && stats.overdueContributions > 0 && (
            <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-red-900 dark:text-red-300">
                      Action Required: Overdue Payments
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-400 mt-0.5">
                      You have {stats.overdueContributions} overdue{' '}
                      {stats.overdueContributions === 1 ? 'contribution' : 'contributions'}. Pay
                      now to avoid penalties.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => navigate('/groups')}
                    className="flex-shrink-0"
                  >
                    View
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs sm:text-sm text-muted-foreground">Total Groups</p>
                    <p className="text-2xl font-bold mt-1">{stats?.totalGroups || 0}</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{stats?.activeGroups || 0} active</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs sm:text-sm text-muted-foreground">Contributions</p>
                    <p className="text-2xl font-bold mt-1">{stats?.totalContributions || 0}</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {stats?.pendingContributions || 0} pending
                </p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs sm:text-sm text-muted-foreground">Overdue</p>
                    <p className="text-2xl font-bold mt-1 text-red-600">
                      {stats?.overdueContributions || 0}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Needs attention</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs sm:text-sm text-muted-foreground">Payouts</p>
                    <p className="text-2xl font-bold mt-1">{stats?.totalPayouts || 0}</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-primary" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {stats?.upcomingPayouts || 0} upcoming
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button
              className="gap-2 h-11"
              onClick={() => navigate('/groups/create')}
            >
              <Plus className="w-4 h-4" />
              Create New Group
            </Button>
            <Button
              variant="outline"
              className="gap-2 h-11"
              onClick={() => setActiveSection('groups')}
            >
              <Users className="w-4 h-4" />
              View My Groups
            </Button>
            <Button
              variant="outline"
              className="gap-2 h-11"
              onClick={() => setActiveSection('wallet')}
            >
              <DollarSign className="w-4 h-4" />
              Open Wallet
            </Button>
          </div>

          {/* Recent snapshot row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Recent Groups */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Recent Groups</CardTitle>
                    <CardDescription>Your latest groups</CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={() => setActiveSection('groups')}
                  >
                    See all <ArrowRight className="w-3 h-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {recentGroups.length === 0 ? (
                  <div className="text-center py-6">
                    <Users className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground mb-3">No groups yet</p>
                    <Button onClick={() => navigate('/groups/create')} size="sm">
                      Create Your First Group
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentGroups.map((group) => (
                      <div
                        key={group.id}
                        className="flex items-center gap-3 p-2.5 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                        onClick={() => navigate(`/groups/${group.id}`)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{group.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatCurrency(group.contributionAmount)} • {group.frequency}
                          </p>
                        </div>
                        <Badge variant={group.status === 'active' ? 'default' : 'outline'} className="text-xs">
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
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Recent Activity</CardTitle>
                    <CardDescription>Latest transactions</CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={() => setActiveSection('transactions')}
                  >
                    See all <ArrowRight className="w-3 h-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {recentTransactions.length === 0 ? (
                  <div className="text-center py-6">
                    <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No transactions yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentTransactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="flex items-center gap-3 p-2.5 border rounded-lg"
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          {getTransactionIcon(transaction.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">
                            {getTransactionLabel(transaction.type)}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {transaction.description}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-semibold text-sm">{formatCurrency(transaction.amount)}</p>
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

          {/* Contribution Summary */}
          {contributionSummaries.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3">Payment Summary by Group</h2>
              <div className="space-y-3">
                {contributionSummaries.map((summary) => (
                  <ContributionSummaryCard key={summary.groupId} summary={summary} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  // ─── Section: Groups ──────────────────────────────────────────────────────────
  const GroupsSection = (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Groups</h1>
          <p className="text-muted-foreground text-sm mt-1">Your recent savings groups</p>
        </div>
        <Button onClick={() => navigate('/groups/create')} className="gap-2 self-start sm:self-auto">
          <Plus className="w-4 h-4" />
          New Group
        </Button>
      </div>

      {loadingData ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : recentGroups.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="w-14 h-14 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No groups yet</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Create your first savings group or join an existing one to get started.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button onClick={() => navigate('/groups/create')} className="gap-2">
                <Plus className="w-4 h-4" />
                Create Group
              </Button>
              <Button variant="outline" onClick={() => setActiveSection('discover')}>
                Discover Groups
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {recentGroups.map((group) => (
              <Card
                key={group.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/groups/${group.id}`)}
              >
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{group.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatCurrency(group.contributionAmount)} • {group.frequency}
                      </p>
                    </div>
                    <Badge variant={group.status === 'active' ? 'default' : 'outline'}>
                      {group.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Button variant="outline" className="w-full gap-2" onClick={() => navigate('/groups')}>
            View All Groups <ArrowRight className="w-4 h-4" />
          </Button>
        </>
      )}
    </div>
  );

  // ─── Section: Wallet ──────────────────────────────────────────────────────────
  const WalletSection = (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Wallet</h1>
        <p className="text-muted-foreground text-sm mt-1">Your balances and transaction history</p>
      </div>
      <WalletCard />
    </div>
  );

  // ─── Section: Transactions ────────────────────────────────────────────────────
  const TransactionsSection = (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-muted-foreground text-sm mt-1">Your recent transactions (last 5)</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/transactions')} className="gap-2 self-start sm:self-auto">
          Full History <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      {loadingData ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : recentTransactions.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Clock className="w-14 h-14 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No transactions yet</h3>
            <p className="text-muted-foreground">
              Your transactions will appear here once you start contributing.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Transactions</CardTitle>
            <CardDescription>Last 5 transactions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {getTransactionIcon(transaction.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">
                      {getTransactionLabel(transaction.type)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {transaction.description}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-semibold">{formatCurrency(transaction.amount)}</p>
                    <Badge variant="outline" className="text-xs mt-1">
                      {transaction.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // ─── Section: Discover ────────────────────────────────────────────────────────
  const DiscoverSection = (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Discover Groups</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Browse and join savings groups accepting new members
        </p>
      </div>
      <AvailableGroupsSection onJoinSuccess={loadDashboardData} />
    </div>
  );

  // ─── Section: Notifications ───────────────────────────────────────────────────
  const NotificationsSection = (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Notifications</h1>
        <p className="text-muted-foreground text-sm mt-1">Stay up to date with your activity</p>
      </div>
      <NotificationCenter />
    </div>
  );

  // ─── Section: Profile ─────────────────────────────────────────────────────────
  const ProfileSection = (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Profile</h1>
          <p className="text-muted-foreground text-sm mt-1">Your account details</p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate('/profile/settings')}
          className="gap-2 self-start sm:self-auto"
        >
          <Edit className="w-4 h-4" />
          Edit Profile
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-gradient-hero flex items-center justify-center flex-shrink-0">
              <UserIcon className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <CardTitle>{user.fullName}</CardTitle>
              <CardDescription>Account details and bank information</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
              <Mail className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Email</p>
                <p className="font-medium text-sm truncate mt-0.5">{user.email}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
              <Phone className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Phone</p>
                <p className="font-medium text-sm mt-0.5">{user.phone || 'Not set'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
              <Building2 className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Bank Account</p>
                <p className="font-medium text-sm mt-0.5">
                  {user.bankName && user.accountNumber
                    ? `${user.bankName} — ${'*'.repeat(Math.max(0, user.accountNumber.length - 4))}${user.accountNumber.slice(-4)}`
                    : 'Not set'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
              <CheckCircle className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Status</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <Badge variant={user.isVerified ? 'default' : 'secondary'} className="text-xs">
                    {user.isVerified ? 'Verified' : 'Not Verified'}
                  </Badge>
                  {user.kycStatus === 'verified' && (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                      KYC Approved
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KYC CTA if not verified */}
      {user.kycStatus !== 'verified' && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-amber-900 dark:text-amber-300">
                  Complete KYC Verification
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">
                  Verify your identity to unlock all features and higher limits.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/kyc-verification')}
                className="flex-shrink-0 border-amber-400 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30"
              >
                Verify Now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sign Out */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Sign Out</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sign out of your Smart Ajo account
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
              className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const sectionContent: Record<DashboardSection, React.ReactNode> = {
    overview: OverviewSection,
    groups: GroupsSection,
    wallet: WalletSection,
    transactions: TransactionsSection,
    discover: DiscoverSection,
    notifications: NotificationsSection,
    profile: ProfileSection,
  };

  return (
    <DashboardLayout
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      notificationCount={unreadCount}
      overdueCount={stats?.overdueContributions ?? 0}
    >
      {sectionContent[activeSection]}
    </DashboardLayout>
  );
}
