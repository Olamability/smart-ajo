/**
 * Validation utilities for authentication
 */

import { User as AuthUser } from '@supabase/supabase-js';
import { InvalidUserDataError } from '../errors';

/**
 * Validates that an authenticated user has a valid email address
 * 
 * @param authUser - Authenticated user from Supabase Auth
 * @throws InvalidUserDataError if user is missing email address
 */
export function validateAuthUser(authUser: AuthUser): void {
  if (!authUser.email) {
    throw new InvalidUserDataError('User account is missing email address. Please contact support.');
  }
}
