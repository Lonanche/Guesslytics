import { checkForUpdates, fetchApi, processGames } from './lib/api';
import { BACKFILL_STATE_KEY, DEFAULT_SETTINGS, SETTINGS_KEY } from './lib/constants';
import { renderGraph, renderSettingsPanel, setSyncState, setupUI, startRefreshCycle } from './lib/ui';
import { getStoredData, getUserId, loadSettings, setStoredData, waitForReady } from './lib/utils';
import { BackfillState, FeedResponse, Settings } from './types';

/**
 * Guesslytics - GeoGuessr Rating Tracker
 * Tracks your GeoGuessr competitive duel ratings over time and displays it in a graph.
 */
(async () => {
    'use strict';

    // --- STATE & SETTINGS ---
    let settings: Settings = { ...DEFAULT_SETTINGS };

    /**
     * Backfill history from the feed
     */
    async function backfillHistory(userId: string, initialToken: string): Promise<void> {
        setSyncState(true);
        let paginationToken = initialToken;
        let pagesProcessed = 0;
        const cutoffDate = new Date();
        
        if (!settings.backfillFullHistory) {
            cutoffDate.setDate(cutoffDate.getDate() - settings.backfillDays);
        }
        
        while (paginationToken && pagesProcessed < 200) {
            pagesProcessed++;
            
            try {
                const feedData = await fetchApi<FeedResponse>(
                    `https://www.geoguessr.com/api/v4/feed/private?paginationToken=${paginationToken}`,
                    3,
                    1000,
                    settings.apiRequestDelay
                );
                
                if (!feedData) break;
                
                await processGames(feedData.entries, userId, settings.apiRequestDelay);
                
                const currentData = await getStoredData();
                const oldestDate = currentData.overall.length > 0 ? 
                    new Date(currentData.overall[0].timestamp).toLocaleDateString() : '';
                
                setSyncState(true, `Syncing... (${currentData.overall.length} found, to ${oldestDate})`);
                renderGraph(currentData, settings);
                
                const oldestGame = currentData.overall[0];
                if (!settings.backfillFullHistory && oldestGame && new Date(oldestGame.timestamp) < cutoffDate) {
                    break;
                }
                
                paginationToken = feedData.paginationToken;
            } catch (e) { 
                console.error('Guesslytics: Failed to fetch a history page.', e); 
                break; 
            }
        }
        
        await GM_setValue(BACKFILL_STATE_KEY, { 
            lastLimitDays: settings.backfillFullHistory ? 9999 : settings.backfillDays, 
            lastSyncTimestamp: Date.now() 
        });
        
        setSyncState(false, '✓ Synced');
    }

    /**
     * Initialize the UI
     */
    async function initUI(): Promise<void> {
        try {
            await waitForReady(() => document.querySelector('[class*="division-header_right"]') !== null);
            
            const userId = getUserId();
            if (!userId) return;
            
            setupUI(userId, settings);
            renderGraph(await getStoredData(), settings);
            
            const backfillState = await GM_getValue(BACKFILL_STATE_KEY, { lastLimitDays: 0 }) as BackfillState;
            const currentLimit = settings.backfillFullHistory ? 9999 : settings.backfillDays;
            const needsBackfill = currentLimit > backfillState.lastLimitDays;
            
            if (needsBackfill) {
                const feedData = await fetchApi<FeedResponse>('https://www.geoguessr.com/api/v4/feed/private');
                
                if (feedData?.paginationToken) {
                    backfillHistory(userId, feedData.paginationToken);
                } else {
                    startRefreshCycle(userId, settings, checkForUpdatesCallback);
                }
            } else {
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
        
        // Add event listeners to settings inputs (except backfillFull which has special handling)
        document.querySelectorAll('#guesslyticsSettingsModal input:not(#backfillFull)').forEach(el => {
            (el as HTMLInputElement).onchange = () => saveAndRedraw(['backfillDays'].includes(el.id));
        });
        
        // Toggle backfill days visibility
        const fullHistoryCheck = document.getElementById('backfillFull') as HTMLInputElement;
        if (fullHistoryCheck) {
            const backfillDaysRow = document.getElementById('backfillDaysRow');
            if (backfillDaysRow) {
                // Set initial visibility (redundant with ui.ts but ensures consistency)
                backfillDaysRow.style.display = fullHistoryCheck.checked ? 'none' : 'flex';
                
                // Add change handler for the fullHistoryCheck checkbox
                fullHistoryCheck.onchange = () => { 
                    if (backfillDaysRow) {
                        backfillDaysRow.style.display = fullHistoryCheck.checked ? 'none' : 'flex';
                    }
                    saveAndRedraw(true);
                };
            }
        }
        
        // Clear data button
        const clearDataBtn = document.getElementById('clearDataBtn');
        if (clearDataBtn) {
            clearDataBtn.onclick = async () => {
                if (confirm('Are you sure you want to delete all stored rating data? This action cannot be undone.')) {
                    await setStoredData({ overall: [], moving: [], noMove: [], nmpz: [] });
                    await GM_setValue(BACKFILL_STATE_KEY, { lastLimitDays: 0, lastSyncTimestamp: null });
                    window.location.reload();
                }
            };
        }
        
        // Reset settings button
        const resetSettingsBtn = document.getElementById('resetSettingsBtn');
        if (resetSettingsBtn) {
            resetSettingsBtn.onclick = async () => {
                if (confirm('Are you sure you want to reset all settings to their defaults?')) {
                    await GM_setValue(SETTINGS_KEY, DEFAULT_SETTINGS);
                    await loadSettings();
                    renderSettingsPanel(settings);
                }
            };
        }
    }

    /**
     * Observe for page changes
     */
    function observeForPageChanges(): void {
        const observer = new MutationObserver(() => {
            const isSoloDuelsPage = window.location.pathname === '/multiplayer';
            const uiExists = document.getElementById('guesslyticsContainer');
            
            if (isSoloDuelsPage && !uiExists) {
                initUI();
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
        console.log(`Guesslytics v3.0 Initializing...`);
        
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
