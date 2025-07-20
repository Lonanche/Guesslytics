import { checkForUpdates, fetchApi, processGames } from './lib/api';
import { BACKFILL_STATE_KEY, DEFAULT_SETTINGS, SETTINGS_KEY } from './lib/constants';
import { renderGraph, renderSettingsPanel, setSyncState, setupUI, startRefreshCycle } from './lib/ui';
import { getStoredData, getUserId, loadSettings, setStoredData, sleep, waitForReady } from './lib/utils';
import { BackfillState, FeedResponse, Settings } from './types';

/**
 * Guesslytics - GeoGuessr Rating Tracker
 * Tracks your GeoGuessr competitive duel ratings over time and displays it in a graph.
 */
(async () => {
    'use strict';

    // --- STATE & SETTINGS ---
    let settings: Settings = { ...DEFAULT_SETTINGS };
    // Flags to prevent multiple initializations and concurrent operations
    let isInitialized = false;
    let isBackfilling = false;

    /**
     * Backfill history from the feed
     */
    async function backfillHistory(userId: string, initialToken: string): Promise<void> {
        // Check if already backfilling to prevent concurrent backfill operations
        if (isBackfilling) {
            console.log('Guesslytics: Backfill already in progress, skipping');
            return;
        }
        
        console.log(`Guesslytics: Starting backfill history`, {
            fullHistory: settings.backfillFullHistory,
            daysLimit: settings.backfillDays,
            initialToken: initialToken
        });
        
        // Set the backfilling flag
        isBackfilling = true;
        setSyncState(true);
        let paginationToken = initialToken;
        let pagesProcessed = 0;
        const cutoffDate = new Date();
        let newDataFound = false;
        
        if (!settings.backfillFullHistory) {
            cutoffDate.setDate(cutoffDate.getDate() - settings.backfillDays);
            console.log(`Guesslytics: Backfill cutoff date set to`, {
                date: cutoffDate.toISOString(),
                daysBack: settings.backfillDays
            });
        } else {
            console.log(`Guesslytics: Full history backfill enabled, no cutoff date`);
        }
        
        // Get current stored data to check for the oldest game
        const initialData = await getStoredData();
        console.log(`Guesslytics: Initial data stats`, {
            totalGames: initialData.overall.length,
            oldestGame: initialData.overall.length > 0 ? initialData.overall[0].timestamp : 'none',
            newestGame: initialData.overall.length > 0 ? 
                initialData.overall[initialData.overall.length - 1].timestamp : 'none'
        });
        
        while (paginationToken && pagesProcessed < 200) {
            pagesProcessed++;
            
            try {
                console.log(`Guesslytics: Fetching backfill page ${pagesProcessed}`);
                const feedData = await fetchApi<FeedResponse>(
                    `https://www.geoguessr.com/api/v4/feed/private?paginationToken=${paginationToken}`,
                    3,
                    1000,
                    settings.apiRequestDelay
                );
                
                if (!feedData) {
                    console.log(`Guesslytics: No feed data returned, stopping backfill`);
                    break;
                }
                
                console.log(`Guesslytics: Processing backfill page ${pagesProcessed}`, {
                    entriesCount: feedData.entries.length,
                    hasPaginationToken: !!feedData.paginationToken
                });
                
                const pageNewData = await processGames(feedData.entries, userId, settings.apiRequestDelay);
                newDataFound = newDataFound || pageNewData;
                
                const currentData = await getStoredData();
                const oldestDate = currentData.overall.length > 0 ? 
                    new Date(currentData.overall[0].timestamp).toLocaleDateString() : '';
                
                setSyncState(true, `Syncing... (${currentData.overall.length} found, to ${oldestDate})`);
                renderGraph(currentData, settings);
                
                // Check if we've reached the cutoff date
                const oldestGame = currentData.overall[0];
                if (!settings.backfillFullHistory && oldestGame && new Date(oldestGame.timestamp) < cutoffDate) {
                    console.log(`Guesslytics: Reached cutoff date, stopping backfill`, {
                        oldestGameDate: new Date(oldestGame.timestamp).toISOString(),
                        cutoffDate: cutoffDate.toISOString()
                    });
                    break;
                }
                
                // If we didn't find any new data in this page and we're not doing a full history sync,
                // we can stop to avoid unnecessary API calls
                if (!pageNewData && !settings.backfillFullHistory && pagesProcessed > 1) {
                    console.log(`Guesslytics: No new data found in page ${pagesProcessed}, stopping backfill`);
                    break;
                }
                
                paginationToken = feedData.paginationToken;
                
                // If there's no pagination token, we've reached the end of the feed
                if (!paginationToken) {
                    console.log(`Guesslytics: No more pagination tokens, reached end of feed`);
                }
                
                // Add additional delay between pages to avoid rate limiting
                // This is in addition to the delay in fetchApi
                await sleep(1000);
            } catch (e) { 
                console.error('Guesslytics: Failed to fetch a history page.', e); 
                break; 
            }
        }
        
        console.log(`Guesslytics: Backfill complete`, {
            pagesProcessed,
            newDataFound,
            fullHistory: settings.backfillFullHistory,
            daysLimit: settings.backfillDays
        });
        
        await GM_setValue(BACKFILL_STATE_KEY, { 
            lastLimitDays: settings.backfillFullHistory ? 9999 : settings.backfillDays, 
            lastSyncTimestamp: Date.now() 
        });
        
        // Reset the backfilling flag
        isBackfilling = false;
        setSyncState(false, newDataFound ? '✓ Synced' : '✓ Up to date');
    }

    /**
     * Initialize the UI
     */
    async function initUI(): Promise<void> {
        // Check if already initialized to prevent multiple initializations
        if (isInitialized) {
            console.log('Guesslytics: UI already initialized, skipping');
            return;
        }
        
        try {
            await waitForReady(() => document.querySelector('[class*="division-header_right"]') !== null);
            
            const userId = getUserId();
            if (!userId) {
                console.error('Guesslytics: Failed to get user ID');
                return;
            }
            
            // Set the initialization flag
            isInitialized = true;
            console.log(`Guesslytics: Initializing UI for user ${userId}`);
            
            setupUI(userId, settings);
            const storedData = await getStoredData();
            renderGraph(storedData, settings);
            
            // Check if we need to do a backfill
            const backfillState = await GM_getValue(BACKFILL_STATE_KEY, { 
                lastLimitDays: 0,
                lastSyncTimestamp: null
            }) as BackfillState;
            
            const currentLimit = settings.backfillFullHistory ? 9999 : settings.backfillDays;
            const lastSyncTime = backfillState.lastSyncTimestamp || 0;
            const timeSinceLastSync = Date.now() - lastSyncTime;
            const hoursSinceLastSync = timeSinceLastSync / (1000 * 60 * 60);
            
            // Determine if we need to do a backfill based on:
            // 1. If the days limit has increased
            // 2. If it's been more than 24 hours since the last sync
            // 3. If we have no data yet
            const limitIncreased = currentLimit > backfillState.lastLimitDays;
            const longTimeSinceSync = hoursSinceLastSync > 24;
            const noDataYet = storedData.overall.length === 0;
            
            const needsBackfill = limitIncreased || longTimeSinceSync || noDataYet;
            
            console.log(`Guesslytics: Backfill check`, {
                currentLimit,
                lastLimitDays: backfillState.lastLimitDays,
                limitIncreased,
                hoursSinceLastSync,
                longTimeSinceSync,
                noDataYet,
                needsBackfill
            });
            
            if (needsBackfill) {
                console.log(`Guesslytics: Backfill needed, fetching initial feed data`);
                const feedData = await fetchApi<FeedResponse>('https://www.geoguessr.com/api/v4/feed/private');
                
                if (feedData?.paginationToken) {
                    console.log(`Guesslytics: Starting backfill with pagination token`);
                    try {
                        await backfillHistory(userId, feedData.paginationToken);
                    } catch (error) {
                        console.error('Guesslytics: Error during backfill', error);
                        // Ensure the backfilling flag is reset in case of error
                        isBackfilling = false;
                        setSyncState(false, 'Error during backfill');
                    }
                } else {
                    console.log(`Guesslytics: No pagination token, starting refresh cycle`);
                    startRefreshCycle(userId, settings, checkForUpdatesCallback);
                }
            } else {
                console.log(`Guesslytics: No backfill needed, checking for updates`);
                // Always check for updates first to catch any new games
                await checkForUpdatesCallback(userId, false);
                startRefreshCycle(userId, settings, checkForUpdatesCallback);
            }
            
            // Add settings panel event handlers
            setupSettingsPanelHandlers(userId);
        } catch(e) { 
            console.error('Guesslytics: Error initializing UI', e); 
        }
    }

    /**
     * Set up settings panel event handlers
     */
    function setupSettingsPanelHandlers(userId: string): void {
        // Save and redraw handler for settings changes
        const saveAndRedraw = async (shouldTriggerBackfill = false) => {
            const oldBackfillLimit = settings.backfillFullHistory ? 9999 : settings.backfillDays;
            
            // Get values from form elements
            settings.showAreaFill = (document.getElementById('showAreaFill') as HTMLInputElement).checked;
            
            // Update visible datasets
            Object.keys(settings.visibleDatasets).forEach(key => { 
                const element = document.getElementById(`ds_${key}`) as HTMLInputElement;
                if (element) {
                    settings.visibleDatasets[key as keyof typeof settings.visibleDatasets] = element.checked;
                }
            });
            
            // Update other settings
            settings.backfillFullHistory = (document.getElementById('backfillFull') as HTMLInputElement).checked;
            settings.backfillDays = parseInt((document.getElementById('backfillDays') as HTMLInputElement).value, 10);
            settings.initialZoomDays = parseInt((document.getElementById('initialZoomDays') as HTMLInputElement).value, 10);
            settings.autoRefreshInterval = parseInt((document.getElementById('autoRefreshInterval') as HTMLInputElement).value, 10);
            settings.apiRequestDelay = parseInt((document.getElementById('apiRequestDelay') as HTMLInputElement).value, 10);
            settings.backgroundOpacity = parseInt((document.getElementById('bgOpacity') as HTMLInputElement).value, 10);
            
            // Save settings
            await GM_setValue(SETTINGS_KEY, settings);
            
            // Update UI
            const container = document.getElementById('guesslyticsContainer');
            if (container) {
                container.style.backgroundColor = `rgba(28,28,28,${settings.backgroundOpacity / 100})`;
            }
            
            renderGraph(await getStoredData(), settings);
            startRefreshCycle(userId, settings, checkForUpdatesCallback);
            
            // Check if backfill is needed
            const newBackfillLimit = settings.backfillFullHistory ? 9999 : settings.backfillDays;
            if (shouldTriggerBackfill && newBackfillLimit > oldBackfillLimit) {
                const feedData = await fetchApi<FeedResponse>('https://www.geoguessr.com/api/v4/feed/private');
                if (feedData?.paginationToken) {
                    backfillHistory(userId, feedData.paginationToken);
                }
            }
        };
        
        // Function to attach event handlers to settings panel elements
        const attachSettingsPanelHandlers = () => {
            console.log('Guesslytics: Attaching settings panel handlers');
            
            // Add event listeners to settings inputs (except backfillFull which has special handling)
            document.querySelectorAll('#guesslyticsSettingsModal input:not(#backfillFull)').forEach(el => {
                (el as HTMLInputElement).onchange = () => saveAndRedraw(['backfillDays'].includes(el.id));
            });
            
            // Add saveAndRedraw handler for the fullHistoryCheck checkbox
            const fullHistoryCheck = document.getElementById('backfillFull') as HTMLInputElement;
            if (fullHistoryCheck) {
                // The visibility toggling is handled in ui.ts
                // Here we just need to add the saveAndRedraw call
                const originalOnChange = fullHistoryCheck.onchange;
                fullHistoryCheck.onchange = (e) => {
                    // Call the original handler first (from ui.ts)
                    if (originalOnChange) originalOnChange.call(fullHistoryCheck, e);
                    // Then call saveAndRedraw
                    saveAndRedraw(true);
                };
            }
            
            // Clear data button
            const clearDataBtn = document.getElementById('clearDataBtn');
            if (clearDataBtn) {
                console.log('Guesslytics: Attaching clearDataBtn handler');
                clearDataBtn.onclick = async () => {
                    if (confirm('Are you sure you want to delete all stored rating data? This action cannot be undone.')) {
                        await setStoredData({ overall: [], moving: [], noMove: [], nmpz: [] });
                        await GM_setValue(BACKFILL_STATE_KEY, { lastLimitDays: 0, lastSyncTimestamp: null });
                        window.location.reload();
                    }
                };
            } else {
                console.log('Guesslytics: clearDataBtn not found');
            }
            
            // Reset settings button
            const resetSettingsBtn = document.getElementById('resetSettingsBtn');
            if (resetSettingsBtn) {
                console.log('Guesslytics: Attaching resetSettingsBtn handler');
                resetSettingsBtn.onclick = async () => {
                    if (confirm('Are you sure you want to reset all settings to their defaults?')) {
                        await GM_setValue(SETTINGS_KEY, DEFAULT_SETTINGS);
                        settings = await loadSettings();
                        renderSettingsPanel(settings);
                    }
                };
            } else {
                console.log('Guesslytics: resetSettingsBtn not found');
            }
        };
        
        // Attach handlers immediately for the initial setup
        attachSettingsPanelHandlers();
        
        // Listen for the custom event that signals the settings panel has been rendered
        document.addEventListener('guesslyticsSettingsRendered', () => {
            console.log('Guesslytics: Settings panel rendered, attaching handlers');
            attachSettingsPanelHandlers();
        });
    }

    /**
     * Observe for page changes
     */
    function observeForPageChanges(): void {
        // Add debounce to prevent multiple calls in quick succession
        let debounceTimer: number | null = null;
        
        const observer = new MutationObserver(() => {
            const isSoloDuelsPage = window.location.pathname === '/multiplayer';
            const uiExists = document.getElementById('guesslyticsContainer');
            
            // Only proceed if we're on the right page and UI doesn't exist yet
            if (isSoloDuelsPage && !uiExists && !isInitialized) {
                // Clear any existing timer
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }
                
                // Set a new timer to call initUI after a short delay
                debounceTimer = window.setTimeout(() => {
                    initUI();
                }, 500);
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * Wrapper for checkForUpdates to use in startRefreshCycle
     */
    async function checkForUpdatesCallback(userId: string, isManual: boolean): Promise<void> {
        await checkForUpdates(userId, isManual, settings.apiRequestDelay, setSyncState);
        renderGraph(await getStoredData(), settings);
    }

    /**
     * Initialize the script
     */
    async function init(): Promise<void> {
        console.log(`Guesslytics v${GM_info.script.version} Initializing...`);
        
        // Load settings
        settings = await loadSettings();
        
        // Register Chart.js plugins
        Chart.defaults.font.family = "'ggFont', sans-serif";
        
        // Observe for page changes
        observeForPageChanges();
        
        // Initialize UI if on the multiplayer page
        if (window.location.pathname === '/multiplayer') {
            initUI();
        }
    }

    // Start the script
    init();
})();
