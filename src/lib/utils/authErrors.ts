/**
 * Authentication error mapping utilities
 * Maps Supabase auth errors to user-friendly messages
 */

/**
 * Custom error class for email confirmation required flow
 * This makes the intent explicit and enables type-safe error handling
 */
export class EmailConfirmationRequiredError extends Error {
  constructor() {
    super('Email confirmation is required before logging in');
    this.name = 'EmailConfirmationRequiredError';
  }
}

interface AuthError {
  message: string;
  code?: string;
  status?: number;
}

/**
 * Maps Supabase authentication errors to user-friendly messages
 * 
 * @param error - The error from Supabase auth
 * @returns User-friendly error message
 */
export function mapAuthErrorToMessage(error: unknown): string {
  if (!error) {
    return 'An unexpected error occurred. Please try again.';
  }

  const authError = error as AuthError;
  const message = authError.message?.toLowerCase() || '';
  const code = authError.code?.toLowerCase() || '';

  // Email not confirmed
  if (
    message.includes('email not confirmed') ||
    message.includes('confirm your email') ||
    code === 'email_not_confirmed'
  ) {
    return 'Please confirm your email before logging in. Check your inbox for the confirmation link.';
  }

  // Invalid login credentials
  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid email or password') ||
    code === 'invalid_credentials'
  ) {
    return 'Incorrect email or password. Please try again.';
  }

  // User not found
  if (
    message.includes('user not found') ||
    message.includes('no user found') ||
    code === 'user_not_found'
  ) {
    return 'No account found with this email. Please sign up first.';
  }

  // Email already registered
  if (
    message.includes('user already registered') ||
    message.includes('email already exists') ||
    message.includes('duplicate key') ||
    code === 'user_already_exists'
  ) {
    return 'An account with this email already exists. Please sign in instead.';
  }

  // Rate limiting / Too many requests
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('you can only request this after') ||
    authError.status === 429
  ) {
    return 'Too many attempts. Please wait a moment and try again.';
  }

  // Network/Connection errors
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    message.includes('timeout')
  ) {
    return 'Unable to connect. Please check your internet connection and try again.';
  }

  // Session expired
  if (
    message.includes('session expired') ||
    message.includes('session not found') ||
    message.includes('jwt expired') ||
    code === 'session_expired'
  ) {
    return 'Your session has expired. Please log in again.';
  }

  // Invalid token/session
  if (
    message.includes('invalid token') ||
    message.includes('invalid jwt') ||
    code === 'invalid_token'
  ) {
    return 'Invalid session. Please log in again.';
  }

  // Weak password
  if (
    message.includes('password') &&
    (message.includes('weak') || message.includes('too short') || message.includes('length'))
  ) {
    return 'Password must be at least 6 characters long.';
  }

  // Email validation
  if (message.includes('invalid email') || (message.includes('email') && message.includes('format'))) {
    return 'Please enter a valid email address.';
  }

  // Generic auth error - return the original message if it's user-friendly
  if (authError.message && authError.message.length < 100 && !authError.message.includes('Error:')) {
    return authError.message;
  }

  // Fallback for unknown errors
  return 'Unable to complete authentication. Please try again later.';
}

/**
 * Checks if an error indicates email confirmation is required
 * 
 * @param error - The error to check
 * @returns true if email confirmation is required
 */
export function isEmailConfirmationRequired(error: unknown): boolean {
  if (!error) return false;
  
  const authError = error as AuthError;
  const message = authError.message?.toLowerCase() || '';
  const code = authError.code?.toLowerCase() || '';

  return (
    message.includes('email not confirmed') ||
    message.includes('confirm your email') ||
    code === 'email_not_confirmed'
  );
}

/**
 * Checks if an error is related to invalid credentials
 * 
 * @param error - The error to check
 * @returns true if credentials are invalid
 */
export function isInvalidCredentialsError(error: unknown): boolean {
  if (!error) return false;
  
  const authError = error as AuthError;
  const message = authError.message?.toLowerCase() || '';
  const code = authError.code?.toLowerCase() || '';

  return (
    message.includes('invalid login credentials') ||
    message.includes('invalid email or password') ||
    code === 'invalid_credentials'
  );
}
