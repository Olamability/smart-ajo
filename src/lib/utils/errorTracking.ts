/**
 * Error tracking and reporting utilities
 * 
 * This module provides centralized error tracking functionality.
 * Currently logs to console, but can be extended to integrate with
 * services like Sentry, LogRocket, or other error tracking platforms.
 */

/**
 * Context information for error reporting
 */
export interface ErrorContext {
  operation?: string;
  userId?: string;
  email?: string;
  timestamp?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Sanitizes context data to remove sensitive information
 * 
 * @param context - Context object that may contain sensitive data
 * @returns Sanitized context object
 */
function sanitizeContext(context: ErrorContext): ErrorContext {
  const sanitized = { ...context };
  
  // Remove sensitive fields
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'api_key'];
  sensitiveFields.forEach(field => {
    if (field in sanitized) {
      delete sanitized[field];
    }
  });
  
  // Mask email if present (show only domain)
  if (sanitized.email && typeof sanitized.email === 'string') {
    const [, domain] = sanitized.email.split('@');
    sanitized.email = `***@${domain || '***'}`;
  }
  
  return sanitized;
}

/**
 * Reports an error with context information
 * 
 * In development: Logs to console
 * In production: Can be extended to send to error tracking service
 * 
 * @param error - The error that occurred
 * @param context - Additional context about the error
 * 
 * @example
 * ```typescript
 * try {
 *   await login(email, password);
 * } catch (error) {
 *   reportError(error, {
 *     operation: 'login',
 *     email: email,
 *     timestamp: new Date().toISOString(),
 *   });
 * }
 * ```
 */
export function reportError(error: unknown, context: ErrorContext = {}): void {
  // Add timestamp if not provided
  const enrichedContext = {
    timestamp: new Date().toISOString(),
    ...context,
  };

  // Sanitize context to remove sensitive data
  const sanitizedContext = sanitizeContext(enrichedContext);

  // Log to console with structured data
  console.error('Error:', error);
  console.error('Context:', sanitizedContext);

  // In production, you can integrate with error tracking services
  // Uncomment and configure one of these when ready:
  
  // Sentry example:
  // if (process.env.NODE_ENV === 'production' && typeof Sentry !== 'undefined') {
  //   Sentry.captureException(error, {
  //     extra: enrichedContext,
  //   });
  // }
  
  // LogRocket example:
  // if (process.env.NODE_ENV === 'production' && typeof LogRocket !== 'undefined') {
  //   LogRocket.captureException(error as Error, {
  //     extra: enrichedContext,
  //   });
  // }
}

/**
 * Reports a warning (non-critical issue)
 * 
 * @param message - Warning message
 * @param context - Additional context
 */
export function reportWarning(message: string, context: ErrorContext = {}): void {
  const enrichedContext = {
    timestamp: new Date().toISOString(),
    ...context,
  };

  const sanitizedContext = sanitizeContext(enrichedContext);

  console.warn('Warning:', message);
  console.warn('Context:', sanitizedContext);

  // In production, you can send warnings to your tracking service
  // if (process.env.NODE_ENV === 'production' && typeof Sentry !== 'undefined') {
  //   Sentry.captureMessage(message, {
  //     level: 'warning',
  //     extra: enrichedContext,
  //   });
  // }
}

/**
 * Reports an info-level event (for tracking important application events)
 * 
 * @param message - Info message
 * @param context - Additional context
 */
export function reportInfo(message: string, context: ErrorContext = {}): void {
  const enrichedContext = {
    timestamp: new Date().toISOString(),
    ...context,
  };

  const sanitizedContext = sanitizeContext(enrichedContext);

  console.info('Info:', message);
  console.info('Context:', sanitizedContext);

  // In production, you can send info events to your tracking service
  // if (process.env.NODE_ENV === 'production' && typeof Sentry !== 'undefined') {
  //   Sentry.captureMessage(message, {
  //     level: 'info',
  //     extra: sanitizedContext,
  //   });
  // }
}
