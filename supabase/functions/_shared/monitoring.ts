/**
 * _shared/monitoring.ts
 *
 * Centralised error-reporting and structured-logging utilities for all
 * Smart Ajo Edge Functions.
 *
 * Usage:
 *   import { reportError, structuredLog } from '../_shared/monitoring.ts';
 *
 *   // At the top of serve():
 *   const mon = createMonitor('my-function');
 *
 *   // Capture an unexpected error:
 *   mon.error('Unexpected payment failure', err, { reference, userId });
 *
 *   // Emit a structured info log:
 *   mon.info('Payment verified', { reference, amount });
 *
 * When the SENTRY_DSN environment variable is set the utility will forward
 * errors to Sentry via the Sentry HTTP Envelope API (no native Deno SDK
 * required).  In all cases the message is also written to stdout/stderr so
 * it appears in the Supabase Functions log stream.
 *
 * Environment variables read:
 *   SENTRY_DSN            – Sentry Data Source Name (optional)
 *   SENTRY_ENVIRONMENT    – Defaults to "production"
 *   SENTRY_RELEASE        – Defaults to "unknown"
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonitorContext {
  [key: string]: unknown;
}

export interface Monitor {
  /** Log an informational message with optional structured context. */
  info(message: string, context?: MonitorContext): void;
  /** Log a warning with optional structured context. */
  warn(message: string, context?: MonitorContext): void;
  /**
   * Log an error and, if SENTRY_DSN is configured, forward it to Sentry.
   * Always returns a Promise so callers can await it if they want to ensure
   * delivery before the function exits.
   */
  error(message: string, err?: unknown, context?: MonitorContext): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractErrorDetails(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

/**
 * Send an error event to Sentry using the HTTP Envelope API.
 * https://develop.sentry.dev/sdk/data-model/envelope/
 */
async function sendToSentry(
  dsn: string,
  functionName: string,
  message: string,
  err: unknown,
  context: MonitorContext,
): Promise<void> {
  try {
    // Parse DSN:  https://<key>@<host>/<project_id>
    const dsnUrl = new URL(dsn);
    const projectId = dsnUrl.pathname.replace(/^\//, '');
    const storeEndpoint = `${dsnUrl.protocol}//${dsnUrl.host}/api/${projectId}/envelope/`;
    const publicKey = dsnUrl.username;

    const { message: errMessage, stack } = extractErrorDetails(err ?? new Error(message));

    const eventId = crypto.randomUUID().replace(/-/g, '');
    const now = Math.floor(Date.now() / 1000);

    // Build Sentry envelope (envelope header + event header + event body)
    const envelopeHeader = JSON.stringify({
      event_id: eventId,
      sent_at: new Date().toISOString(),
      dsn,
    });

    const itemHeader = JSON.stringify({ type: 'event' });

    const event = JSON.stringify({
      event_id: eventId,
      timestamp: now,
      platform: 'javascript',
      level: 'error',
      logger: `edge-function.${functionName}`,
      release: Deno.env.get('SENTRY_RELEASE') ?? 'unknown',
      environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
      transaction: functionName,
      exception: {
        values: [
          {
            type: err instanceof Error ? err.constructor.name : 'Error',
            value: message + (errMessage !== message ? `: ${errMessage}` : ''),
            stacktrace: stack
              ? {
                  frames: stack.split('\n').slice(1).map((line) => ({
                    filename: functionName,
                    function: line.trim(),
                  })),
                }
              : undefined,
          },
        ],
      },
      extra: context,
      tags: { function: functionName },
    });

    const envelope = [envelopeHeader, itemHeader, event].join('\n');

    await fetch(storeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': [
          'Sentry sentry_version=7',
          `sentry_key=${publicKey}`,
          'sentry_client=smart-ajo-edge/1.0',
        ].join(', '),
      },
      body: envelope,
    });
  } catch (sentryErr) {
    // Sentry delivery failures must never break production code paths.
    console.error(`[monitoring] Failed to send error to Sentry:`, sentryErr);
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a Monitor instance scoped to a specific edge function.
 *
 * @param functionName  Name used in log prefixes and Sentry tags (e.g. 'payout-process').
 */
export function createMonitor(functionName: string): Monitor {
  const prefix = `[${functionName}]`;
  const sentryDsn = Deno.env.get('SENTRY_DSN');

  return {
    info(message: string, context?: MonitorContext): void {
      if (context && Object.keys(context).length > 0) {
        console.log(`${prefix} ${message}`, JSON.stringify(context));
      } else {
        console.log(`${prefix} ${message}`);
      }
    },

    warn(message: string, context?: MonitorContext): void {
      if (context && Object.keys(context).length > 0) {
        console.warn(`${prefix} WARN ${message}`, JSON.stringify(context));
      } else {
        console.warn(`${prefix} WARN ${message}`);
      }
    },

    async error(
      message: string,
      err?: unknown,
      context: MonitorContext = {},
    ): Promise<void> {
      const { message: errMessage, stack } = extractErrorDetails(err);
      console.error(
        `${prefix} ERROR ${message}`,
        JSON.stringify({ error: errMessage, stack, ...context }),
      );

      if (sentryDsn) {
        await sendToSentry(sentryDsn, functionName, message, err, context);
      }
    },
  };
}
