import { DuelResponse, FeedResponse } from '../types';
import { getModeKey, getStoredData, setStoredData, sleep } from './utils';

// Global rate limiting state
let lastRateLimitTime = 0;
let currentApiDelay = 250; // Default delay, will be increased if rate limiting occurs

// Request queue to ensure sequential execution
let requestQueue: Promise<any> = Promise.resolve();
let isProcessingQueue = false;

/**
 * Fetch data from the GeoGuessr API
 */
export async function fetchApi<T>(
    url: string, 
    retries: number = 3, 
    delay: number = 1000,
    apiRequestDelay: number = 250
): Promise<T | null> {
    // Add this request to the queue to ensure sequential execution
    return new Promise<T | null>((resolveQueue) => {
        requestQueue = requestQueue.then(async () => {
            try {
                // Use the global rate limiting delay if it's higher than the requested delay
                const effectiveDelay = Math.max(apiRequestDelay, currentApiDelay);
                
                // Check if we need to wait longer due to recent rate limiting
                const timeSinceRateLimit = Date.now() - lastRateLimitTime;
                if (lastRateLimitTime > 0 && timeSinceRateLimit < 10000) {
                    // Add extra delay if we've been rate limited recently
                    const extraDelay = Math.min(5000, 10000 - timeSinceRateLimit);
                    console.log(`Guesslytics: Adding extra delay of ${extraDelay}ms due to recent rate limiting`);
                    await sleep(extraDelay);
                }
                
                // Apply the standard delay
                await sleep(effectiveDelay);
                
                // Gradually reduce the global delay over time if no rate limiting has occurred recently
                if (currentApiDelay > 250 && timeSinceRateLimit > 30000) {
                    // Reduce the delay by 10% every 30 seconds, but not below the default
                    currentApiDelay = Math.max(250, Math.floor(currentApiDelay * 0.9));
                    console.log(`Guesslytics: Reducing global delay to ${currentApiDelay}ms`);
                }
                
                // Set a flag to indicate we're processing a request
                isProcessingQueue = true;
                
                // Execute the actual request and resolve the queue promise
                const result = await executeRequest<T>(url, retries, delay);
                resolveQueue(result);
            } catch (error) {
                console.error("Guesslytics: Error in request queue", error);
                resolveQueue(null);
            } finally {
                // Clear the processing flag
                isProcessingQueue = false;
            }
        });
        
        // Return the promise that will be resolved when this request is processed
        return requestQueue;
    });
}

/**
 * Execute the actual API request
 */
async function executeRequest<T>(
    url: string, 
    retries: number = 3, 
    delay: number = 1000
): Promise<T | null> {
    
    for (let i = 0; i < retries; i++) {
        try {
            return await new Promise<T>((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', 
                    url, 
                    responseType: 'json', 
                    timeout: 15000,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            resolve(res.response as T);
                        } else if ([429, 500, 502, 503, 504].includes(res.status)) {
                            reject(new Error(`API temporary error: ${res.status}`));
                        } else {
                            resolve(null as T);
                        }
                    },
                    onerror: (err) => reject(new Error(`Network Error: ${err}`)),
                    ontimeout: () => reject(new Error('Request timed out'))
                });
            });
        } catch (error: any) {
            const isRateLimit = error.message?.includes('429');
            if (isRateLimit) {
                // Update global rate limiting state
                lastRateLimitTime = Date.now();
                currentApiDelay = Math.min(5000, currentApiDelay * 2); // Double the delay up to 5 seconds
                
                console.warn(`Guesslytics: Rate limited. Increasing global delay to ${currentApiDelay}ms`);
                
                const statusEl = document.getElementById('guesslyticsStatus');
                if(statusEl) statusEl.innerHTML = `Rate limited, retrying...`;
            }
            
            if (i === retries - 1) {
                console.error("Guesslytics: API request failed after all retries.", error);
                return null;
            }
            
            // Calculate retry delay - use a longer delay for rate limiting
            const retryDelay = isRateLimit ? Math.max(delay, 2000) : delay;
            console.warn(`Guesslytics: API request failed. Retrying in ${retryDelay / 1000}s...`, error.message);
            await sleep(retryDelay);
            delay *= 2;
        }
    }
    
    return null;
}

/**
 * Process games from feed entries
 */
