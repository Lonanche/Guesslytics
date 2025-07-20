import { checkForUpdates, fetchApi, processGames } from './lib/api';
import { BACKFILL_STATE_KEY, DEFAULT_SETTINGS, RATING_HISTORY_KEY, SETTINGS_KEY } from './lib/constants';
import { renderGraph, renderSettingsPanel, setSyncState, setupUI, startRefreshCycle } from './lib/ui';
import { getStoredData, getUserId, loadSettings, sleep, waitForReady } from './lib/utils';
import { BackfillState, FeedResponse, Settings } from './types';

/**
 * Guesslytics - GeoGuessr Rating Tracker
 * @author Constructor
 * @license GPL-3.0+
 */
(async () => {
    'use strict';

    // --- Application State ---
    let settings: Settings = { ...DEFAULT_SETTINGS };
    let isInitialized = false;
    let isSyncing = false; // A global flag to prevent concurrent sync/backfill operations.
    let userId: string | null = null;

    // --- Core Functions ---

    /**
     * Backfills rating history from the user's activity feed.
     * This is a long-running process that pages through the feed API until it reaches the end
     * or a user-defined cutoff date.
     * @param isFullResync If true, fetches all history based on settings, ignoring previous state.
     */
    async function backfillHistory(isFullResync: boolean = false): Promise<void> {
        if (isSyncing || !userId) {
            console.log('Guesslytics: Sync request skipped (already in progress or no user ID).');
            return;
        }

        isSyncing = true;
        setSyncState(true, 'Starting sync...');
        console.log(`Guesslytics: Starting history backfill. Full resync: ${isFullResync}`);

        let paginationToken: string | undefined;
        let pagesProcessed = 0;
        const MAX_PAGES = 500; // Safety break for the while loop to prevent infinite loops.

        const cutoffDate = new Date();
        if (!settings.backfillFullHistory) {
            cutoffDate.setDate(cutoffDate.getDate() - settings.backfillDays);
        }

        try {
            // Fetch the very first page to get the initial pagination token.
            const initialFeed = await fetchApi<FeedResponse>(
                `https://www.geoguessr.com/api/v4/feed/private`,
                settings.apiRequestDelay
            );

            if (!initialFeed) {
                throw new Error('Failed to fetch initial feed page.');
            }

            paginationToken = initialFeed.paginationToken;
            await processGames(initialFeed.entries, userId, settings.apiRequestDelay);

            // Loop through subsequent pages until we run out of tokens or hit a limit.
            while (paginationToken && pagesProcessed < MAX_PAGES) {
                pagesProcessed++;

                const feedData = await fetchApi<FeedResponse>(
                    `https://www.geoguessr.com/api/v4/feed/private?paginationToken=${paginationToken}`,
                    settings.apiRequestDelay
                );

                if (!feedData) {
                    console.warn(`Guesslytics: No feed data on page ${pagesProcessed}, stopping backfill.`);
                    break;
                }

                await processGames(feedData.entries, userId, settings.apiRequestDelay);
                const currentData = await getStoredData();
                const oldestGame = currentData.overall[0];

                // Update the UI with the current progress.
                const oldestDateStr = oldestGame ? new Date(oldestGame.timestamp).toLocaleDateString() : 'N/A';
                setSyncState(true, `Syncing... (${currentData.overall.length} games, to ${oldestDateStr})`);
                await renderGraph(await getStoredData(), settings);

                // Stop condition: if not a full history sync and we've passed the cutoff date.
                if (!settings.backfillFullHistory && oldestGame && new Date(oldestGame.timestamp) < cutoffDate) {
                    console.log(`Guesslytics: Reached cutoff date (${cutoffDate.toISOString()}). Stopping backfill.`);
                    break;
                }

                paginationToken = feedData.paginationToken;
                if (!paginationToken) {
                    console.log('Guesslytics: Reached the end of the feed.');
                }

                await sleep(500); // Small delay between page fetches to be safe.
            }
        } catch (e) {
            console.error('Guesslytics: Failed during history backfill process.', e);
            setSyncState(false, 'Error during sync');
        } finally {
            console.log(`Guesslytics: Backfill complete. Processed ${pagesProcessed} pages.`);
            // Save the state of this backfill to avoid re-doing it unnecessarily.
            await GM_setValue(BACKFILL_STATE_KEY, {
                lastLimitDays: settings.backfillFullHistory ? 9999 : settings.backfillDays,
                lastSyncTimestamp: Date.now(),
            });
            isSyncing = false;
            setSyncState(false, '✓ Synced');
            await renderGraph(await getStoredData(), settings);
        }
    }

    /**
     * Wrapper for `checkForUpdates` to be used as a callback in the refresh cycle.
     * Prevents concurrent updates.
     */
    async function checkForUpdatesCallback(): Promise<void> {
        if (!userId || isSyncing) return;
        isSyncing = true;
        const newData = await checkForUpdates(userId, false, settings.apiRequestDelay, setSyncState);
        if (newData) {
            await renderGraph(await getStoredData(), settings);
        }
        isSyncing = false;
    }

    // --- UI & Event Handlers ---

    /**
     * Sets up all event handlers for the settings panel.
     * This function is called once the settings panel is rendered.
     */
    function setupSettingsPanelHandlers(): void {
        const attachHandlers = async () => {
            const oldSettings = { ...settings };

            // --- Button Handlers ---
            document.getElementById('clearDataBtn')!.onclick = async () => {
                if (confirm('Are you sure you want to delete all stored rating data? This cannot be undone.')) {
                    await GM_setValue(RATING_HISTORY_KEY, null);
                    await GM_setValue(BACKFILL_STATE_KEY, null);
                    window.location.reload();
                }
            };

            document.getElementById('resetSettingsBtn')!.onclick = async () => {
                if (confirm('Are you sure you want to reset all settings to their defaults?')) {
                    settings = { ...DEFAULT_SETTINGS };
                    await GM_setValue(SETTINGS_KEY, settings);
                    await renderSettingsPanel(settings);
                    attachHandlers(); // Re-attach handlers to the newly rendered elements.
                }
            };

            // --- Input Change Handlers ---
            const inputs = document.querySelectorAll('#guesslyticsSettingsModal input');
            inputs.forEach((input) => {
                (input as HTMLInputElement).onchange = async () => {
                    // Update the settings object from the form inputs.
                    settings.showAreaFill = (document.getElementById('showAreaFill') as HTMLInputElement).checked;
                    Object.keys(settings.visibleDatasets).forEach((key) => {
                        const el = document.getElementById(`ds_${key}`) as HTMLInputElement;
                        if (el) settings.visibleDatasets[key as keyof typeof settings.visibleDatasets] = el.checked;
                    });
                    settings.backfillFullHistory = (document.getElementById('backfillFull') as HTMLInputElement).checked;
                    settings.backfillDays = parseInt((document.getElementById('backfillDays') as HTMLInputElement).value, 10);
                    settings.initialZoomDays = parseInt((document.getElementById('initialZoomDays') as HTMLInputElement).value, 10);
                    settings.autoRefreshInterval = parseInt((document.getElementById('autoRefreshInterval') as HTMLInputElement).value, 10);
                    settings.apiRequestDelay = parseInt((document.getElementById('apiRequestDelay') as HTMLInputElement).value, 10);
                    settings.backgroundOpacity = parseInt((document.getElementById('bgOpacity') as HTMLInputElement).value, 10);

                    await GM_setValue(SETTINGS_KEY, settings);

                    // --- Post-change Actions ---
                    // Update UI elements affected by the settings change.
                    const container = document.getElementById('guesslyticsContainer');
                    if (container) container.style.backgroundColor = `rgba(28,28,28,${settings.backgroundOpacity / 100})`;

                    await renderGraph(await getStoredData(), settings);
                    startRefreshCycle(settings, checkForUpdatesCallback);

                    // Trigger a new backfill if the user increased the history duration.
                    const newLimit = settings.backfillFullHistory ? 9999 : settings.backfillDays;
                    const oldLimit = oldSettings.backfillFullHistory ? 9999 : oldSettings.backfillDays;
                    if (newLimit > oldLimit) {
                        await backfillHistory(true);
                    }
                };
            });
        };

        // Listen for the custom event that signals the settings panel has been rendered.
        document.addEventListener('guesslyticsSettingsRendered', attachHandlers);
    }

    /**
     * The main initialization function for the script.
     * This function is called once the multiplayer page is detected.
     */
    async function initScript(): Promise<void> {
        if (isInitialized) return;
        isInitialized = true;

        console.log(`Guesslytics v${GM_info.script.version} Initializing...`);

        // Load settings and wait for the target UI element to be available.
        settings = await loadSettings();
        await waitForReady(() => document.querySelector('[class*="division-header_right"]') !== null);

        userId = getUserId();
        if (!userId) {
            console.error('Guesslytics: Could not get user ID. Aborting.');
            return;
        }

        // Set up the main UI, render the graph, and attach event handlers.
        setupUI(userId, settings, () => backfillHistory(true));
        await renderGraph(await getStoredData(), settings);
        setupSettingsPanelHandlers();

        // --- Initial Data Load Logic ---
        const backfillState = (await GM_getValue(BACKFILL_STATE_KEY, {})) as BackfillState;
        const storedData = await getStoredData();
        const needsBackfill = storedData.overall.length === 0 && !backfillState.lastSyncTimestamp;

        if (needsBackfill) {
            console.log('Guesslytics: No data found, starting initial history backfill.');
            await backfillHistory(true);
        } else {
            console.log('Guesslytics: Found existing data, checking for recent updates.');
            await checkForUpdatesCallback();
        }

        // Start the automatic refresh cycle.
        startRefreshCycle(settings, checkForUpdatesCallback);
    }

    // --- Entry Point ---

    // Use a MutationObserver to detect navigation to the multiplayer page.
    // This is more reliable than just running on script load for single-page applications.
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                const isMultiplayerPage = window.location.pathname === '/multiplayer';
                const uiExists = document.getElementById('guesslyticsContainer');

                // If we are on the multiplayer page and the UI hasn't been injected yet.
                if (isMultiplayerPage && !uiExists) {
                    initScript();
                } else if (!isMultiplayerPage) {
                    // If we navigate away, reset the initialized flag so the script can run again if we return.
                    isInitialized = false;
                }
                break; // No need to check all mutations.
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check in case the script loads after the page is already there.
    if (window.location.pathname === '/multiplayer') {
        initScript();
    }
})();
