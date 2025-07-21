import { DuelResponse, FeedResponse, RatingHistory } from '../types';
import { getModeKey, getStoredData, handleError, logger, setStoredData, sleep } from './utils';
import { BACKFILL_STATE_KEY } from './constants';
import { renderGraph } from './ui';

// --- Request Queue & Rate Limiting State ---

/**
 * A queue to process API requests sequentially, preventing race conditions and simplifying rate-limiting.
 * This ensures that requests are processed one at a time in the order they were added.
 */
let requestQueue: (() => Promise<any>)[] = [];

/**
 * Flag to indicate whether the queue is currently being processed.
 * This prevents multiple concurrent processing of the queue.
 */
let isProcessingQueue = false;

/**
 * Global rate-limiting delay (in ms). If we get a 429 response, we increase this delay
 * and let it cool down over time to prevent further rate limiting.
 */
let rateLimitDelay = 0;

/**
 * Maximum delay to apply for rate limiting (15 seconds).
 * This caps the exponential backoff to prevent excessive delays.
 */
const RATE_LIMIT_MAX_DELAY = 15000;

// --- Queue Processing ---

/**
 * Processes the request queue sequentially.
 * Ensures that we only process one request at a time, respecting all delays.
 * This function is called automatically when a request is added to the queue
 * and will continue processing until the queue is empty.
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
            handleError(error, 'Request from queue failed', { silent: true });
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
 * This function wraps API requests in a queue to ensure they are processed sequentially,
 * which helps prevent rate limiting and race conditions.
 * 
 * @template T The expected return type of the request
 * @param requestFn A function that returns a Promise for the API request.
 * @returns A Promise that resolves with the result of the queued request or rejects with any error.
 * 
 * @example
 * // Example usage:
 * const data = await enqueueRequest(() => fetchApi('https://example.com/api', 250));
 */
function enqueueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        // Add the request to the queue, with proper error handling
        requestQueue.push(() => requestFn().then(resolve).catch(reject));
        
        // Start processing the queue if it's not already being processed
        if (!isProcessingQueue) {
            processRequestQueue();
        }
    });
}

// --- Core API Fetching ---

/**
 * Executes the actual API request with retry logic and exponential backoff.
 * This function is called by the queue processor and handles all the details of making
 * an API request, including retries, rate limiting, and error handling.
 * 
 * Key features:
 * - Applies configurable delays between requests to prevent rate limiting
 * - Implements exponential backoff for retries
 * - Handles different types of errors differently (rate limiting vs. server errors)
 * - Provides detailed logging for debugging
 * 
 * @template T The expected return type of the request
 * @param url The URL to fetch.
 * @param baseApiRequestDelay The base delay from user settings (in milliseconds).
 * @param retries Number of retries for failed requests (default: 3).
 * @param retryDelay Initial delay for retries in milliseconds, which will increase exponentially (default: 1000).
 * @returns A promise that resolves with the fetched data or null if the request fails after all retries.
 */
async function executeRequest<T>(
    url: string,
    baseApiRequestDelay: number,
    retries: number = 3,
    retryDelay: number = 1000
): Promise<T | null> {
    logger.log(`Executing request`, { url, baseApiRequestDelay, retries, retryDelay });
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
                        logger.log(`Request onload`, { url, status: res.status });
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
                logger.log(`Rate limited. Increasing delay to ${rateLimitDelay}ms.`);
                const statusEl = document.getElementById('guesslyticsStatus');
                if (statusEl) statusEl.innerHTML = `Rate limited, retrying...`;
            }

            if (i === retries - 1) {
                handleError(error, `API request failed after all retries for ${url}`, { silent: true });
                return null;
            }

            const currentRetryDelay = (isRateLimit ? Math.max(retryDelay, 3000) : retryDelay) + rateLimitDelay;
            logger.log(`API request failed. Retrying in ${currentRetryDelay / 1000}s...`, { error: error.message });
            await sleep(currentRetryDelay);
            retryDelay *= 2; // Exponential backoff for next retry
        }
    }
    return null;
}

