/**
 * Groups API Service
 * 
 * Handles all group-related operations using Supabase client.
 * All database operations are protected by Row Level Security (RLS) policies.
 */

import { createClient } from '@/lib/client/supabase';
import { Group, GroupMember, CreateGroupFormData } from '@/types';
import { getErrorMessage } from '@/lib/utils';
import { DEFAULT_SERVICE_FEE_PERCENTAGE } from '@/lib/constants';

/**
 * Create a new Ajo group
 */
export const createGroup = async (
  data: CreateGroupFormData
): Promise<{ success: boolean; group?: Group; error?: string }> => {
  try {
    const supabase = createClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Fetch user profile to get phone and profile image
    const { data: userProfile, error: userError } = await supabase
      .from('users')
      .select('phone, avatar_url')
      .eq('id', user.id)
      .single();

    if (userError) {
      console.error('Error fetching user profile for group creation:', userError.message, userError);
      // Continue even if profile fetch fails - profile info is optional for group creation
    }

    // Calculate security deposit amount
    const securityDepositAmount =
      (data.contributionAmount * data.securityDepositPercentage) / 100;

    // Insert group into database
    const { data: groupData, error } = await supabase
      .from('groups')
      .insert({
        name: data.name,
        description: data.description,
        created_by: user.id,
        creator_profile_image: userProfile?.avatar_url || null,
        creator_phone: userProfile?.phone || null,
        contribution_amount: data.contributionAmount,
        frequency: data.frequency,
        total_members: data.totalMembers,
        current_members: 0, // Start at 0, will be incremented to 1 by trigger when creator is added
        security_deposit_amount: securityDepositAmount,
        security_deposit_percentage: data.securityDepositPercentage,
        service_fee_percentage: DEFAULT_SERVICE_FEE_PERCENTAGE, // Explicitly set the service fee percentage
        status: 'forming',
        start_date: data.startDate,
        current_cycle: 1,
        total_cycles: data.totalMembers,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating group:', error);
      return { success: false, error: error.message };
    }

    // NOTE: Creator is NO LONGER automatically added as member via database trigger
    // The creator will be added as a member after completing payment with their selected slot
    // This allows creators to choose their preferred payout position

    // Fetch the updated group data to get the correct current_members count (should be 0)
    const { data: updatedGroupData, error: fetchError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', groupData.id)
      .single();

    if (fetchError) {
      console.warn('Warning: Could not fetch updated group data:', fetchError);
      // Continue with original data
    }

    const finalGroupData = updatedGroupData || groupData;

    return {
      success: true,
      group: {
        id: finalGroupData.id,
        name: finalGroupData.name,
        description: finalGroupData.description,
        createdBy: finalGroupData.created_by,
        creatorProfileImage: finalGroupData.creator_profile_image,
        creatorPhone: finalGroupData.creator_phone,
        contributionAmount: finalGroupData.contribution_amount,
        frequency: finalGroupData.frequency,
        totalMembers: finalGroupData.total_members,
        currentMembers: finalGroupData.current_members || 0, // Show 0 until creator completes payment
        securityDepositAmount: finalGroupData.security_deposit_amount,
        securityDepositPercentage: finalGroupData.security_deposit_percentage,
        status: finalGroupData.status,
        createdAt: finalGroupData.created_at,
        startDate: finalGroupData.start_date,
        currentCycle: finalGroupData.current_cycle,
        totalCycles: finalGroupData.total_cycles,
        rotationOrder: [],
        members: [],
        serviceFeePercentage: finalGroupData.service_fee_percentage || DEFAULT_SERVICE_FEE_PERCENTAGE,
      },
    };
  } catch (error) {
    console.error('Create group error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to create group'),
    };
  }
};

/**
 * Get all groups for the current user
 */
export const getUserGroups = async (): Promise<{
  success: boolean;
  groups?: Group[];
  error?: string;
}> => {
  try {
    const supabase = createClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Query groups where user is a member OR is the creator
    // Using two separate queries for clarity and combining results
    // This approach is clearer and handles both cases explicitly
    
    // Get groups where user is creator
    const { data: createdGroups, error: createdError } = await supabase
      .from('groups')
      .select('*')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });

    if (createdError) {
      console.error('Error fetching created groups:', createdError);
      return { success: false, error: createdError.message };
    }

    // Get groups where user is a member
    const { data: memberGroups, error: memberError } = await supabase
      .from('groups')
      .select(`
        *,
        group_members!inner(user_id)
      `)
      .eq('group_members.user_id', user.id)
      .order('created_at', { ascending: false });

    if (memberError) {
      console.error('Error fetching member groups:', memberError);
      return { success: false, error: memberError.message };
    }

    // Combine and deduplicate groups
    const allGroupsMap = new Map<string, any>();
    
    // Add created groups
    (createdGroups || []).forEach(group => {
      allGroupsMap.set(group.id, group);
    });
    
    // Add member groups (won't overwrite if already exists)
    (memberGroups || []).forEach(group => {
      if (!allGroupsMap.has(group.id)) {
        allGroupsMap.set(group.id, group);
      }
    });
    
    // Convert map to array and sort by created_at
    const data = Array.from(allGroupsMap.values()).sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const groups: Group[] = (data || []).map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      createdBy: group.created_by,
      creatorProfileImage: group.creator_profile_image,
      creatorPhone: group.creator_phone,
      contributionAmount: group.contribution_amount,
      frequency: group.frequency,
      totalMembers: group.total_members,
      currentMembers: group.current_members || 0,
      securityDepositAmount: group.security_deposit_amount,
      securityDepositPercentage: group.security_deposit_percentage,
      status: group.status,
      createdAt: group.created_at,
      updatedAt: group.updated_at,
      startDate: group.start_date,
      endDate: group.end_date,
      currentCycle: group.current_cycle,
      totalCycles: group.total_cycles,
      rotationOrder: [],
      members: [],
      serviceFeePercentage: group.service_fee_percentage || DEFAULT_SERVICE_FEE_PERCENTAGE,
    }));

    return { success: true, groups };
  } catch (error) {
    console.error('Get groups error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch groups'),
    };
  }
};

