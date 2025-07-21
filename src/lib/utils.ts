import { RatingHistory, Settings } from '../types';
import { DEFAULT_SETTINGS, RATING_HISTORY_KEY, SETTINGS_KEY } from './constants';

// --- Logger and Error Handling ---

/**
 * A simple logger class to handle verbose logging based on user settings.
 * This class provides a simple way to toggle verbose output without adding external dependencies.
 */
class Logger {
    private enabled = false;

    /**
     * Sets the logging level.
     * @param enabled Whether verbose logging should be enabled.
     */
    setLogging(enabled: boolean) {
        this.enabled = enabled;
    }

    /**
     * Logs a message to the console if verbose logging is enabled.
     * @param message The message to log.
     * @param data Optional data to log with the message.
     */
    log(message: string, data?: any) {
        if (this.enabled) {
            if (data) {
                console.log(`[Guesslytics] ${message}`, data);
            } else {
                console.log(`[Guesslytics] ${message}`);
            }
        }
    }

    /**
     * Logs an error message to the console.
     * This is always logged regardless of the verbose setting.
     * @param message The error message to log.
     * @param error The error object or message.
     */
    error(message: string, error?: any) {
        const errorMessage = error instanceof Error ? error.message : error;
        console.error(`[Guesslytics] ERROR: ${message}`, errorMessage || '');
    }
}

export const logger = new Logger();

/**
 * Standardized error handling function.
 * This function logs the error and optionally updates the UI status.
 * @param error The error object or message.
 * @param context Additional context about where the error occurred.
 * @param options Additional options for error handling.
 */
export function handleError(
    error: any, 
    context: string,
    options?: {
        setSyncState?: (syncing: boolean, text?: string, settings?: any, callback?: () => Promise<void>) => void;
        settings?: any;
        callback?: () => Promise<void>;
        silent?: boolean;
    }
): void {
    const errorMessage = error instanceof Error ? error.message : error;
    
    // Log the error
    logger.error(`${context}: ${errorMessage || 'Unknown error'}`, error);
    
    // Update UI status if setSyncState is provided
    if (options?.setSyncState && !options.silent) {
        options.setSyncState(false, 'Error during operation', options.settings, options.callback);
    }
}

// --- User Settings ---

/**
 * Loads user settings from storage, merging them with defaults to ensure all keys are present.
 * @returns A promise that resolves with the loaded settings.
 */
export async function loadSettings(): Promise<Settings> {
    const loaded = await GM_getValue(SETTINGS_KEY, DEFAULT_SETTINGS);
    const settings = {
        ...DEFAULT_SETTINGS,
        ...loaded,
        visibleDatasets: {
            ...DEFAULT_SETTINGS.visibleDatasets,
            ...loaded.visibleDatasets,
        },
    };
    // Initialize the logger with the loaded setting.
    logger.setLogging(settings.verboseLogging);
    return settings;
}

// --- Page & Data Utilities ---

/**
 * Waits for a condition to be true before resolving a promise.
 * This is useful for waiting for elements to appear in the DOM in single-page applications.
 * @param condition The condition to wait for.
 * @param timeout The maximum time to wait (in ms).
 * @returns A promise that resolves when the condition is met.
 */
export function waitForReady(condition: () => boolean, timeout = 20000): Promise<void> {
    return new Promise((resolve, reject) => {
        const interval = setInterval(() => {
            if (condition()) {
                clearInterval(interval);
                resolve();
            }
        }, 200);
        setTimeout(() => {
            clearInterval(interval);
            const error = new Error('Timed out waiting for page element.');
            handleError(error, 'Page initialization', { silent: true });
            reject(error);
        }, timeout);
    });
}

/**
 * Pauses execution for a specified number of milliseconds.
 * @param ms The number of milliseconds to sleep.
 */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Formats a timestamp into a localized string.
 * @param ts The timestamp to format (string or number).
 * @returns The formatted date string, or 'N/A' if the timestamp is invalid.
 */
export const formatDate = (ts?: string | number): string => (ts ? new Date(ts).toLocaleString() : 'N/A');

/**
 * Gets the current user's ID from the page's `__NEXT_DATA__` script tag.
 * This is a common way to access page data in Next.js applications.
 * @returns The user ID, or null if not found.
 */
export function getUserId(): string | null {
    try {
        return (
            JSON.parse(document.getElementById('__NEXT_DATA__')?.innerHTML || '{}')?.props?.accountProps?.account?.user
                ?.userId || null
        );
    } catch (error) {
        handleError(error, 'Failed to get user ID from page data', { silent: true });
        return null;
    }
}

/**
 * Retrieves the stored rating history from GM storage.
 * @returns A promise that resolves with the rating history.
 */
export async function getStoredData(): Promise<RatingHistory> {
    const data = await GM_getValue(RATING_HISTORY_KEY);
    if (!data) {
        return { overall: [], moving: [], noMove: [], nmpz: [] };
    }
    return data as RatingHistory;
}

/**
 * Saves the rating history to GM storage.
 * @param data The rating history to save.
 */
export async function setStoredData(data: RatingHistory): Promise<void> {
    await GM_setValue(RATING_HISTORY_KEY, data);
}

/**
 * Maps the competitive game mode from the API to a key used in the RatingHistory object.
 * This allows us to store data for different game modes in separate arrays.
 * @param competitiveGameMode The competitive game mode string from the API.
 * @returns The corresponding key, or null if not found.
 */
export function getModeKey(competitiveGameMode: string): keyof RatingHistory | null {
    if (competitiveGameMode === 'StandardDuels') return 'moving';
    if (competitiveGameMode === 'NoMoveDuels') return 'noMove';
    if (competitiveGameMode === 'NmpzDuels') return 'nmpz';
    return null;
}
