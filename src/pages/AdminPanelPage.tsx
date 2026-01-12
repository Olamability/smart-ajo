import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { createClient } from '../lib/client/supabase';
import { 
  Users, 
  DollarSign, 
  AlertTriangle, 
  Download, 
  UserMinus,
  CheckCircle,
  XCircle,
  Clock,
  FileText
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface GroupMember {
  id: string;
  user_id: string;
  position: number;
  has_paid_security_deposit: boolean;
  status: string;
  joined_at: string;
  users: {
    full_name: string;
    email: string;
    phone: string;
    kyc_status: string;
  };
}

interface Contribution {
  id: string;
  user_id: string;
  cycle_number: number;
  amount: number;
  status: string;
  due_date: string;
  paid_date: string | null;
  users: {
    full_name: string;
    email: string;
  };
}

interface Penalty {
  id: string;
  user_id: string;
  amount: number;
  type: string;
  reason: string;
  status: string;
  created_at: string;
  users: {
    full_name: string;
    email: string;
  };
}

interface GroupDetails {
  id: string;
  name: string;
  description: string;
  contribution_amount: number;
  frequency: string;
  total_members: number;
  current_members: number;
  current_cycle: number;
  total_cycles: number;
  status: string;
  created_by: string;
  security_deposit_amount: number;
}

export default function AdminPanelPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'contributions' | 'penalties'>('overview');

  const supabase = createClient();

  useEffect(() => {
    if (groupId) {
      loadGroupData();
    }
  }, [groupId]);

  const loadGroupData = async () => {
    if (!groupId) return;

    setLoading(true);
    try {
      // Load group details
      const { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select('*')
        .eq('id', groupId)
        .maybeSingle();

      if (groupError) throw groupError;
      if (!groupData) {
        toast.error('Group not found');
        navigate('/groups');
        return;
      }

      // Check if user is the creator or platform admin
      const { data: userData } = await supabase
        .from('users')
        .select('is_admin')
        .eq('id', user?.id)
        .maybeSingle();

      const isAdmin = userData?.is_admin || false;

      if (groupData.created_by !== user?.id && !isAdmin) {
        toast.error('You do not have permission to access this admin panel');
        navigate('/groups');
        return;
      }

      setGroup(groupData);

      // Load members
      const { data: membersData, error: membersError } = await supabase
        .from('group_members')
        .select(`
          *,
          users:user_id (
            full_name,
            email,
            phone,
            kyc_status
          )
        `)
        .eq('group_id', groupId)
        .order('position', { ascending: true });

      if (membersError) throw membersError;
      setMembers(membersData || []);

      // Load contributions for current cycle
      const { data: contributionsData, error: contributionsError } = await supabase
        .from('contributions')
        .select(`
          *,
          users:user_id (
            full_name,
            email
          )
        `)
        .eq('group_id', groupId)
        .eq('cycle_number', groupData.current_cycle)
        .order('due_date', { ascending: true });

      if (contributionsError) throw contributionsError;
      setContributions(contributionsData || []);

      // Load penalties
      const { data: penaltiesData, error: penaltiesError } = await supabase
        .from('penalties')
        .select(`
          *,
          users:user_id (
            full_name,
            email
          )
        `)
        .eq('group_id', groupId)
        .order('created_at', { ascending: false });

      if (penaltiesError) throw penaltiesError;
      setPenalties(penaltiesData || []);

    } catch (error: any) {
      console.error('Error loading group data:', error);
      toast.error('Failed to load group data');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    if (!confirm(`Are you sure you want to remove ${memberName} from this group?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('group_members')
        .update({ status: 'removed' })
        .eq('id', memberId);

      if (error) throw error;

      toast.success('Member removed successfully');
      loadGroupData();
    } catch (error: any) {
      console.error('Error removing member:', error);
      toast.error('Failed to remove member');
    }
  };

  const handleWaivePenalty = async (penaltyId: string) => {
    try {
      const { error } = await supabase
        .from('penalties')
        .update({ status: 'waived' })
        .eq('id', penaltyId);

      if (error) throw error;

      toast.success('Penalty waived successfully');
      loadGroupData();
    } catch (error: any) {
      console.error('Error waiving penalty:', error);
      toast.error('Failed to waive penalty');
    }
  };

  const handleChangeGroupStatus = async (newStatus: string) => {
    if (!confirm(`Are you sure you want to change the group status to ${newStatus}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('groups')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', groupId);

      if (error) throw error;

      toast.success('Group status updated successfully');
      loadGroupData();
    } catch (error: any) {
      console.error('Error updating group status:', error);
      toast.error('Failed to update group status');
    }
  };

  const exportToCSV = () => {
    if (!group) return;

    const csvData = [
      ['Smart Ajo - Group Report'],
      [''],
      ['Group Name', group.name],
      ['Status', group.status],
      ['Current Cycle', `${group.current_cycle} of ${group.total_cycles}`],
      [''],
      ['Members'],
      ['Name', 'Email', 'Position', 'Security Deposit', 'Status'],
      ...members.map(m => [
        m.users.full_name,
        m.users.email,
        m.position.toString(),
        m.has_paid_security_deposit ? 'Paid' : 'Pending',
        m.status
      ]),
      [''],
      ['Contributions (Current Cycle)'],
      ['Name', 'Amount', 'Status', 'Due Date', 'Paid Date'],
      ...contributions.map(c => [
        c.users.full_name,
        `₦${c.amount}`,
        c.status,
        format(new Date(c.due_date), 'yyyy-MM-dd'),
        c.paid_date ? format(new Date(c.paid_date), 'yyyy-MM-dd') : 'N/A'
      ]),
      [''],
      ['Penalties'],
      ['Name', 'Amount', 'Type', 'Reason', 'Status', 'Date'],
      ...penalties.map(p => [
        p.users.full_name,
        `₦${p.amount}`,
        p.type,
        p.reason,
        p.status,
        format(new Date(p.created_at), 'yyyy-MM-dd')
      ])
    ];

    const csvContent = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${group.name.replace(/\s+/g, '_')}_report_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast.success('Report exported successfully');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Group not found</h1>
          <Button onClick={() => navigate('/groups')} className="mt-4">
            Back to Groups
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">{group.name}</h1>
            <p className="text-muted-foreground mt-1">Admin Panel</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate(`/groups/${groupId}`)}>
              <FileText className="h-4 w-4 mr-2" />
              View Public Page
            </Button>
            <Button onClick={exportToCSV}>
              <Download className="h-4 w-4 mr-2" />
              Export Report
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">
                {group.current_members}/{group.total_members}
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Current Cycle
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">
                {group.current_cycle}/{group.total_cycles}
              </div>
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Contribution Amount
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">₦{group.contribution_amount.toLocaleString()}</div>
              <DollarSign className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Penalties
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">
                {penalties.filter(p => p.status === 'applied').length}
              </div>
              <AlertTriangle className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b mb-6">
        <div className="flex space-x-4 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'members', label: 'Members' },
            { id: 'contributions', label: 'Contributions' },
            { id: 'penalties', label: 'Penalties' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-2 px-1 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Group Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge variant={group.status === 'active' ? 'default' : 'secondary'}>
                    {group.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Frequency</p>
                  <p className="font-medium">{group.frequency}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Security Deposit</p>
                  <p className="font-medium">₦{group.security_deposit_amount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Cycles</p>
                  <p className="font-medium">{group.total_cycles}</p>
                </div>
              </div>
              {group.description && (
                <div>
                  <p className="text-sm text-muted-foreground">Description</p>
                  <p className="mt-1">{group.description}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Manage your group settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {group.status === 'forming' && (
                <Button 
                  onClick={() => handleChangeGroupStatus('active')}
                  className="w-full"
                  disabled={group.current_members < group.total_members}
                >
                  Activate Group
                </Button>
              )}
              {group.status === 'active' && (
                <Button 
                  onClick={() => handleChangeGroupStatus('completed')}
                  variant="outline"
                  className="w-full"
                >
                  Mark as Completed
                </Button>
              )}
              <Button 
                onClick={() => handleChangeGroupStatus('cancelled')}
                variant="destructive"
                className="w-full"
              >
                Cancel Group
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'members' && (
        <Card>
          <CardHeader>
            <CardTitle>Group Members</CardTitle>
            <CardDescription>Manage members in your group</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {members.map((member) => (
                <div key={member.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{member.users.full_name}</p>
                      <Badge variant="outline">Position {member.position}</Badge>
                      {member.has_paid_security_deposit ? (
                        <Badge variant="default" className="bg-green-500">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Deposit Paid
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          Deposit Pending
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{member.users.email}</p>
                    <p className="text-sm text-muted-foreground">{member.users.phone}</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRemoveMember(member.id, member.users.full_name)}
                    disabled={member.status !== 'active'}
                  >
                    <UserMinus className="h-4 w-4 mr-2" />
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'contributions' && (
        <Card>
          <CardHeader>
            <CardTitle>Contributions (Cycle {group.current_cycle})</CardTitle>
            <CardDescription>Track member contributions for current cycle</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {contributions.map((contribution) => (
                <div key={contribution.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{contribution.users.full_name}</p>
                      <Badge variant={
                        contribution.status === 'paid' ? 'default' :
                        contribution.status === 'overdue' ? 'destructive' : 'secondary'
                      }>
                        {contribution.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Amount: ₦{contribution.amount.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Due: {format(new Date(contribution.due_date), 'MMM dd, yyyy')}
                      {contribution.paid_date && ` • Paid: ${format(new Date(contribution.paid_date), 'MMM dd, yyyy')}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'penalties' && (
        <Card>
          <CardHeader>
            <CardTitle>Penalties</CardTitle>
            <CardDescription>Manage penalties applied to members</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {penalties.map((penalty) => (
                <div key={penalty.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{penalty.users.full_name}</p>
                      <Badge variant={
                        penalty.status === 'paid' ? 'default' :
                        penalty.status === 'waived' ? 'secondary' : 'destructive'
                      }>
                        {penalty.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Amount: ₦{penalty.amount.toLocaleString()} • Type: {penalty.type}
                    </p>
                    <p className="text-sm text-muted-foreground">{penalty.reason}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(penalty.created_at), 'MMM dd, yyyy')}
                    </p>
                  </div>
                  {penalty.status === 'applied' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleWaivePenalty(penalty.id)}
                    >
                      Waive Penalty
                    </Button>
                  )}
                </div>
              ))}
              {penalties.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  No penalties applied yet
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
