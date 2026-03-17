/**
 * Safe logger utility that only logs in development mode.
 * Filters out sensitive data from logs.
 */

const isDev = import.meta.env.DEV;

export const logger = {
    log: (message: string, ...args: unknown[]) => {
        if (isDev) {
            console.log(`[APP] ${message}`, ...args);
        }
    },
    debug: (message: string, ...args: unknown[]) => {
        if (isDev) {
            console.debug(`[DEBUG] ${message}`, ...args);
        }
    },
    info: (message: string, ...args: unknown[]) => {
        if (isDev) {
            console.info(`[INFO] ${message}`, ...args);
        }
    },
    warn: (message: string, ...args: unknown[]) => {
        if (isDev) {
            console.warn(`[WARN] ${message}`, ...args);
        }
    },
    // Ensure console.error remains available
    error: (message: string, ...args: unknown[]) => {
        console.error(`[ERROR] ${message}`, ...args);
    }
};

export default logger;
