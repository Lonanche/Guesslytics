import { checkForUpdates, syncRatingHistory } from './lib/api';
import { BACKFILL_STATE_KEY, DEFAULT_SETTINGS, ICONS, RATING_HISTORY_KEY, SETTINGS_KEY } from './lib/constants';
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
     * Adds a "Statistics" button to the victory screen that appears after a game.
     * This button will restore the graph view and trigger a sync when clicked.
     * 
     * When a game is completed, GeoGuessr replaces the content of the division header's right side
     * with a victory screen that includes "Breakdown" and "Replay" buttons. This function adds a
     * third "Statistics" button in the same style that, when clicked, restores our graph view and
     * triggers a sync to get the latest data.
     */
    function addGraphButtonToVictoryScreen(): void {
        // Check if we're on the multiplayer page
        if (window.location.pathname !== '/multiplayer') return;

        // Check if the victory screen is present
        const statusBox = document.querySelector('.status-box_actions__E_Ryq') as HTMLElement;
        if (!statusBox) return;

        // Check if our button already exists
        if (document.getElementById('guesslyticsGraphBtn')) return;
        
        // Modify the parent container to ensure all buttons are in a single row
        statusBox.style.display = 'flex';
        statusBox.style.flexDirection = 'row';
        statusBox.style.flexWrap = 'nowrap';
        statusBox.style.justifyContent = 'center';
        statusBox.style.gap = '10px';

        // Create a new button container similar to the existing ones
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'flex_flex__Rxtgm flex_direction__Fa3Gs flex_gap__sXfgm flex_justify__2rGZO flex_align__PRoee';
        buttonContainer.style.cssText = '--direction: column; --gap: 6; --justify: flex-start; --align: center;';

        // Create the button wrapper
        const buttonWrapper = document.createElement('div');
        buttonWrapper.className = 'status-box_actionButtonWrapper__4S6eN';

        // Create the button
        const button = document.createElement('button');
        button.id = 'guesslyticsGraphBtn';
        button.className = 'status-box_actionButton__MbK3e';
        button.innerHTML = ICONS.CHART;

        // Create the button text
        const buttonText = document.createElement('span');
        buttonText.className = 'status-box_buttonText__3IW4K';
        buttonText.textContent = 'Statistics';

        // Add click handler to restore graph view and trigger sync
        button.onclick = async () => {
            logger.log('Statistics button clicked, restoring graph view');
            
            // Get the division header right element
            const targetElement = document.querySelector('[class*="division-header_right"]');
            if (!targetElement) {
                logger.error('Could not find target element for graph view');
                return;
            }

            // Clear the victory screen
            targetElement.innerHTML = '';

            // Reinitialize the graph view
            if (userId) {
                setupUI(userId, settings, () => backfillHistory());
                await renderGraph(await getStoredData(), settings);
                
                // Trigger a sync to get the latest data
                await checkForUpdatesCallback();
            } else {
                logger.error('No user ID available for graph view');
            }
        };

        // Assemble the button
        buttonWrapper.appendChild(button);
        buttonContainer.appendChild(buttonWrapper);
        buttonContainer.appendChild(buttonText);

        // Add the button to the status box
        statusBox.appendChild(buttonContainer);
        
        logger.log('Added Statistics button to victory screen');
    }

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
                
                // Check for victory screen and add our Graph button if needed
                // This is called on every DOM mutation to ensure we catch the victory screen
                // as soon as it appears, even if it's added dynamically after a game completes
                if (isMultiplayerPage) {
                    addGraphButtonToVictoryScreen();
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