/**
 * Fetches data from the GeoGuessr API by adding it to the request queue.
 * This is the main API function that should be used throughout the application.
 * It handles queuing, rate limiting, retries, and error handling automatically.
 * 
 * @template T The expected return type of the API response
 * @param url The URL to fetch from the GeoGuessr API.
 * @param apiRequestDelay The base delay between requests from user settings (in milliseconds).
 * @returns A promise that resolves with the fetched data or null if the request fails.
 * 
 * @example
 * // Example usage:
 * const duelData = await fetchApi<DuelResponse>(`https://game-server.geoguessr.com/api/duels/${gameId}`, 250);
 * if (duelData) {
 *   // Process the data
 * }
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
    logger.log('Extracting duel games from feed', { entries });

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
        } catch (error) {
            handleError(error, 'Failed to parse feed entry payload', { silent: true });
        }
    }

    logger.log('Finished extracting duel games', { games });
    return games;
}

/**
 * Processes games from feed entries, fetches duel data, and updates stored history.
 * @param rawEntries The raw feed entries from the API.
 * @param userId The current user's ID.
 * @param apiRequestDelay The base delay for API requests.
 * @param onGameProcessed Optional callback that's called when a new game is processed.
 * @param existingGameIds Game IDs that exist lol
 * @returns A promise that resolves to true if new data was added.
 */
export async function processGames(
    rawEntries: any[],
    userId: string,
    apiRequestDelay: number,
    onGameProcessed?: () => Promise<void>,
    existingGameIds?: Set<string>
): Promise<{ newDataAdded: boolean; foundExistingGame: boolean }> {
    logger.log('Processing games from feed entries', { rawEntries });
    const storedData = await getStoredData();
    
    // Use provided existingGameIds if available, otherwise create a new set
    const gameIds = existingGameIds || new Set(storedData.overall.map((g) => g.gameId));
    let newDataAdded = false;
    let foundExistingGame = false;

    const duelGames = extractDuelGamesFromFeed(rawEntries);

    // Sort games by time (newest first) to process in reverse chronological order
    duelGames.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    for (const game of duelGames) {
        const gameId = game.payload.gameId;
        if (gameIds.has(gameId)) {
            logger.log(`Found existing game in database`, { gameId });
            foundExistingGame = true;
            continue;
        }

        logger.log(`Fetching duel data for game`, { gameId });
        const duel = await fetchApi<DuelResponse>(
            `https://game-server.geoguessr.com/api/duels/${gameId}`,
            apiRequestDelay
        );

        if (!duel) {
            logger.log(`No duel data found for game`, { gameId });
            continue;
        }

        const player = duel.teams.flatMap((t) => t.players).find((p) => p.playerId === userId);
        const progress = player?.progressChange?.rankedSystemProgress;

        if (progress) {
            logger.log(`Found progress for game`, { gameId, progress });
            const modeKey = getModeKey(progress.gameMode);
            const newEntry = { timestamp: game.time, gameId };

            if (progress.ratingAfter != null) {
                storedData.overall.push({ ...newEntry, rating: progress.ratingAfter });
            }
            if (modeKey && progress.gameModeRatingAfter != null) {
                storedData[modeKey].push({ ...newEntry, rating: progress.gameModeRatingAfter });
            }
            newDataAdded = true;
            gameIds.add(gameId);
            
            // Sort and save after each game is processed
            for (const key in storedData) {
                storedData[key as keyof RatingHistory].sort(
                    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                );
            }
            await setStoredData(storedData);
            
            // Call the callback if provided
            if (onGameProcessed) {
                await onGameProcessed();
            }
        }
    }

    return { newDataAdded, foundExistingGame };
}

/**
 * Processes feed pages to find and process games.
 * This is a common helper function used by both backfillHistory and checkForUpdates.
 * @param userId The user's ID.
 * @param apiRequestDelay The base delay for API requests.
 * @param options Additional options for processing.
 * @returns A promise that resolves to an object with the results of the processing.
 */
