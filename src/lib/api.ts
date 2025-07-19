import { DuelResponse, FeedResponse, RatingEntry } from '../types';
import { getModeKey, getStoredData, setStoredData, sleep } from './utils';

/**
 * Fetch data from the GeoGuessr API
 */
export async function fetchApi<T>(
    url: string, 
    retries: number = 3, 
    delay: number = 1000,
    apiRequestDelay: number = 250
): Promise<T | null> {
    await sleep(apiRequestDelay);
    
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
                const statusEl = document.getElementById('guesslyticsStatus');
                if(statusEl) statusEl.innerHTML = `Rate limited, retrying...`;
            }
            
            if (i === retries - 1) {
                console.error("Guesslytics: API request failed after all retries.", error);
                return null;
            }
            
            console.warn(`Guesslytics: API request failed. Retrying in ${delay / 1000}s...`, error.message);
            await sleep(delay);
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
    const storedData = await getStoredData();
    const existingGameIds = new Set(
        Object.values(storedData)
            .flat()
            .map((d: RatingEntry) => d.gameId)
    );
    
    let newDataAdded = false;
    
    // Filter and parse game activities
    const gameActivities = rawEntries
        .filter(e => e.type === 7 && typeof e.payload === 'string')
        .flatMap(e => { 
            try { 
                return JSON.parse(e.payload); 
            } catch { 
                return []; 
            } 
        });
    
    // Filter duel games
    const duelGames = gameActivities.filter(
        g => g.type === 6 && 
        g.payload.competitiveGameMode && 
        g.payload.gameMode === "Duels"
    );
    
    // Process each duel game
    for (const game of duelGames) {
        const gameId = game.payload.gameId;
        if (existingGameIds.has(gameId)) continue;
        
        try {
            const duel = await fetchApi<DuelResponse>(
                `https://game-server.geoguessr.com/api/duels/${gameId}`,
                3,
                1000,
                apiRequestDelay
            );
            
            if (!duel) continue;
            
            const player = duel.teams
                .flatMap(t => t.players)
                .find(p => p.playerId === userId);
                
            const progress = player?.progressChange?.rankedSystemProgress;
            
            if (progress) {
                const modeKey = getModeKey(progress.gameMode);
                
                if (progress.ratingAfter != null) {
                    storedData.overall.push({ 
                        timestamp: game.time, 
                        rating: progress.ratingAfter, 
                        gameId: gameId 
                    });
                }
                
                if (modeKey && progress.gameModeRatingAfter != null) {
                    storedData[modeKey].push({ 
                        timestamp: game.time, 
                        rating: progress.gameModeRatingAfter, 
                        gameId: gameId 
                    });
                }
                
                newDataAdded = true;
            }
        } catch (e) { 
            console.error(`Guesslytics: Failed to process duel ${gameId}.`, e); 
        }
    }
    
    // Sort and save data if new data was added
    if (newDataAdded) {
        for (const key in storedData) {
            storedData[key].sort((a, b) => 
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
        }
        await setStoredData(storedData);
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
    setSyncState(true, isManual ? 'Syncing...' : '');
    
    try {
        const feedData = await fetchApi<FeedResponse>(
            'https://www.geoguessr.com/api/v4/feed/private',
            3,
            1000,
            apiRequestDelay
        );
        
        if (!feedData) {
            setSyncState(false, 'Error');
            return;
        }
        
        const newData = await processGames(feedData.entries, userId, apiRequestDelay);
        const statusText = newData ? '✓ Synced' : (isManual ? '✓ Up to date' : '');
        
        await GM_setValue('guesslyticsBackfillState', { 
            ...await GM_getValue('guesslyticsBackfillState', {}), 
            lastSyncTimestamp: Date.now() 
        });
        
        setSyncState(false, statusText);
    } catch (e) { 
        console.error("Guesslytics: Background refresh failed.", e); 
        setSyncState(false, 'Error'); 
    }
}
