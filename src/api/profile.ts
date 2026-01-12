/**
 * User Profile API
 * 
 * Handles user profile updates including bank account details
 */

import { createClient } from '@/lib/client/supabase';
import type { User } from '@/types';

export interface BankAccountData {
  bankName: string;
  accountNumber: string;
  accountName: string;
  bankCode: string;
}

export interface UpdateProfileData {
  fullName?: string;
  phone?: string;
  address?: string;
  dateOfBirth?: string;
  bankAccount?: BankAccountData;
  avatarUrl?: string;
}

/**
 * Get current user profile
 */
export async function getUserProfile(): Promise<{ success: boolean; user?: User; error?: string }> {
  try {
    const supabase = createClient();
    
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (error) {
      console.error('Error fetching user profile:', error);
      return { success: false, error: error.message };
    }

    // Transform database user to app user format
    const user: User = {
      id: data.id,
      email: data.email,
      phone: data.phone,
      fullName: data.full_name,
      createdAt: data.created_at,
      isVerified: data.is_verified,
      isActive: data.is_active,
      isAdmin: data.is_admin,
      kycStatus: data.kyc_status === 'approved' ? 'verified' : data.kyc_status,
      kycData: data.kyc_data,
      profileImage: data.avatar_url,
      dateOfBirth: data.date_of_birth,
      address: data.address,
      updatedAt: data.updated_at,
      lastLoginAt: data.last_login_at,
      bankName: data.bank_name,
      accountNumber: data.account_number,
      accountName: data.account_name,
      bankCode: data.bank_code,
    };

    return { success: true, user };
  } catch (error) {
    console.error('Error in getUserProfile:', error);
    return { success: false, error: 'Failed to fetch profile' };
  }
}

/**
 * Update user profile
 */
export async function updateUserProfile(
    updates: UpdateProfileData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const supabase = createClient();
      
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) {
        return { success: false, error: 'Not authenticated' };
      }
  
      // Prepare update data (convert from camelCase to snake_case)
      const updateData: Record<string, string | undefined> = {
        updated_at: new Date().toISOString(),
      };
  
      if (updates.fullName !== undefined) {
        updateData.full_name = updates.fullName;
      }
      if (updates.phone !== undefined) {
        updateData.phone = updates.phone;
      }
      if (updates.address !== undefined) {
        updateData.address = updates.address;
      }
      if (updates.dateOfBirth !== undefined) {
        updateData.date_of_birth = updates.dateOfBirth;
      }
      if (updates.bankAccount) {
        updateData.bank_name = updates.bankAccount.bankName;
        updateData.account_number = updates.bankAccount.accountNumber;
        updateData.account_name = updates.bankAccount.accountName;
        updateData.bank_code = updates.bankAccount.bankCode;
      }
      if (updates.avatarUrl !== undefined) {
        updateData.avatar_url = updates.avatarUrl;
      }

    const { error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', authUser.id);

    if (error) {
      console.error('Error updating user profile:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in updateUserProfile:', error);
    return { success: false, error: 'Failed to update profile' };
  }
}

/**
 * Update bank account details only
 */
export async function updateBankAccount(
  bankAccount: BankAccountData
): Promise<{ success: boolean; error?: string }> {
  return updateUserProfile({ bankAccount });
}

/**
 * Check if user has bank account configured
 */
export async function hasBankAccount(): Promise<{ success: boolean; hasAccount: boolean; error?: string }> {
  try {
    const result = await getUserProfile();
    if (!result.success || !result.user) {
      return { success: false, hasAccount: false, error: result.error };
    }

    const hasAccount = !!(
      result.user.bankName &&
      result.user.accountNumber &&
      result.user.accountName &&
      result.user.bankCode
    );

    return { success: true, hasAccount };
  } catch (error) {
    console.error('Error checking bank account:', error);
    return { success: false, hasAccount: false, error: 'Failed to check bank account' };
  }
}

/**
 * Upload user avatar/profile image
 */