export async function processFeedPages(
    userId: string,
    apiRequestDelay: number,
    options: {
        initialUrl?: string;
        maxPages?: number;
        cutoffDate?: Date;
        onGameProcessed?: () => Promise<void>;
    }
): Promise<{ newDataAdded: boolean; reachedEnd: boolean; pagesProcessed: number }> {
    // Extract options with defaults
    const {
        initialUrl = 'https://www.geoguessr.com/api/v4/feed/private',
        maxPages = 500,
        cutoffDate,
        onGameProcessed
    } = options;

    // Initialize state variables
    let paginationToken: string | undefined;
    let newDataAdded = false;
    let pagesProcessed = 0;
    let reachedEnd = false;
    let foundExistingGame = false;
    
    // Get existing game IDs from stored data
    const storedData = await getStoredData();
    const existingGameIds = new Set(storedData.overall.map((g) => g.gameId));
    
    // Get backfill state
    const backfillState = await GM_getValue(BACKFILL_STATE_KEY, { lastLimitDays: 0, lastSyncTimestamp: null, ended: false });
    
    logger.log('Starting feed processing', { 
        backfillStateEnded: backfillState.ended,
        existingGamesCount: existingGameIds.size,
        hasCutoffDate: !!cutoffDate,
        cutoffDate: cutoffDate ? cutoffDate.toISOString() : 'none'
    });

    // --- Process first page ---
    const initialFeed = await fetchApi<FeedResponse>(initialUrl, apiRequestDelay);
    if (!initialFeed) {
        logger.log('Failed to fetch initial feed page.');
        return { newDataAdded, reachedEnd, pagesProcessed };
    }

    // Process games from first page
    const firstPageResult = await processGames(initialFeed.entries, userId, apiRequestDelay, onGameProcessed, existingGameIds);
    newDataAdded = firstPageResult.newDataAdded;
    foundExistingGame = firstPageResult.foundExistingGame;

    // Check if we reached the end of the feed
    paginationToken = initialFeed.paginationToken;
    if (!paginationToken) {
        logger.log('Reached the end of the feed on the first page.');
        reachedEnd = true;
        return { newDataAdded, reachedEnd, pagesProcessed };
    }

    // Check if we should stop after the first page
    if (foundExistingGame && backfillState.ended) {
        logger.log('Found existing game on first page and history end was reached. Stopping feed processing.');
        return { newDataAdded, reachedEnd: true, pagesProcessed };
    }

    // Check if we've passed the cutoff date already
    if (cutoffDate) {
        const currentData = await getStoredData();
        const oldestGame = currentData.overall[0];
        if (oldestGame && new Date(oldestGame.timestamp) < cutoffDate) {
            logger.log(`Reached cutoff date after first page. Stopping feed processing.`, { 
                cutoffDate: cutoffDate.toISOString(),
                oldestGameDate: oldestGame ? new Date(oldestGame.timestamp).toISOString() : 'N/A'
            });
            return { newDataAdded, reachedEnd: false, pagesProcessed };
        }
    }

    // --- Process subsequent pages ---
    while (paginationToken && pagesProcessed < maxPages) {
        // Stop if we found an existing game and history end was reached
        if (foundExistingGame && backfillState.ended) {
            logger.log('Found existing game and history end was reached. Stopping feed processing.');
            break;
        }
        
        pagesProcessed++;
        logger.log(`Processing feed page ${pagesProcessed}`);

        // Fetch next page
        const feedData = await fetchApi<FeedResponse>(
            `https://www.geoguessr.com/api/v4/feed/private?paginationToken=${paginationToken}`,
            apiRequestDelay
        );

        if (!feedData) {
            logger.log(`No feed data on page ${pagesProcessed}, stopping.`);
            break;
        }

        // Process games from this page
        const pageResult = await processGames(feedData.entries, userId, apiRequestDelay, onGameProcessed, existingGameIds);
        if (pageResult.newDataAdded) {
            newDataAdded = true;
        }
        
        if (pageResult.foundExistingGame) {
            foundExistingGame = true;
            logger.log('Found existing game on page', { 
                page: pagesProcessed, 
                backfillStateEnded: backfillState.ended
            });
            
            // If history end was reached, stop processing
            if (backfillState.ended) {
                logger.log('Found existing game and history end was reached. Stopping feed processing.');
                break;
            }
        }

        // Check if we've passed the cutoff date
        if (cutoffDate) {
            const currentData = await getStoredData();
            const oldestGame = currentData.overall[0];
            if (oldestGame && new Date(oldestGame.timestamp) < cutoffDate) {
                logger.log(`Reached cutoff date. Stopping feed processing.`, { 
                    cutoffDate: cutoffDate.toISOString(),
                    oldestGameDate: oldestGame ? new Date(oldestGame.timestamp).toISOString() : 'N/A'
                });
                // We're stopping due to cutoff date, not because we reached the end
                reachedEnd = false;
                break;
            }
        }

        // Check if we've reached the end of the feed
        paginationToken = feedData.paginationToken;
        if (!paginationToken) {
            logger.log('Reached the end of the feed.');
            reachedEnd = true;
            break;
        }

        await sleep(apiRequestDelay);
    }

    // Log completion
    logger.log('Completed feed processing', { 
        pagesProcessed, 
        newDataAdded, 
        reachedEnd, 
        foundExistingGame,
        backfillStateEnded: backfillState.ended,
        stoppedDueToCutoff: cutoffDate ? 'possibly' : 'no'
    });
    
    return { newDataAdded, reachedEnd, pagesProcessed };
}

