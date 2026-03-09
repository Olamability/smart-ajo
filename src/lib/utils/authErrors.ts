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

  // Weak password - Supabase password policy
  // Note: As of 2024, Supabase default minimum is 6 characters
  // This can be configured in Supabase project settings
  if (
    message.includes('password') &&
    (message.includes('weak') || message.includes('too short') || message.includes('length') || message.includes('at least'))
  ) {
    return 'Password must be at least 6 characters long.';
  }

  // Email validation - be specific to avoid false positives
  if (
    message.includes('invalid email') ||
    message.includes('email format') ||
    (message.includes('email') && message.includes('valid'))
  ) {
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

/**
 * Checks if an error is a rate-limit / too-many-requests error
 *
 * @param error - The error to check
 * @returns true if the error is a rate-limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;

  const authError = error as AuthError;
  const message = authError.message?.toLowerCase() || '';

  return (
    authError.status === 429 ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('you can only request this after') ||
    message.includes('email rate limit exceeded') ||
    message.includes('over_email_send_rate_limit')
  );
}

/**
 * Parses the number of seconds to wait from a Supabase rate-limit error message.
 * Supabase often returns messages like:
 *   "For security purposes, you can only request this after 53 seconds."
 *
 * @param error - The error to inspect
 * @returns Wait time in seconds, or a default of 60 if not parseable
 */
export function parseRateLimitWaitSeconds(error: unknown): number {
  const DEFAULT_WAIT_SECONDS = 60;

  if (!error) return DEFAULT_WAIT_SECONDS;

  const message = (error as AuthError).message || '';
  const match = message.match(/(\d+)\s*second/i);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  return DEFAULT_WAIT_SECONDS;
}
