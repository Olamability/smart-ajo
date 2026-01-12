/**
 * Profile management utilities
 * Shared logic for user profile creation and management
 */

import { SupabaseClient, User as AuthUser } from '@supabase/supabase-js';
import { validateAuthUser } from './validation';
import { isDuplicateError } from './errors';

/**
 * Ensures a user profile exists in the database
 * If the profile doesn't exist, creates it from auth metadata
 * 
 * @param supabase - Supabase client instance
 * @param authUser - Authenticated user from Supabase Auth
 * @returns Promise that resolves to true if profile exists or was created
 * @throws Error if profile creation fails (except for duplicate key errors)
 */
export async function ensureUserProfile(
  supabase: SupabaseClient,
  authUser: AuthUser
): Promise<boolean> {
  // Validate auth user has email
  validateAuthUser(authUser);
  
  // Check if profile exists
  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();
  
  if (profile) {
    console.log('ensureUserProfile: Profile already exists');
    return true;
  }
  
  console.log('ensureUserProfile: Profile does not exist, creating...');
  
  // Create profile from auth metadata
  const userEmail = authUser.email!; // We validated this above
  const fullName = authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'User';
  
  // Phone is required (NOT NULL in schema)
  // Generate temporary unique phone if not provided using first 12 chars of UUID for brevity
  // Format: temp_xxxxxxxxxxxx (5 + 12 = 17 chars, within VARCHAR(20) limit)
  const phone = authUser.user_metadata?.phone || `temp_${authUser.id.substring(0, 12)}`;
  
  // Try multiple methods to create the profile
  let lastError: Error | null = null;
  
  // Method 1: Try using the RPC function (preferred)
  try {
    console.log('ensureUserProfile: Attempting profile creation via RPC function');
    const { error: rpcError } = await supabase.rpc('create_user_profile', {
      p_user_id: authUser.id,
      p_email: userEmail,
      p_phone: phone,
      p_full_name: fullName,
    });
    
    // Ignore duplicate key errors (profile might have been created concurrently)
    if (rpcError && !isDuplicateError(rpcError)) {
      
      // If RPC function doesn't exist, try fallback
      if (rpcError.message?.includes('Could not find the function') || 
          rpcError.message?.includes('function') && rpcError.message?.includes('does not exist')) {
        console.warn('ensureUserProfile: RPC function not found, trying fallback');
        throw rpcError; // Fall through to Method 2
      }
      
      lastError = rpcError instanceof Error ? rpcError : new Error(String(rpcError));
      throw lastError;
    }
    
    console.log('ensureUserProfile: Profile created successfully via RPC');
    return true;
  } catch (rpcError) {
    console.warn('ensureUserProfile: RPC method failed, trying direct insert:', rpcError);
    lastError = rpcError instanceof Error ? rpcError : new Error(String(rpcError));
  }
  
  // Method 2: Try direct insert as fallback
  try {
    console.log('ensureUserProfile: Attempting profile creation via direct insert');
    const { error: insertError } = await supabase
      .from('users')
      .insert({
        id: authUser.id,
        email: userEmail,
        phone: phone,
        full_name: fullName,
        is_verified: false,
        is_active: true,
        kyc_status: 'not_started',
      });
    
    // Ignore duplicate key errors
    if (insertError && !isDuplicateError(insertError)) {
      console.error('ensureUserProfile: Direct insert failed:', insertError);
      throw insertError;
    }
    
    console.log('ensureUserProfile: Profile created successfully via direct insert');
    return true;
  } catch (insertError) {
    console.error('ensureUserProfile: All methods failed');
    throw lastError || insertError;
  }
}