/**
 * Checks for new games since the last sync.
 * Fetches pages from the feed until it finds a game that is already in the database.
 * When history end was reached, it only searches until the first existing timestamp.
 * If end was not reached yet, it continues until end of feed or date limit.
 * @param userId The user's ID.
 * @param apiRequestDelay The base delay for API requests.
 * @param setSyncState A callback to update the UI's sync status.
 * @returns A promise that resolves to true if new data was added.
 */
/**
 * Common function to sync rating history, used by both backfillHistory and checkForUpdates.
 * @param userId The user's ID.
 * @param apiRequestDelay The base delay for API requests.
 * @param setSyncState A callback to update the UI's sync status.
 * @param settings The user's current settings.
 * @param callback The callback to call after sync operations.
 * @param options Additional options to customize the sync behavior.
 * @returns A promise that resolves to an object with the results of the sync operation.
 */
export async function syncRatingHistory(
    userId: string,
    apiRequestDelay: number,
    setSyncState: (syncing: boolean, text?: string, settings?: any, callback?: () => Promise<void>) => void,
    settings: any,
    callback: () => Promise<void>,
    options: {
        isBackfill?: boolean;
        logPrefix?: string;
    } = {}
): Promise<{ newDataAdded: boolean; reachedEnd: boolean; pagesProcessed: number }> {
    const { isBackfill = false, logPrefix = 'Sync' } = options;

    logger.log(`${logPrefix}: Starting operation`);

    setSyncState(
        true, 
        `Syncing...`,
        settings, 
        callback
    );

    try {
        const backfillState = await GM_getValue(BACKFILL_STATE_KEY, { lastLimitDays: 0, lastSyncTimestamp: null, ended: false });
        
        // Calculate cutoff date if not doing a full history sync
        const cutoffDate = !settings.backfillFullHistory ? new Date() : undefined;
        if (cutoffDate) {
            cutoffDate.setDate(cutoffDate.getDate() - settings.backfillDays);
            logger.log(`${logPrefix}: Using cutoff date`, { 
                cutoffDate: cutoffDate.toISOString(),
                backfillDays: settings.backfillDays
            });
        }
        
        // Process feed pages
        const result = await processFeedPages(userId, apiRequestDelay, {
            cutoffDate,
            onGameProcessed: async () => {
                // Render graph and update status after each game
                const data = await getStoredData();
                await renderGraph(data, settings);
                
                // Update status with current progress
                const oldestGame = data.overall[0];
                setSyncState(
                    true, 
                    `Syncing (${new Date(oldestGame.timestamp).toLocaleDateString()})...`, 
                    settings, 
                    callback
                );
            },
        });

        const { newDataAdded, reachedEnd, pagesProcessed } = result;
        
        logger.log(`${logPrefix}: Operation completed`, { 
            newDataAdded, 
            reachedEnd, 
            pagesProcessed,
            backfillStateEnded: backfillState.ended
        });

        // Set final status message with the same format as during sync
        const finalData = await getStoredData();
        
        
        // Different status message based on operation type and result
        setSyncState(false, `✓ Up-to-date`, settings, callback);

        // Update backfill state
        await GM_setValue(BACKFILL_STATE_KEY, {
            lastLimitDays: settings.backfillFullHistory ? 9999 : settings.backfillDays,
            lastSyncTimestamp: Date.now(),
            ended: isBackfill ? reachedEnd : (reachedEnd ? true : backfillState.ended),
        });

        // Render final graph
        await renderGraph(finalData, settings);

        return result;
    } catch (error) {
        handleError(error, `${logPrefix}: Operation failed`, {
            setSyncState,
            settings,
            callback
        });
        return { newDataAdded: false, reachedEnd: false, pagesProcessed: 0 };
    }
}

/**
 * Checks for updates by synchronizing rating history for a specified user.
 *
 * @param {string} userId - The unique identifier of the user for whom updates are being checked.
 * @param {number} apiRequestDelay - The delay (in milliseconds) between API requests.
 * @param {function} setSyncState - A callback function to set the sync state, optionally providing text, settings, and an additional callback.
 * @param {any} settings - Configuration settings used during the update process.
 * @param {function} callback - A callback function to execute additional logic after the synchronization process.
 * @return {Promise<boolean>} A promise that resolves to a boolean indicating whether new data was added during the update check.
 */
export async function checkForUpdates(
    userId: string,
    apiRequestDelay: number,
    setSyncState: (syncing: boolean, text?: string, settings?: any, callback?: () => Promise<void>) => void,
    settings: any,
    callback: () => Promise<void>
): Promise<boolean> {
    const result = await syncRatingHistory(userId, apiRequestDelay, setSyncState, settings, callback, {
        isBackfill: false,
        logPrefix: 'Update check'
    });
    
    return result.newDataAdded;
}
