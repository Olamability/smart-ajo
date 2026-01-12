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