export async function processGames(
    rawEntries: any[], 
    userId: string,
    apiRequestDelay: number
): Promise<boolean> {
    console.log("Guesslytics: Processing games from feed entries", { 
        entriesCount: rawEntries.length,
        timestamp: new Date().toISOString()
    });
    
    // Get stored data and create a map of existing game IDs for faster lookup
    const storedData = await getStoredData();
    const existingGameIds = new Set<string>();
    
    // Create a map of the most recent timestamp for each game mode
    const mostRecentTimestamps: Record<string, Date> = {
        overall: new Date(0),
        moving: new Date(0),
        noMove: new Date(0),
        nmpz: new Date(0)
    };
    
    // Populate the existing game IDs set and most recent timestamps
    for (const key in storedData) {
        const dataset = storedData[key];
        for (const entry of dataset) {
            existingGameIds.add(entry.gameId);
            
            // Update most recent timestamp for this mode
            const entryDate = new Date(entry.timestamp);
            if (entryDate > mostRecentTimestamps[key]) {
                mostRecentTimestamps[key] = entryDate;
            }
        }
    }
    
    console.log("Guesslytics: Existing game IDs", { 
        count: existingGameIds.size,
        mostRecentTimestamps: Object.fromEntries(
            Object.entries(mostRecentTimestamps).map(([k, v]) => [k, v.toISOString()])
        )
    });
    
    let newDataAdded = false;
    
    // Filter and parse game activities
    const gameActivities = rawEntries
        .filter(e => e.type === 7 && typeof e.payload === 'string')
        .flatMap(e => { 
            try { 
                return JSON.parse(e.payload); 
            } catch (err) { 
                console.error("Guesslytics: Failed to parse payload", err);
                return []; 
            } 
        });
    
    console.log("Guesslytics: Parsed game activities", { count: gameActivities.length });
    
    // Filter duel games
    const duelGames = gameActivities.filter(
        g => g.type === 6 && 
        g.payload.competitiveGameMode && 
        g.payload.gameMode === "Duels"
    );
    
    console.log("Guesslytics: Found duel games", { count: duelGames.length });
    
    // Sort games by timestamp (newest first) to prioritize processing recent games
    duelGames.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    
    // Process each duel game
    for (const game of duelGames) {
        const gameId = game.payload.gameId;
        const gameTime = new Date(game.time);
        
        console.log(`Guesslytics: Processing game ${gameId}`, { 
            time: gameTime.toISOString(),
            competitiveGameMode: game.payload.competitiveGameMode
        });
        
        // Skip if we already have this game
        if (existingGameIds.has(gameId)) {
            console.log(`Guesslytics: Game ${gameId} already exists, skipping`);
            continue;
        }
        
        // Skip if this game is older than our most recent overall game and we already have data
        // This optimization helps avoid processing older games unnecessarily
        if (storedData.overall.length > 0 && gameTime < mostRecentTimestamps.overall) {
            console.log(`Guesslytics: Game ${gameId} is older than most recent data, skipping`);
            continue;
        }
        
        try {
            console.log(`Guesslytics: Fetching duel data for game ${gameId}`);
            const duel = await fetchApi<DuelResponse>(
                `https://game-server.geoguessr.com/api/duels/${gameId}`,
                3,
                1000,
                apiRequestDelay
            );
            
            if (!duel) {
                console.log(`Guesslytics: No duel data found for game ${gameId}`);
                continue;
            }
            
            console.log(`Guesslytics: Duel data received for game ${gameId}`, { 
                teamsCount: duel.teams.length,
                playersCount: duel.teams.flatMap(t => t.players).length
            });
            
            const player = duel.teams
                .flatMap(t => t.players)
                .find(p => p.playerId === userId);
            
            if (!player) {
                console.log(`Guesslytics: Player ${userId} not found in game ${gameId}`);
                continue;
            }
            
            console.log(`Guesslytics: Found player in game ${gameId}`, { 
                hasProgressChange: !!player.progressChange,
                hasRankedSystemProgress: !!player.progressChange?.rankedSystemProgress
            });
                
            const progress = player.progressChange?.rankedSystemProgress;
            
            if (progress) {
                const modeKey = getModeKey(progress.gameMode);
                console.log(`Guesslytics: Progress data for game ${gameId}`, { 
                    gameMode: progress.gameMode,
                    modeKey,
                    ratingAfter: progress.ratingAfter,
                    gameModeRatingAfter: progress.gameModeRatingAfter
                });
                
                if (progress.ratingAfter != null) {
                    storedData.overall.push({ 
                        timestamp: game.time, 
                        rating: progress.ratingAfter, 
                        gameId: gameId 
                    });
                    console.log(`Guesslytics: Added overall rating for game ${gameId}`, { 
                        timestamp: game.time, 
                        rating: progress.ratingAfter
                    });
                }
                
                if (modeKey && progress.gameModeRatingAfter != null) {
                    storedData[modeKey].push({ 
                        timestamp: game.time, 
                        rating: progress.gameModeRatingAfter, 
                        gameId: gameId 
                    });
                    console.log(`Guesslytics: Added ${modeKey} rating for game ${gameId}`, { 
                        timestamp: game.time, 
                        rating: progress.gameModeRatingAfter
                    });
                }
                
                newDataAdded = true;
                
                // Update the most recent timestamps
                if (gameTime > mostRecentTimestamps.overall) {
                    mostRecentTimestamps.overall = gameTime;
                }
                if (modeKey && gameTime > mostRecentTimestamps[modeKey]) {
                    mostRecentTimestamps[modeKey] = gameTime;
                }
            } else {
                console.log(`Guesslytics: No progress data found for game ${gameId}`);
            }
        } catch (e) { 
            console.error(`Guesslytics: Failed to process duel ${gameId}.`, e); 
        }
    }
    
    // Sort and save data if new data was added
    if (newDataAdded) {
        console.log(`Guesslytics: New data added, sorting and saving`);
        for (const key in storedData) {
            storedData[key].sort((a, b) => 
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            console.log(`Guesslytics: Sorted ${key} data`, { 
                count: storedData[key].length,
                oldestTimestamp: storedData[key].length > 0 ? storedData[key][0].timestamp : 'none',
                newestTimestamp: storedData[key].length > 0 ? 
                    storedData[key][storedData[key].length - 1].timestamp : 'none'
            });
        }
        await setStoredData(storedData);
        console.log(`Guesslytics: Data saved successfully`);
    } else {
        console.log(`Guesslytics: No new data added`);
    }
    
    return newDataAdded;
}

/**
 * Check for updates from the feed
 */
export async function checkForUpdates(
    userId: string, 
    isManual: boolean = false,
    apiRequestDelay: number,
    setSyncState: (syncing: boolean, text?: string) => void
): Promise<void> {
    console.log(`Guesslytics: Checking for updates`, { 
        userId, 
        isManual,
        timestamp: new Date().toISOString()
    });
    
    setSyncState(true, isManual ? 'Syncing...' : '');
    
    try {
        // Get current stored data to check for the most recent game
        const storedData = await getStoredData();
        const mostRecentGame = storedData.overall.length > 0 ? 
            storedData.overall[storedData.overall.length - 1] : null;
        
        console.log(`Guesslytics: Most recent stored game`, { 
            exists: !!mostRecentGame,
            timestamp: mostRecentGame?.timestamp,
            gameId: mostRecentGame?.gameId
        });
        
        // Fetch the first page of feed data
        console.log(`Guesslytics: Fetching feed data`);
        const feedData = await fetchApi<FeedResponse>(
            'https://www.geoguessr.com/api/v4/feed/private',
            3,
            1000,
            apiRequestDelay
        );
        
        if (!feedData) {
            console.error(`Guesslytics: Failed to fetch feed data`);
            setSyncState(false, 'Error');
            return;
        }
        
        console.log(`Guesslytics: Feed data received`, { 
            entriesCount: feedData.entries.length,
            hasPaginationToken: !!feedData.paginationToken
        });
        
        // Process games from the first page
        console.log(`Guesslytics: Processing games from feed`);
        let newData = await processGames(feedData.entries, userId, apiRequestDelay);
        console.log(`Guesslytics: Games processed`, { newDataAdded: newData });
        
        // If no new data was found and we have a pagination token, check additional pages
        // We do this for both manual and automatic syncs to ensure we don't miss new games
        if (!newData && feedData.paginationToken) {
            console.log(`Guesslytics: No new data found in first page, checking more pages`);
            
            // Continue fetching pages until we find new data or run out of pages
            let paginationToken = feedData.paginationToken;
            let pagesProcessed = 1; // We already processed the first page
            // Limit pages to check based on whether this is a manual or automatic sync
            const maxPages = isManual ? 5 : 2; // More pages for manual, fewer for automatic to reduce API calls
            
            while (paginationToken && pagesProcessed < maxPages) {
                pagesProcessed++;
                
                console.log(`Guesslytics: Fetching additional page ${pagesProcessed}`);
                const nextPageData = await fetchApi<FeedResponse>(
                    `https://www.geoguessr.com/api/v4/feed/private?paginationToken=${paginationToken}`,
                    3,
                    1000,
                    apiRequestDelay
                );
                
                if (!nextPageData) break;
                
                const pageNewData = await processGames(nextPageData.entries, userId, apiRequestDelay);
                newData = newData || pageNewData;
                
                console.log(`Guesslytics: Additional page processed`, { 
                    page: pagesProcessed, 
                    newDataAdded: pageNewData,
                    hasMorePages: !!nextPageData.paginationToken
                });
                
                // If we found new data or there's no more pages, stop
                if (pageNewData || !nextPageData.paginationToken) break;
                
                paginationToken = nextPageData.paginationToken;
            }
        }
        
        const statusText = newData ? '✓ Synced' : (isManual ? '✓ Up to date' : '');
        
        console.log(`Guesslytics: Updating backfill state`);
        await GM_setValue('guesslyticsBackfillState', { 
            ...await GM_getValue('guesslyticsBackfillState', {}), 
            lastSyncTimestamp: Date.now() 
        });
        
        console.log(`Guesslytics: Update complete`, { statusText });
        setSyncState(false, statusText);
    } catch (e) { 
        console.error("Guesslytics: Background refresh failed.", e); 
        setSyncState(false, 'Error'); 
    }
}