export async function uploadAvatar(
  file: File
): Promise<{ success: boolean; avatarUrl?: string; error?: string }> {
  try {
    const supabase = createClient();
    
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
      return { success: false, error: 'Not authenticated' };
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return { success: false, error: 'Invalid file type. Please upload a JPEG, PNG, WEBP, or GIF image.' };
    }

    // Validate file size (2MB max)
    const maxSize = 2 * 1024 * 1024; // 2MB
    if (file.size > maxSize) {
      return { success: false, error: 'File size too large. Maximum size is 2MB.' };
    }

    // Safely determine file extension from MIME type
    const mimeToExt: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif'
    };
    const fileExt = mimeToExt[file.type];
    
    if (!fileExt) {
      return { success: false, error: 'Unsupported file type' };
    }
    
    // Sanitize user ID (already a UUID from Supabase, but be explicit)
    const sanitizedUserId = authUser.id.replace(/[^a-zA-Z0-9-]/g, '');
    const filePath = `${sanitizedUserId}/avatar.${fileExt}`;

    // Delete old avatar if exists
    const { data: existingFiles } = await supabase.storage
      .from('avatars')
      .list(authUser.id);

    if (existingFiles && existingFiles.length > 0) {
      const filesToDelete = existingFiles.map(f => `${authUser.id}/${f.name}`);
      await supabase.storage.from('avatars').remove(filesToDelete);
    }

    // Upload new avatar
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      console.error('Error uploading avatar:', uploadError);
      return { success: false, error: uploadError.message };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    // Update user profile with avatar URL
    const { error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', authUser.id);

    if (updateError) {
      console.error('Error updating avatar URL:', updateError);
      return { success: false, error: updateError.message };
    }

    return { success: true, avatarUrl: publicUrl };
  } catch (error) {
    console.error('Error in uploadAvatar:', error);
    return { success: false, error: 'Failed to upload avatar' };
  }
}

/**
 * Delete user avatar/profile image
 */
export async function deleteAvatar(): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient();
    
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
      return { success: false, error: 'Not authenticated' };
    }

    // List all files in user's avatar folder
    const { data: files, error: listError } = await supabase.storage
      .from('avatars')
      .list(authUser.id);

    if (listError) {
      console.error('Error listing avatars:', listError);
      return { success: false, error: listError.message };
    }

    if (files && files.length > 0) {
      // Delete all avatar files
      const filesToDelete = files.map(f => `${authUser.id}/${f.name}`);
      const { error: deleteError } = await supabase.storage
        .from('avatars')
        .remove(filesToDelete);

      if (deleteError) {
        console.error('Error deleting avatars:', deleteError);
        return { success: false, error: deleteError.message };
      }
    }

    // Update user profile to remove avatar URL
    const { error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq('id', authUser.id);

    if (updateError) {
      console.error('Error updating user profile:', updateError);
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in deleteAvatar:', error);
    return { success: false, error: 'Failed to delete avatar' };
  }
}

/**
 * Change user password
 */
export async function changePassword(
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient();
    
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      console.error('Error changing password:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in changePassword:', error);
    return { success: false, error: 'Failed to change password' };
  }
}

/**
 * Deactivate user account
 * This sets is_active to false, preventing login while preserving data
 */
export async function deactivateAccount(): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient();
    
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
      return { success: false, error: 'Not authenticated' };
    }

    // Check if user has active groups
    // We check for members with status 'active' or 'pending' because pending members
    // have paid but are awaiting full group activation. We only check groups with
    // status 'active' because 'forming' groups haven't started yet and users can leave freely
    const { data: activeGroups, error: groupsError } = await supabase
      .from('group_members')
      .select('group_id, groups!inner(status)')
      .eq('user_id', authUser.id)
      .in('status', ['active', 'pending'])
      .eq('groups.status', 'active');

    if (groupsError) {
      console.error('Error checking active groups:', groupsError);
      return { success: false, error: 'Failed to check active groups' };
    }

    if (activeGroups && activeGroups.length > 0) {
      return { 
        success: false, 
        error: `Cannot deactivate account. You are still a member of ${activeGroups.length} active group(s). Please leave or complete all groups first.` 
      };
    }

    // Deactivate account
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        is_active: false, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', authUser.id);

    if (updateError) {
      console.error('Error deactivating account:', updateError);
      return { success: false, error: updateError.message };
    }

    // Sign out the user
    await supabase.auth.signOut();

    return { success: true };
  } catch (error) {
    console.error('Error in deactivateAccount:', error);
    return { success: false, error: 'Failed to deactivate account' };
  }
}

/**
 * List of Nigerian banks with their codes
 * This can be used for bank selection dropdown
 */
export const NIGERIAN_BANKS = [
  { name: 'Access Bank', code: '044' },
  { name: 'Citibank Nigeria', code: '023' },
  { name: 'Ecobank Nigeria', code: '050' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'First City Monument Bank (FCMB)', code: '214' },
  { name: 'Guaranty Trust Bank (GTBank)', code: '058' },
  { name: 'Heritage Bank', code: '030' },
  { name: 'Keystone Bank', code: '082' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'Providus Bank', code: '101' },
  { name: 'Stanbic IBTC Bank', code: '221' },
  { name: 'Standard Chartered Bank', code: '068' },
  { name: 'Sterling Bank', code: '232' },
  { name: 'Union Bank of Nigeria', code: '032' },
  { name: 'United Bank for Africa (UBA)', code: '033' },
  { name: 'Unity Bank', code: '215' },
  { name: 'Wema Bank', code: '035' },
  { name: 'Zenith Bank', code: '057' },
].sort((a, b) => a.name.localeCompare(b.name));
