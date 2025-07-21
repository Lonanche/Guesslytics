import { checkForUpdates, syncRatingHistory } from './lib/api';
import { BACKFILL_STATE_KEY, DEFAULT_SETTINGS, RATING_HISTORY_KEY, SETTINGS_KEY } from './lib/constants';
import { renderGraph, renderSettingsPanel, setSyncState, setupUI, startRefreshCycle } from './lib/ui';
import { getStoredData, getUserId, loadSettings, logger, waitForReady } from './lib/utils';
import { BackfillState, Settings } from './types';

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
     */
    async function backfillHistory(): Promise<void> {
        if (isSyncing || !userId) {
            logger.log('Sync request skipped (already in progress or no user ID).');
            return;
        }

        isSyncing = true;
        
        try {
            await syncRatingHistory(userId, settings.apiRequestDelay, setSyncState, settings, checkForUpdatesCallback, {
                isBackfill: true,
                initialStatusMessage: 'Starting history backfill...',
                logPrefix: 'History backfill'
            });
        } finally {
            isSyncing = false;
        }
    }

    /**
     * Wrapper for `checkForUpdates` to be used as a callback in the refresh cycle.
     * Prevents concurrent updates.
     */
    async function checkForUpdatesCallback(): Promise<void> {
        if (!userId || isSyncing) return;
        isSyncing = true;
        const newData = await checkForUpdates(
            userId,
            settings.apiRequestDelay,
            setSyncState,
            settings,
            checkForUpdatesCallback
        );
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
            logger.log('Attaching settings panel handlers.');
            const oldSettings = { ...settings };

            // --- Button Handlers ---
            document.getElementById('clearDataBtn')!.onclick = async () => {
                if (confirm('Are you sure you want to delete all stored rating data? This cannot be undone.')) {
                    logger.log('Clearing all data.');
                    // Set default values instead of null to prevent null reference errors
                    await GM_setValue(RATING_HISTORY_KEY, { overall: [], moving: [], noMove: [], nmpz: [] });
                    await GM_setValue(BACKFILL_STATE_KEY, { lastLimitDays: 0, lastSyncTimestamp: null, ended: false });
                    window.location.reload();
                }
            };

            document.getElementById('resetSettingsBtn')!.onclick = async () => {
                if (confirm('Are you sure you want to reset all settings to their defaults?')) {
                    logger.log('Resetting settings.');
                    settings = { ...DEFAULT_SETTINGS };
                    await GM_setValue(SETTINGS_KEY, settings);
                    await renderSettingsPanel(settings);
                    await attachHandlers(); // Re-attach handlers to the newly rendered elements.
                }
            };

            // --- Input Change Handlers ---
            const inputs = document.querySelectorAll('#guesslyticsSettingsModal input');
            inputs.forEach((input) => {
                (input as HTMLInputElement).onchange = async () => {
                    logger.log(`Setting changed: ${input.id}`);
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
                    settings.verboseLogging = (document.getElementById('verboseLogging') as HTMLInputElement).checked;

                    logger.setLogging(settings.verboseLogging);
                    await GM_setValue(SETTINGS_KEY, settings);

                    // --- Post-change Actions ---
                    // Update UI elements affected by the settings change.
                    const container = document.getElementById('guesslyticsContainer');
                    if (container) container.style.backgroundColor = `rgba(28,28,28,${settings.backgroundOpacity / 100})`;

                    await renderGraph(await getStoredData(), settings);
                    startRefreshCycle(settings, checkForUpdatesCallback);

                    // Trigger a new backfill if the user increased the history duration or changed to full history.
                    const newLimit = settings.backfillFullHistory ? 9999 : settings.backfillDays;
                    const oldLimit = oldSettings.backfillFullHistory ? 9999 : oldSettings.backfillDays;
                    const backfillState = (await GM_getValue(BACKFILL_STATE_KEY, { lastLimitDays: 0, lastSyncTimestamp: null, ended: false })) as BackfillState;
                    
                    // Check if user changed from limited to full history
                    const changedToFullHistory = settings.backfillFullHistory && !oldSettings.backfillFullHistory;
                    
                    if (changedToFullHistory) {
                        // Reset the ended flag when changing to full history to allow syncing older entries
                        logger.log('Changed from limited to full history. Resetting ended flag and triggering new backfill.');
                        await GM_setValue(BACKFILL_STATE_KEY, {
                            ...backfillState,
                            ended: false
                        });
                        await backfillHistory();
                    } else if (newLimit > oldLimit) {
                        // Reset the ended flag when increasing the cutoff date to allow syncing older entries
                        if (backfillState.ended) {
                            logger.log('Increased cutoff date. Resetting ended flag and triggering new backfill.');
                            await GM_setValue(BACKFILL_STATE_KEY, {
                                ...backfillState,
                                ended: false
                            });
                        }
                        // Trigger backfill with the new limit
                        await backfillHistory();
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

        logger.log(`Guesslytics v${GM_info.script.version} Initializing...`);

        // Load settings and wait for the target UI element to be available.
        settings = await loadSettings();
        await waitForReady(() => document.querySelector('[class*="division-header_right"]') !== null);

        userId = getUserId();
        if (!userId) {
            logger.log('Could not get user ID. Aborting.');
            return;
        }

        // Set up the main UI, render the graph, and attach event handlers.
        setupUI(userId, settings, () => backfillHistory());
        await renderGraph(await getStoredData(), settings);
        setupSettingsPanelHandlers();

        // --- Initial Data Load Logic ---
        const backfillState = (await GM_getValue(BACKFILL_STATE_KEY, { lastLimitDays: 0, lastSyncTimestamp: null, ended: false })) as BackfillState;
        const storedData = await getStoredData();
        const needsBackfill = storedData.overall.length === 0 && !backfillState.lastSyncTimestamp && !backfillState.ended;

        if (needsBackfill) {
            logger.log('No data found, starting initial history backfill.');
            await backfillHistory();
        } else {
            logger.log('Found existing data, checking for recent updates.');
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
