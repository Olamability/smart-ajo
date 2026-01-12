/**
 * Timeout configuration constants for network requests
 * 
 * These values are based on industry best practices for financial applications:
 * - Authentication operations: 30 seconds (to handle slower connections)
 * - Database queries: 15 seconds (for data fetching)
 * - Critical operations: 30 seconds (signup, login, sensitive actions)
 * 
 * Financial applications require a balance between security and usability.
 * Timeouts prevent hanging connections while allowing sufficient time for
 * operations to complete over varying network conditions.
 */

/**
 * Timeout for authentication session checks (30 seconds)
 * Used when verifying existing sessions on app load or auth state changes
 */
export const AUTH_SESSION_TIMEOUT = 30000;

/**
 * Timeout for user data fetches from database (15 seconds)
 * Used when retrieving user profile data after authentication
 */
export const USER_DATA_FETCH_TIMEOUT = 15000;

/**
 * Timeout for authentication operations like signup and login (30 seconds)
 * Used for critical auth operations that may involve email verification
 */
export const AUTH_OPERATION_TIMEOUT = 30000;

/**
 * Timeout for database write operations (15 seconds)
 * Used for insert, update, and delete operations
 */
export const DB_WRITE_TIMEOUT = 15000;

/**
 * Default timeout for general network requests (30 seconds)
 * Used as fallback for operations without specific timeout requirements
 */
export const DEFAULT_REQUEST_TIMEOUT = 30000;
