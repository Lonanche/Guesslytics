import { DuelResponse, FeedResponse, RatingHistory } from '../types';
import { getModeKey, getStoredData, setStoredData, sleep } from './utils';

// --- Request Queue & Rate Limiting State ---

/** A queue to process API requests sequentially, preventing race conditions and simplifying rate-limiting. */
let requestQueue: (() => Promise<any>)[] = [];
let isProcessingQueue = false;

/** Global rate-limiting delay (in ms). If we get a 429, we increase this delay and let it cool down over time. */
let rateLimitDelay = 0;
const RATE_LIMIT_MAX_DELAY = 15000; // 15 seconds

// --- Queue Processing ---

/**
 * Processes the request queue sequentially.
 * Ensures that we only process one request at a time, respecting all delays.
 */
async function processRequestQueue() {
    if (isProcessingQueue || requestQueue.length === 0) return;
    isProcessingQueue = true;

    // Cool down the rate limit delay over time
    if (rateLimitDelay > 0) {
        rateLimitDelay = Math.max(0, rateLimitDelay - 100);
    }

    const nextRequest = requestQueue.shift();
    if (nextRequest) {
        try {
            await nextRequest();
        } catch (error) {
            console.error('Guesslytics: Request from queue failed', error);
        }
    }

    isProcessingQueue = false;
    // Process the next item in the queue after a short delay
    if (requestQueue.length > 0) {
        setTimeout(processRequestQueue, 100);
    }
}

/**
 * Adds a request to the processing queue.
 * @param requestFn A function that returns a Promise for the API request.
 * @returns A Promise that resolves with the result of the queued request.
 */
function enqueueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        requestQueue.push(() => requestFn().then(resolve).catch(reject));
        if (!isProcessingQueue) {
            processRequestQueue();
        }
    });
}

// --- Core API Fetching ---

/**
 * Executes the actual API request with retry logic and exponential backoff.
 * This function is called by the queue processor.
 * @param url The URL to fetch.
 * @param baseApiRequestDelay The base delay from user settings.
 * @param retries Number of retries for failed requests.
 * @param retryDelay Initial delay for retries, which will increase exponentially.
 * @returns A promise that resolves with the fetched data or null.
 */
async function executeRequest<T>(
    url: string,
    baseApiRequestDelay: number,
    retries: number = 3,
    retryDelay: number = 1000
): Promise<T | null> {
    // Apply the base delay + any rate-limiting delay before the request
    await sleep(baseApiRequestDelay + rateLimitDelay);

    for (let i = 0; i < retries; i++) {
        try {
            return await new Promise<T>((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    responseType: 'json',
                    timeout: 20000,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            resolve(res.response as T);
                        } else if (res.status === 429) {
                            reject(new Error(`API rate limit: ${res.status}`));
                        } else if (res.status >= 500) {
                            reject(new Error(`API server error: ${res.status}`));
                        } else {
                            // For other errors (e.g., 404), don't retry, just resolve null
                            resolve(null as T);
                        }
                    },
                    onerror: (err) => reject(new Error(`Network Error: ${JSON.stringify(err)}`)),
                    ontimeout: () => reject(new Error('Request timed out')),
                });
            });
        } catch (error: any) {
            const isRateLimit = error.message?.includes('429');
            if (isRateLimit) {
                // If we're rate-limited, significantly increase the delay
                rateLimitDelay = Math.min(RATE_LIMIT_MAX_DELAY, (rateLimitDelay || 2000) * 2);
                console.warn(`Guesslytics: Rate limited. Increasing delay to ${rateLimitDelay}ms.`);
                const statusEl = document.getElementById('guesslyticsStatus');
                if (statusEl) statusEl.innerHTML = `Rate limited, retrying...`;
            }

            if (i === retries - 1) {
                console.error('Guesslytics: API request failed after all retries.', { url, error: error.message });
                return null;
            }

            const currentRetryDelay = (isRateLimit ? Math.max(retryDelay, 3000) : retryDelay) + rateLimitDelay;
            console.warn(`Guesslytics: API request failed. Retrying in ${currentRetryDelay / 1000}s...`, error.message);
            await sleep(currentRetryDelay);
            retryDelay *= 2; // Exponential backoff for next retry
        }
    }
    return null;
}

/**
 * Fetches data from the GeoGuessr API by adding it to the request queue.
 * @param url The URL to fetch.
 * @param apiRequestDelay The base delay from user settings.
 * @returns A promise that resolves with the fetched data or null.
 */
export function fetchApi<T>(url: string, apiRequestDelay: number): Promise<T | null> {
    return enqueueRequest(() => executeRequest<T>(url, apiRequestDelay));
}

// --- Data Processing ---

