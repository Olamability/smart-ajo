import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { createClient } from '../lib/client/supabase';
import {
  Users,
  Building2,
  BarChart3,
  FileText,
  Search,
  UserX,
  UserCheck,
  Ban,
  Play,
  Loader2,
  AlertCircle,
  DollarSign,
  Shield
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type {
  AdminUser,
  AdminGroup,
  AdminAnalytics,
  AuditLog
} from '../types';

type TabType = 'overview' | 'users' | 'groups' | 'audit';

export default function SystemAdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    checkAdminAccess();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (activeTab === 'overview') {
      loadAnalytics();
    } else if (activeTab === 'users') {
      loadUsers();
    } else if (activeTab === 'groups') {
      loadGroups();
    } else if (activeTab === 'audit') {
      loadAuditLogs();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchTerm, statusFilter]);

  const checkAdminAccess = async () => {
    if (!user) {
      toast.error('Please log in to access this page');
      navigate('/login');
      return;
    }

    try {
      const { data: userData, error } = await supabase
        .from('users')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (!userData?.is_admin) {
        toast.error('Access denied. System admin privileges required.');
        navigate('/dashboard');
        return;
      }

      setLoading(false);
    } catch (error) {
      console.error('Error checking admin access:', error);
      toast.error('Failed to verify admin access');
      navigate('/dashboard');
    }
  };

  const loadAnalytics = async () => {
    try {
      const { data, error } = await supabase.rpc('get_admin_analytics');

      if (error) throw error;

      if (data && data.length > 0) {
        setAnalytics(data[0]);
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
      toast.error('Failed to load analytics');
    }
  };

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase.rpc('get_all_users_admin', {
        p_limit: 50,
        p_offset: 0,
        p_search: searchTerm || null,
        p_is_active: statusFilter === 'active' ? true : statusFilter === 'suspended' ? false : null
      });

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    }
  };

  const loadGroups = async () => {
    try {
      const { data, error } = await supabase.rpc('get_all_groups_admin', {
        p_limit: 50,
        p_offset: 0,
        p_status: statusFilter || null,
        p_search: searchTerm || null
      });

      if (error) throw error;
      setGroups(data || []);
    } catch (error) {
      console.error('Error loading groups:', error);
      toast.error('Failed to load groups');
    }
  };

  const loadAuditLogs = async () => {
    try {
      const { data, error } = await supabase.rpc('get_audit_logs_admin', {
        p_limit: 100,
        p_offset: 0
      });

      if (error) throw error;
      setAuditLogs(data || []);
    } catch (error) {
      console.error('Error loading audit logs:', error);
      toast.error('Failed to load audit logs');
    }
  };

  const handleSuspendUser = async (userId: string, isActive: boolean) => {
    setActionLoading(userId);
    try {
      const { data, error } = await supabase.rpc('suspend_user_admin', {
        p_user_id: userId,
        p_is_active: !isActive,
        p_reason: isActive ? 'Suspended by admin' : 'Activated by admin'
      });

      if (error) throw error;

      if (data && data.success) {
        toast.success(data.message);
        loadUsers();
      } else {
        toast.error(data?.message || 'Action failed');
      }
    } catch (error: unknown) {
      console.error('Error suspending user:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to update user status';
      toast.error(errorMessage);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangeGroupStatus = async (groupId: string, newStatus: string) => {
    setActionLoading(groupId);
    try {
      const { data, error } = await supabase.rpc('deactivate_group_admin', {
        p_group_id: groupId,
        p_new_status: newStatus,
        p_reason: `Changed to ${newStatus} by admin`
      });

      if (error) throw error;

      if (data && data.success) {
        toast.success(data.message);
        loadGroups();
      } else {
        toast.error(data?.message || 'Action failed');
      }
    } catch (error: unknown) {
      console.error('Error changing group status:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to update group status';
      toast.error(errorMessage);
    } finally {
      setActionLoading(null);
    }
  };

  const formatCurrency = (amount: number | string) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0
    }).format(num);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Shield className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">System Admin Dashboard</h1>
                <p className="text-sm text-gray-500">Platform-wide management and oversight</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => navigate('/dashboard')}>
              Back to Dashboard
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8" aria-label="Tabs">
            {[
              { id: 'overview', name: 'Overview', icon: BarChart3 },
              { id: 'users', name: 'Users', icon: Users },
              { id: 'groups', name: 'Groups', icon: Building2 },
              { id: 'audit', name: 'Audit Logs', icon: FileText }
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  className={`
                    flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm
                    ${activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <Icon className="h-5 w-5" />
                  <span>{tab.name}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overview Tab */}
        {activeTab === 'overview' && analytics && (
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.total_users}</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.active_users} active
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Groups</CardTitle>
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.total_groups}</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.active_groups} active
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Collected</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(analytics.total_amount_collected)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.paid_contributions} contributions
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">KYC Verified</CardTitle>
                  <Shield className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.users_with_kyc}</div>
                  <p className="text-xs text-muted-foreground">
                    {Math.round((analytics.users_with_kyc / analytics.total_users) * 100)}% of users
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Group Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Forming Groups</span>
                    <span className="font-semibold">{analytics.forming_groups}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Active Groups</span>
                    <span className="font-semibold">{analytics.active_groups}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Completed Groups</span>
                    <span className="font-semibold">{analytics.completed_groups}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Contribution Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Total Contributions</span>
                    <span className="font-semibold">{analytics.total_contributions}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Paid</span>
                    <span className="font-semibold text-green-600">{analytics.paid_contributions}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Overdue</span>
                    <span className="font-semibold text-red-600">{analytics.overdue_contributions}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* Filters */}
            <Card>
              <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>View and manage all platform users</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="Search by name, email, or phone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <select
                    value={statusFilter || ''}
                    onChange={(e) => setStatusFilter(e.target.value || null)}
                    className="px-3 py-2 border rounded-md"
                  >
                    <option value="">All Users</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Users Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Groups</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">KYC</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {users.map((user) => (
                        <tr key={user.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <div className="flex items-center">
                              <div>
                                <div className="font-medium text-gray-900">{user.full_name}</div>
                                {user.is_admin && (
                                  <Badge variant="secondary" className="mt-1">Admin</Badge>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm text-gray-900">{user.email}</div>
                            <div className="text-sm text-gray-500">{user.phone}</div>
                          </td>
                          <td className="px-6 py-4">
                            <Badge variant={user.is_active ? 'default' : 'destructive'}>
                              {user.is_active ? 'Active' : 'Suspended'}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {user.total_groups}
                          </td>
                          <td className="px-6 py-4">
                            <Badge
                              variant={
                                user.kyc_status === 'approved' ? 'default' :
                                user.kyc_status === 'pending' ? 'secondary' :
                                'outline'
                              }
                            >
                              {user.kyc_status}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {format(new Date(user.created_at), 'MMM dd, yyyy')}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {!user.is_admin && (
                              <Button
                                size="sm"
                                variant={user.is_active ? 'outline' : 'default'}
                                onClick={() => handleSuspendUser(user.id, user.is_active)}
                                disabled={actionLoading === user.id}
                              >
                                {actionLoading === user.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : user.is_active ? (
                                  <>
                                    <UserX className="h-4 w-4 mr-1" />
                                    Suspend
                                  </>
                                ) : (
                                  <>
                                    <UserCheck className="h-4 w-4 mr-1" />
                                    Activate
                                  </>
                                )}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {users.length === 0 && (
                    <div className="text-center py-12">
                      <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">No users found</h3>
                      <p className="mt-1 text-sm text-gray-500">Try adjusting your filters</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Groups Tab */}
        {activeTab === 'groups' && (
          <div className="space-y-6">
            {/* Filters */}
            <Card>
              <CardHeader>
                <CardTitle>Group Management</CardTitle>
                <CardDescription>View and manage all platform groups</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="Search by group name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <select
                    value={statusFilter || ''}
                    onChange={(e) => setStatusFilter(e.target.value || null)}
                    className="px-3 py-2 border rounded-md"
                  >
                    <option value="">All Groups</option>
                    <option value="forming">Forming</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Groups Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Group</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Creator</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Members</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contribution</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cycle</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {groups.map((group) => (
                        <tr key={group.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <div className="font-medium text-gray-900">{group.name}</div>
                            <div className="text-sm text-gray-500">
                              {formatCurrency(group.total_amount_collected)} collected
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm text-gray-900">{group.creator_name}</div>
                            <div className="text-sm text-gray-500">{group.creator_email}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {group.current_members} / {group.total_members}
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm text-gray-900">
                              {formatCurrency(group.contribution_amount)}
                            </div>
                            <div className="text-sm text-gray-500">{group.frequency}</div>
                          </td>
                          <td className="px-6 py-4">
                            <Badge
                              variant={
                                group.status === 'active' ? 'default' :
                                group.status === 'forming' ? 'secondary' :
                                group.status === 'completed' ? 'outline' :
                                'destructive'
                              }
                            >
                              {group.status}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {group.current_cycle} / {group.total_cycles}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {group.status === 'active' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleChangeGroupStatus(group.id, 'paused')}
                                disabled={actionLoading === group.id}
                              >
                                {actionLoading === group.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Ban className="h-4 w-4 mr-1" />
                                    Pause
                                  </>
                                )}
                              </Button>
                            )}
                            {group.status === 'paused' && (
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleChangeGroupStatus(group.id, 'active')}
                                disabled={actionLoading === group.id}
                              >
                                {actionLoading === group.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Play className="h-4 w-4 mr-1" />
                                    Activate
                                  </>
                                )}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {groups.length === 0 && (
                    <div className="text-center py-12">
                      <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">No groups found</h3>
                      <p className="mt-1 text-sm text-gray-500">Try adjusting your filters</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Audit Logs Tab */}
        {activeTab === 'audit' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Audit Logs</CardTitle>
                <CardDescription>Track all administrative actions</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {format(new Date(log.created_at), 'MMM dd, yyyy HH:mm:ss')}
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm text-gray-900">{log.user_name || 'System'}</div>
                            <div className="text-sm text-gray-500">{log.user_email}</div>
                          </td>
                          <td className="px-6 py-4">
                            <Badge variant="outline">{log.action}</Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {log.resource_type}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {JSON.stringify(log.details)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {auditLogs.length === 0 && (
                    <div className="text-center py-12">
                      <FileText className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">No audit logs</h3>
                      <p className="mt-1 text-sm text-gray-500">Admin actions will appear here</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
