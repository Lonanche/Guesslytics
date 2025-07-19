import { RatingHistory, Settings } from '../types';
import { DEFAULT_SETTINGS, RATING_HISTORY_KEY, SETTINGS_KEY } from './constants';

/**
 * Loads user settings from storage
 */
export async function loadSettings(): Promise<Settings> {
    const loaded = await GM_getValue(SETTINGS_KEY, DEFAULT_SETTINGS);
    return { 
        ...DEFAULT_SETTINGS, 
        ...loaded, 
        visibleDatasets: { 
            ...DEFAULT_SETTINGS.visibleDatasets, 
            ...loaded.visibleDatasets 
        }
    };
}

/**
 * Waits for a condition to be true
 */
export function waitForReady(condition: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
        const interval = setInterval(() => { 
            if (condition()) { 
                clearInterval(interval); 
                resolve(); 
            } 
        }, 200);
        setTimeout(() => { 
            clearInterval(interval); 
            reject(new Error("Guesslytics: Timed out.")); 
        }, 20000);
    });
}

/**
 * Sleep for a specified number of milliseconds
 */
export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Format a timestamp as a localized string
 */
export const formatDate = (ts?: string | number): string => ts ? new Date(ts).toLocaleString() : 'N/A';

/**
 * Get the user ID from the page
 */
export function getUserId(): string | null {
    try { 
        return JSON.parse(
            document.getElementById('__NEXT_DATA__')?.innerHTML || '{}'
        )?.props?.accountProps?.account?.user?.userId || null;
    // eslint-disable-next-line no-unused-vars
    } catch (_) { 
        return null; 
    }
}

/**
 * Get stored rating data
 */
export async function getStoredData(): Promise<RatingHistory> { 
    return await GM_getValue(RATING_HISTORY_KEY, { 
        overall: [], 
        moving: [], 
        noMove: [], 
        nmpz: [] 
    }); 
}

/**
 * Save rating data to storage
 */
export async function setStoredData(data: RatingHistory): Promise<void> { 
    await GM_setValue(RATING_HISTORY_KEY, data); 
}

/**
 * Get the mode key from competitive game mode
 */
export function getModeKey(competitiveGameMode: string): string | null {
    if (competitiveGameMode === "StandardDuels") return "moving";
    if (competitiveGameMode === "NoMoveDuels") return "noMove";
    if (competitiveGameMode === "NmpzDuels") return "nmpz";
    return null;
}