/**
 * Recursively extracts all competitive duel games from the GeoGuessr feed.
 * The feed contains entries that can be single games or arrays of other entries (type 7).
 * This function traverses the potentially nested structure to find all relevant games.
 *
 * A game is considered a competitive duel if its `gameMode` is "Duels" and it has a
 * `competitiveGameMode` other than "None".
 *
 * @param entries An array of feed entries from the GeoGuessr API.
 * @returns A flattened array of competitive duel game activities.
 */
function extractDuelGamesFromFeed(entries: any[]): any[] {
    let games: any[] = [];

    for (const entry of entries) {
        try {
            // Type 7 is a container for an array of other entries which needs to be parsed and recursively processed.
            if (entry.type === 7 && typeof entry.payload === 'string') {
                const nestedEntries = JSON.parse(entry.payload);
                games = games.concat(extractDuelGamesFromFeed(nestedEntries));
            } else if (entry.type === 6) {
                // Type 6 is a direct game entry.
                const payload = typeof entry.payload === 'string' ? JSON.parse(entry.payload) : entry.payload;

                // A game is a competitive duel if the gameMode is "Duels" and it's ranked.
                const isCompetitiveDuel =
                    payload.gameMode === 'Duels' && payload.competitiveGameMode && payload.competitiveGameMode !== 'None';

                if (isCompetitiveDuel) {
                    // Reconstruct the game object to have a consistent format for processing.
                    games.push({ time: entry.time, payload });
                }
            }
        } catch (e) {
            console.warn('Guesslytics: Failed to parse feed entry payload.', { entry, error: e });
        }
    }

    return games;
}

/**
 * Processes games from feed entries, fetches duel data, and updates stored history.
 * @param rawEntries The raw feed entries from the API.
 * @param userId The current user's ID.
 * @param apiRequestDelay The base delay for API requests.
 * @returns A promise that resolves to true if new data was added.
 */
export async function processGames(
    rawEntries: any[],
    userId: string,
    apiRequestDelay: number
): Promise<boolean> {
    const storedData = await getStoredData();
    const existingGameIds = new Set(storedData.overall.map((g) => g.gameId));
    let newDataAdded = false;

    const duelGames = extractDuelGamesFromFeed(rawEntries);

    // Sort games by time (oldest first) to process in chronological order
    duelGames.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    for (const game of duelGames) {
        const gameId = game.payload.gameId;
        if (existingGameIds.has(gameId)) {
            continue; // Skip games we already have
        }

        const duel = await fetchApi<DuelResponse>(
            `https://game-server.geoguessr.com/api/duels/${gameId}`,
            apiRequestDelay
        );

        if (!duel) continue;

        const player = duel.teams.flatMap((t) => t.players).find((p) => p.playerId === userId);
        const progress = player?.progressChange?.rankedSystemProgress;

        if (progress) {
            const modeKey = getModeKey(progress.gameMode);
            const newEntry = { timestamp: game.time, gameId };

            if (progress.ratingAfter != null) {
                storedData.overall.push({ ...newEntry, rating: progress.ratingAfter });
            }
            if (modeKey && progress.gameModeRatingAfter != null) {
                storedData[modeKey].push({ ...newEntry, rating: progress.gameModeRatingAfter });
            }
            newDataAdded = true;
            existingGameIds.add(gameId);
        }
    }

    if (newDataAdded) {
        // Sort all datasets by timestamp to ensure chronological order
        for (const key in storedData) {
            storedData[key as keyof RatingHistory].sort(
                (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
        }
        await setStoredData(storedData);
    }

    return newDataAdded;
}

/**
 * Checks for new games since the last sync.
 * Fetches the first page of the feed and processes any new games.
 * @param userId The user's ID.
 * @param isManual Whether the sync was triggered manually.
 * @param apiRequestDelay The base delay for API requests.
 * @param setSyncState A callback to update the UI's sync status.
 * @returns A promise that resolves to true if new data was added.
 */
export async function checkForUpdates(
    userId: string,
    isManual: boolean,
    apiRequestDelay: number,
    setSyncState: (syncing: boolean, text?: string) => void
): Promise<boolean> {
    console.log(`Guesslytics: Checking for updates (Manual: ${isManual})`);
    setSyncState(true, isManual ? 'Syncing...' : '');

    try {
        const feedData = await fetchApi<FeedResponse>(
            'https://www.geoguessr.com/api/v4/feed/private',
            apiRequestDelay
        );

        if (!feedData) {
            setSyncState(false, 'Error');
            return false;
        }

        const newDataAdded = await processGames(feedData.entries, userId, apiRequestDelay);
        const statusText = newDataAdded ? '✓ Synced' : isManual ? '✓ Up to date' : '';
        setSyncState(false, statusText);

        // Update last sync timestamp
        const backfillState = await GM_getValue('guesslyticsBackfillState', {});
        await GM_setValue('guesslyticsBackfillState', { ...backfillState, lastSyncTimestamp: Date.now() });

        return newDataAdded;
    } catch (e) {
        console.error('Guesslytics: Background refresh failed.', e);
        setSyncState(false, 'Error');
        return false;
    }
}