/**
 * Get a single group by ID
 */
export const getGroupById = async (
  groupId: string
): Promise<{ success: boolean; group?: Group; error?: string }> => {
  try {
    const supabase = createClient();

    // Fetch group with member count
    const { data, error } = await supabase
      .from('groups')
      .select(`
        *,
        group_members (
          count
        )
      `)
      .eq('id', groupId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching group:', error);
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: 'Group not found' };
    }

    return {
      success: true,
      group: {
        id: data.id,
        name: data.name,
        description: data.description,
        createdBy: data.created_by,
        creatorProfileImage: data.creator_profile_image,
        creatorPhone: data.creator_phone,
        contributionAmount: data.contribution_amount,
        frequency: data.frequency,
        totalMembers: data.total_members,
        currentMembers: data.current_members || 0,
        securityDepositAmount: data.security_deposit_amount,
        securityDepositPercentage: data.security_deposit_percentage,
        status: data.status,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        startDate: data.start_date,
        endDate: data.end_date,
        currentCycle: data.current_cycle,
        totalCycles: data.total_cycles,
        rotationOrder: [],
        members: [],
        serviceFeePercentage: data.service_fee_percentage || DEFAULT_SERVICE_FEE_PERCENTAGE,
      },
    };
  } catch (error) {
    console.error('Get group error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch group'),
    };
  }
};

/**
 * Get all members of a group
 */
export const getGroupMembers = async (
  groupId: string
): Promise<{ success: boolean; members?: GroupMember[]; error?: string }> => {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('group_members')
      .select(`
        *,
        users (
          full_name,
          email,
          phone
        )
      `)
      .eq('group_id', groupId)
      .order('position', { ascending: true });

    if (error) {
      console.error('Error fetching group members:', error);
      return { success: false, error: error.message };
    }

    const members: GroupMember[] = (data || []).map((member: any) => ({
      userId: member.user_id,
      userName: member.users?.full_name || 'Unknown User',
      joinedAt: member.joined_at,
      rotationPosition: member.position,
      securityDepositPaid: member.has_paid_security_deposit,
      securityDepositAmount: member.security_deposit_amount,
      status: member.status,
      totalContributions: 0, // Would need to query contributions table
      totalPenalties: 0, // Would need to query penalties table
      hasReceivedPayout: false, // Would need to query payouts table
    }));

    return { success: true, members };
  } catch (error) {
    console.error('Get group members error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch group members'),
    };
  }
};

