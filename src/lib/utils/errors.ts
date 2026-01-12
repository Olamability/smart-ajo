/**
 * Error handling utilities
 * Shared error detection and handling functions
 */

import { POSTGRES_ERROR_CODES } from '@/lib/constants/database';

interface ErrorWithCode {
  code?: string;
  message?: string;
}

/**
 * Check if an error is a duplicate key error
 * Works with both Supabase PostgreSQL errors and general error messages
 * 
 * @param error - Error object from Supabase or any error with a message
 * @returns true if the error indicates a duplicate key violation
 */
export function isDuplicateError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  
  const err = error as ErrorWithCode;
  
  return (
    err.code === POSTGRES_ERROR_CODES.UNIQUE_VIOLATION ||
    err.message?.includes('duplicate') === true ||
    err.message?.includes('already exists') === true
  );
}

/**
 * Calculate retry delay with exponential backoff
 * 
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @returns Delay in milliseconds for this attempt
 */
export function calculateRetryDelay(attempt: number, baseDelay: number): number {
  // Linear backoff: baseDelay * (attempt + 1)
  // This provides 1x, 2x, 3x delays
  return baseDelay * (attempt + 1);
}
