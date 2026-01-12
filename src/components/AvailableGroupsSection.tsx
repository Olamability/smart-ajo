import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAvailableGroups } from '@/api';
import type { Group } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, DollarSign, Calendar, Loader2, UserPlus, Search, Phone, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface AvailableGroupsSectionProps {
  onJoinSuccess?: () => void;
}

export default function AvailableGroupsSection({ onJoinSuccess: _onJoinSuccess }: AvailableGroupsSectionProps) {
  const navigate = useNavigate();
  const [availableGroups, setAvailableGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAvailableGroups();
  }, []);

  const loadAvailableGroups = async () => {
    setLoading(true);
    try {
      const result = await getAvailableGroups();
      if (result.success && result.groups) {
        setAvailableGroups(result.groups);
      } else {
        console.error('Failed to load available groups:', result.error);
      }
    } catch (error) {
      console.error('Error loading available groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async (groupId: string) => {
    // Navigate to group detail page where user can select slot and send join request
    navigate(`/groups/${groupId}`);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
    }).format(amount);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Available Groups to Join
          </CardTitle>
          <CardDescription>Browse and join existing groups</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (availableGroups.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Available Groups to Join
          </CardTitle>
          <CardDescription>Browse and join existing groups</CardDescription>
        </CardHeader>
        <CardContent className="text-center py-8">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">
            No available groups to join at the moment
          </p>
          <Button onClick={() => navigate('/groups/create')} size="sm">
            Create a New Group
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              Available Groups to Join
            </CardTitle>
            <CardDescription>
              {availableGroups.length} {availableGroups.length === 1 ? 'group' : 'groups'} accepting new members
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {availableGroups.map((group) => (
            <Card
              key={group.id}
              className="hover:shadow-lg transition-shadow cursor-pointer border-2"
              onClick={() => navigate(`/groups/${group.id}`)}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="line-clamp-1 text-base sm:text-lg">
                      {group.name}
                    </CardTitle>
                    <CardDescription className="line-clamp-2 mt-1 text-xs sm:text-sm">
                      {group.description}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="whitespace-nowrap bg-green-50 text-green-700 border-green-200">
                    Accepting Members
                  </Badge>
                </div>
                {/* Creator Information */}
                {(group.creatorProfileImage || group.creatorPhone) && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={group.creatorProfileImage || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary">
                        <User className="w-4 h-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">Created by</p>
                      {group.creatorPhone && (
                        <div className="flex items-center gap-1 text-xs font-medium">
                          <Phone className="w-3 h-3" />
                          <span className="truncate">{group.creatorPhone}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-2 sm:space-y-3">
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
                      <Users className="w-3 h-3 sm:w-4 sm:h-4" />
                      Available Spots
                    </span>
                    <span className="font-semibold">
                      {group.totalMembers - group.currentMembers} of {group.totalMembers}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="w-3 h-3 sm:w-4 sm:h-4" />
                      Frequency
                    </span>
                    <span className="font-semibold capitalize">{group.frequency}</span>
                  </div>
                </div>
                <div className="mt-4">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleJoinGroup(group.id);
                    }}
                    className="w-full gap-2"
                    size="sm"
                  >
                    <UserPlus className="w-4 h-4" />
                    View & Join Group
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