/**
 * Request to join an existing group (creates a join request for admin approval)
 */
export const joinGroup = async (
  groupId: string,
  preferredSlot?: number,
  message?: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const supabase = createClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Call the database function to create join request with slot preference
    const { data, error } = await supabase.rpc('request_to_join_group', {
      p_group_id: groupId,
      p_user_id: user.id,
      p_preferred_slot: preferredSlot || null,
      p_message: message || null,
    });

    if (error) {
      console.error('Error requesting to join group:', error);
      return { success: false, error: error.message };
    }

    // The function returns a table with success and error_message columns
    if (data && data.length > 0) {
      const result = data[0];
      if (!result.success) {
        return { success: false, error: result.error_message };
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Join group error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to request to join group'),
    };
  }
};

/**
 * Get available groups that the user can join
 * Returns forming groups where the user is not yet a member
 */
export const getAvailableGroups = async (): Promise<{
  success: boolean;
  groups?: Group[];
  error?: string;
}> => {
  try {
    const supabase = createClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get all forming groups
    const { data: formingGroups, error: formingError } = await supabase
      .from('groups')
      .select('*')
      .eq('status', 'forming')
      .order('created_at', { ascending: false });

    if (formingError) {
      console.error('Error fetching forming groups:', formingError);
      return { success: false, error: formingError.message };
    }

    // Get groups where user is already a member
    const { data: userMemberships, error: memberError } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id);

    if (memberError) {
      console.error('Error fetching user memberships:', memberError);
      return { success: false, error: memberError.message };
    }

    // Filter out groups where user is already a member
    const memberGroupIds = new Set(
      (userMemberships || []).map((m) => m.group_id)
    );
    const availableGroupsData = (formingGroups || []).filter(
      (group) => !memberGroupIds.has(group.id) && group.current_members < group.total_members
    );

    const groups: Group[] = availableGroupsData.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      createdBy: group.created_by,
      creatorProfileImage: group.creator_profile_image,
      creatorPhone: group.creator_phone,
      contributionAmount: group.contribution_amount,
      frequency: group.frequency,
      totalMembers: group.total_members,
      currentMembers: group.current_members || 0,
      securityDepositAmount: group.security_deposit_amount,
      securityDepositPercentage: group.security_deposit_percentage,
      status: group.status,
      createdAt: group.created_at,
      updatedAt: group.updated_at,
      startDate: group.start_date,
      endDate: group.end_date,
      currentCycle: group.current_cycle,
      totalCycles: group.total_cycles,
      rotationOrder: [],
      members: [],
      serviceFeePercentage: group.service_fee_percentage || DEFAULT_SERVICE_FEE_PERCENTAGE,
    }));

    return { success: true, groups };
  } catch (error) {
    console.error('Get available groups error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch available groups'),
    };
  }
};

/**
 * Update security deposit payment status
 */
export const updateSecurityDepositPayment = async (
  groupId: string,
  userId: string,
  transactionRef: string,
  amount: number
): Promise<{ success: boolean; error?: string }> => {
  try {
    const supabase = createClient();

    // Update member status to active and mark security deposit as paid
    const { error } = await supabase
      .from('group_members')
      .update({
        has_paid_security_deposit: true,
        security_deposit_paid_at: new Date().toISOString(),
        status: 'active', // Activate member after payment
      })
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error updating security deposit:', error);
      return { success: false, error: error.message };
    }

    // Create a transaction record with the actual amount paid
    const { error: transactionError } = await supabase.from('transactions').insert({
      user_id: userId,
      group_id: groupId,
      type: 'security_deposit',
      amount: amount, // Store the actual security deposit amount
      status: 'completed',
      reference: transactionRef,
      description: 'Security deposit payment',
      completed_at: new Date().toISOString(),
    });

    if (transactionError) {
      console.error('Error creating transaction record:', transactionError);
      // Don't fail the whole operation if transaction record fails
      // The member is already marked as paid
    }

    return { success: true };
  } catch (error) {
    console.error('Update security deposit error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to update security deposit'),
    };
  }
};

/**
 * Get pending join requests for a group (for group creator/admin)
 */
