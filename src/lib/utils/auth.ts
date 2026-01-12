/**
 * Shared utilities for authentication operations
 */

interface RPCResponse<T = unknown> {
  data?: T;
  error?: {
    message: string;
    code?: string;
  };
}

interface AtomicRPCResult {
  success?: boolean | null;
  error_message?: string;
}

/**
 * Parses atomic RPC response from create_user_profile_atomic function
 * Throws error if the operation failed
 * 
 * @param rpcResponse - Response from Supabase RPC call
 * @param operationName - Name of the operation (for error messages)
 */
export function parseAtomicRPCResponse(
  rpcResponse: RPCResponse<AtomicRPCResult | AtomicRPCResult[]>,
  operationName: string
): void {
  // Check for RPC-level errors first
  if (rpcResponse.error) {
    throw new Error(`${operationName} failed: ${rpcResponse.error.message}`);
  }

  // Check if data exists
  if (!rpcResponse.data) {
    throw new Error(`${operationName} failed: No data returned from RPC call`);
  }

  // For functions returning a single row, data might be an object or an array
  const result = Array.isArray(rpcResponse.data) 
    ? rpcResponse.data[0] 
    : rpcResponse.data;
  
  if (!result) {
    throw new Error(`${operationName} failed: Empty response from RPC call`);
  }

  // Check the success flag from the atomic function
  if (result.success === false || result.success === undefined || result.success === null) {
    const errorMsg = result.error_message || 'Unknown error - no success status returned';
    throw new Error(`${operationName} failed: ${errorMsg}`);
  }
  
  // If we get here, the operation was successful
}

interface ErrorWithCode {
  message?: string;
  code?: string;
}

/**
 * Checks if an error is transient (network/timeout related or RLS propagation delay)
 * Transient errors are worth retrying with exponential backoff
 * 
 * @param error - Error object or message
 * @returns true if error is transient, false otherwise
 */
export function isTransientError(error: string | Error | ErrorWithCode): boolean {
  const errorMessage = typeof error === 'string' 
    ? error 
    : (error as Error).message || '';
  
  const errorCode = typeof error === 'object' && error !== null && 'code' in error
    ? (error as ErrorWithCode).code || ''
    : '';
  
  // Network and timeout errors are always transient
  if (errorMessage.includes('timeout') ||
      errorMessage.includes('network') ||
      errorMessage.includes('connection')) {
    return true;
  }
  
  // RLS/permission errors can be transient during session propagation
  // This happens when signInWithPassword succeeds but the session JWT
  // hasn't propagated to the PostgreSQL RLS context yet
  // Common error codes: PGRST301 (no rows), 42501 (insufficient privilege)
  if (errorCode === 'PGRST301' || 
      errorCode === '42501' ||
      errorMessage.includes('row-level security') ||
      errorMessage.includes('permission denied') ||
      errorMessage.includes('no rows')) {
    return true;
  }
  
  return false;
}
