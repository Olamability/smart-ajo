/**
 * Custom error classes for better error handling
 */

/**
 * Base error class for authentication-related errors
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'AuthError';
    
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when a user profile is not found
 */
export class ProfileNotFoundError extends AuthError {
  constructor(public userId: string) {
    super(
      `User profile not found for user: ${userId}`,
      'PROFILE_NOT_FOUND',
      404
    );
    this.name = 'ProfileNotFoundError';
  }
}

/**
 * Error thrown when a user account is missing required information
 */
export class InvalidUserDataError extends AuthError {
  constructor(message: string) {
    super(
      message,
      'INVALID_USER_DATA',
      400
    );
    this.name = 'InvalidUserDataError';
  }
}

/**
 * Error thrown when a database operation fails
 */
export class DatabaseError extends AuthError {
  cause?: Error | unknown;

  constructor(message: string, originalError?: Error | unknown) {
    super(
      message,
      'DATABASE_ERROR',
      500
    );
    this.name = 'DatabaseError';
    
    // Attach original error for debugging
    if (originalError) {
      this.cause = originalError;
    }
  }
}
