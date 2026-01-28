/**
 * Error handling utilities
 */

/**
 * Gets a reliable type string for an error value
 * More reliable than using optional chaining on constructor.name
 * 
 * @param error - The error value to check
 * @returns A string representing the error type
 */
export function getErrorType(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor.name;
  }
  if (error === null) {
    return 'null';
  }
  if (error === undefined) {
    return 'undefined';
  }
  return typeof error;
}

/**
 * Checks if an error is of a specific type
 * 
 * @param error - The error to check
 * @param errorClass - The error class to check against
 * @returns True if error is an instance of errorClass
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isErrorOfType(error: unknown, errorClass: new (...args: any[]) => Error): boolean {
  return error instanceof errorClass;
}

/**
 * Extracts a safe error message from an unknown error value
 * 
 * @param error - The error value
 * @param fallback - Fallback message if error has no message
 * @returns A safe string message
 */
export function extractErrorMessage(error: unknown, fallback: string = 'An unknown error occurred'): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

/**
 * Checks if an error is a network/connection error related to Supabase
 * 
 * @param error - The error to check
 * @returns True if this looks like a Supabase connection error
 */
export function isSupabaseConnectionError(error: unknown): boolean {
  const message = extractErrorMessage(error, '').toLowerCase();
  
  // Check for common network error indicators
  return (
    message.includes('failed to fetch') ||
    message.includes('network error') ||
    message.includes('err_name_not_resolved') ||
    message.includes('could not resolve host') ||
    message.includes('connection refused') ||
    message.includes('timeout')
  );
}

/**
 * Enhances a Supabase connection error with helpful troubleshooting information
 * 
 * @param error - The original error
 * @param context - Additional context about what was being attempted
 * @returns An enhanced error with troubleshooting guidance
 */
export function enhanceSupabaseConnectionError(error: unknown, context: string = 'connecting to database'): Error {
  if (!isSupabaseConnectionError(error)) {
    // Not a connection error, return original
    if (error instanceof Error) {
      return error;
    }
    return new Error(extractErrorMessage(error));
  }

  const originalMessage = extractErrorMessage(error);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'not configured';
  
  const enhancedMessage = `
[SUPABASE CONNECTION ERROR]

Failed while ${context}: ${originalMessage}

Current Supabase URL: ${supabaseUrl}

This typically means:
1. The Supabase project URL is incorrect or the project has been deleted
2. Network connectivity issues
3. The Supabase service is temporarily unavailable

FIX INSTRUCTIONS:

1. Verify your Supabase project exists:
   -> Go to https://supabase.com/dashboard
   -> Check if your project is active

2. Update your .env.development file with the correct credentials:
   -> Get Project URL from Settings -> API
   -> Update VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

3. Restart the development server:
   -> Stop the server (Ctrl+C)
   -> Run: npm run dev

DOCUMENTATION: See docs/TROUBLESHOOTING_SUPABASE_CONNECTION.md for detailed help.
  `.trim();

  // Create enhanced error with cause preserved
  const enhancedError = new Error(enhancedMessage);
  enhancedError.name = 'SupabaseConnectionError';
  
  // Preserve original error as cause (ES2022 feature with fallback)
  try {
    Object.defineProperty(enhancedError, 'cause', {
      value: error,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  } catch {
    // Ignore if property can't be defined
  }
  
  return enhancedError;
}