export const getPendingJoinRequests = async (
  groupId: string
): Promise<{ success: boolean; requests?: any[]; error?: string }> => {
  try {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('get_pending_join_requests', {
      p_group_id: groupId,
    });

    if (error) {
      console.error('Error fetching join requests:', error);
      return { success: false, error: error.message };
    }

    return { success: true, requests: data || [] };
  } catch (error) {
    console.error('Get join requests error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch join requests'),
    };
  }
};

/**
 * Approve a join request (for group creator/admin)
 */
export const approveJoinRequest = async (
  requestId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const supabase = createClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase.rpc('approve_join_request', {
      p_request_id: requestId,
      p_reviewer_id: user.id,
    });

    if (error) {
      console.error('Error approving join request:', error);
      return { success: false, error: error.message };
    }

    // The function returns a table with success and error_message columns
    if (data && data.length > 0) {
      const result = data[0];
      if (!result.success) {
        return { success: false, error: result.error_message };
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Approve join request error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to approve join request'),
    };
  }
};

/**
 * Reject a join request (for group creator/admin)
 */
export const rejectJoinRequest = async (
  requestId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const supabase = createClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase.rpc('reject_join_request', {
      p_request_id: requestId,
      p_reviewer_id: user.id,
      p_rejection_reason: reason || null,
    });

    if (error) {
      console.error('Error rejecting join request:', error);
      return { success: false, error: error.message };
    }

    // The function returns a table with success and error_message columns
    if (data && data.length > 0) {
      const result = data[0];
      if (!result.success) {
        return { success: false, error: result.error_message };
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Reject join request error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to reject join request'),
    };
  }
};

/**
 * Get user's join request status for a specific group
 */
export const getUserJoinRequestStatus = async (
  groupId: string
): Promise<{ success: boolean; request?: any; error?: string }> => {
  try {
    const supabase = createClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('group_join_requests')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching join request status:', error);
      return { success: false, error: error.message };
    }

    // Return the first result if available, otherwise null
    return { success: true, request: data && data.length > 0 ? data[0] : null };
  } catch (error) {
    console.error('Get join request status error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch join request status'),
    };
  }
};

/**
 * Get available payout slots for a group
 */
export const getAvailableSlots = async (
  groupId: string
): Promise<{
  success: boolean;
  slots?: { slot_number: number; payout_cycle: number; status: string }[];
  error?: string;
}> => {
  try {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('get_available_slots', {
      p_group_id: groupId,
    });

    if (error) {
      console.error('Error fetching available slots:', error);
      return { success: false, error: error.message };
    }

    return { success: true, slots: data || [] };
  } catch (error) {
    console.error('Get available slots error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to fetch available slots'),
    };
  }
};

/**
 * Manually initialize slots for a group (fallback if automatic initialization failed)
 */
export const initializeGroupSlots = async (
  groupId: string,
  totalSlots: number
): Promise<{ success: boolean; error?: string }> => {
  try {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('initialize_group_slots', {
      p_group_id: groupId,
      p_total_slots: totalSlots,
    });

    if (error) {
      console.error('Error initializing group slots:', error);
      return { success: false, error: error.message };
    }

    // The function returns a table with success and error_message columns
    if (data && data.length > 0) {
      const result = data[0];
      if (!result.success) {
        return { success: false, error: result.error_message };
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Initialize group slots error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to initialize group slots'),
    };
  }
};

/**
 * Delete a group (only if creator and no members have paid)
 * Used for cleanup when group creation payment fails or is cancelled
 */
export const deleteGroup = async (
  groupId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const supabase = createClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Verify user is the creator
    const { data: group, error: fetchError } = await supabase
      .from('groups')
      .select('created_by, current_members')
      .eq('id', groupId)
      .single();

    if (fetchError) {
      return { success: false, error: 'Group not found' };
    }

    if (group.created_by !== user.id) {
      return { success: false, error: 'Only the group creator can delete this group' };
    }

    // Only allow deletion if no members have joined (current_members = 0)
    if (group.current_members > 0) {
      return { success: false, error: 'Cannot delete group with active members' };
    }

    // Delete the group (cascade will handle related records)
    const { error: deleteError } = await supabase
      .from('groups')
      .delete()
      .eq('id', groupId);

    if (deleteError) {
      console.error('Error deleting group:', deleteError);
      return { success: false, error: deleteError.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Delete group error:', error);
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to delete group'),
    };
  }
};
