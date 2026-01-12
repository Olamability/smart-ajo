import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Safely parses a fetch Response as JSON with Content-Type validation
 * @param response - The fetch Response object
 * @param context - Optional context string for error logging (e.g., 'Signup', 'Login')
 * @returns Parsed JSON data if successful, or throws an error
 * @throws Error if response is not JSON
 */
export async function parseJsonResponse<T = unknown>(
  response: Response,
  context?: string
): Promise<T> {
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const errorContext = context ? `${context}: ` : '';
    const contentTypeInfo = contentType 
      ? `content-type: ${contentType.split(';')[0]}` 
      : 'no content-type header';
    console.error(`${errorContext}Expected JSON response but got ${contentTypeInfo}`);
    throw new Error('Invalid response format from server');
  }
  return response.json();
}

/**
 * Converts an error to a user-friendly message
 * Specifically handles invalid response format errors, timeout errors, and rate limiting
 */
export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error) {
    // Return the error message for known error types
    if (error.message === 'Invalid response format from server') {
      return 'Server error: Invalid response format';
    }
    // Return timeout messages as-is since they're already user-friendly
    if (error.message.includes('timed out') || error.message.includes('timeout')) {
      return error.message;
    }
    // Handle rate limiting errors
    if (error.message.includes('you can only request this after') || 
        error.message.includes('rate limit') ||
        error.message.includes('too many requests')) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    // Return other error messages
    return error.message;
  }
  // Check if error object has status property (for HTTP errors)
  if (error && typeof error === 'object' && 'status' in error) {
    const statusError = error as { status?: number; message?: string };
    if (statusError.status === 429) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
  }
  return fallbackMessage;
}

/**
 * Wraps a promise with a timeout
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @param timeoutMessage - Custom timeout error message
 * @returns Promise that rejects if timeout is reached
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 30000,
  timeoutMessage: string = 'Request timed out. Please check your internet connection and try again.'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    ),
  ]);
}

/**
 * Retries an async operation with exponential backoff
 * @param operation - The async operation to retry
 * @param maxRetries - Maximum number of retry attempts (default: 5)
 * @param initialDelayMs - Initial delay in milliseconds (default: 100)
 * @param onRetry - Optional callback called before each retry with retry count
 * @returns Promise that resolves with the operation result or rejects after all retries fail
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 5,
  initialDelayMs: number = 100,
  onRetry?: (retryCount: number) => void
): Promise<T> {
  let retries = maxRetries;
  let delay = initialDelayMs;
  let lastError: Error | null = null;

  while (retries > 0) {
    try {
      const result = await operation();
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if error has stopRetry flag to immediately abort retries
      if (error && typeof error === 'object' && 'stopRetry' in error && error.stopRetry === true) {
        throw lastError;
      }
      
      retries--;

      if (retries > 0) {
        if (onRetry) {
          onRetry(maxRetries - retries);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
  }

  throw lastError || new Error('Operation failed after retries');
}
