/**
 * Error tracking and reporting utilities
 *
 * This module provides centralized error tracking functionality.
 * Integrates with Sentry when VITE_SENTRY_DSN is configured.
 */

import * as Sentry from '@sentry/react';

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
 * Reports an error with context information.
 * Sends to Sentry in production when DSN is configured.
 */
export function reportError(error: unknown, context: ErrorContext = {}): void {
  const enrichedContext = {
    timestamp: new Date().toISOString(),
    ...context,
  };

  const sanitizedContext = sanitizeContext(enrichedContext);

  console.error('Error:', error);
  console.error('Context:', sanitizedContext);

  Sentry.withScope(scope => {
    scope.setExtras(sanitizedContext);
    Sentry.captureException(error);
  });
}

/**
 * Reports a warning (non-critical issue).
 */
export function reportWarning(message: string, context: ErrorContext = {}): void {
  const enrichedContext = {
    timestamp: new Date().toISOString(),
    ...context,
  };

  const sanitizedContext = sanitizeContext(enrichedContext);

  console.warn('Warning:', message);
  console.warn('Context:', sanitizedContext);

  Sentry.withScope(scope => {
    scope.setExtras(sanitizedContext);
    Sentry.captureMessage(message, 'warning');
  });
}

/**
 * Reports an info-level event (for tracking important application events).
 */
export function reportInfo(message: string, context: ErrorContext = {}): void {
  const enrichedContext = {
    timestamp: new Date().toISOString(),
    ...context,
  };

  const sanitizedContext = sanitizeContext(enrichedContext);

  console.info('Info:', message);
  console.info('Context:', sanitizedContext);

  Sentry.withScope(scope => {
    scope.setExtras(sanitizedContext);
    Sentry.captureMessage(message, 'info');
  });
}
