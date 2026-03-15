/**
 * Safe logger utility that only logs in development mode.
 * Filters out sensitive data from logs.
 */

const isDev = import.meta.env.DEV;

export const logger = {
    log: (message: string, ...args: any[]) => {
        if (isDev) {
            console.log(`[APP] ${message}`, ...args);
        }
    },
    debug: (message: string, ...args: any[]) => {
        if (isDev) {
            console.debug(`[DEBUG] ${message}`, ...args);
        }
    },
    info: (message: string, ...args: any[]) => {
        if (isDev) {
            console.info(`[INFO] ${message}`, ...args);
        }
    },
    warn: (message: string, ...args: any[]) => {
        if (isDev) {
            console.warn(`[WARN] ${message}`, ...args);
        }
    },
    // Ensure console.error remains available
    error: (message: string, ...args: any[]) => {
        console.error(`[ERROR] ${message}`, ...args);
    }
};

export default logger;
