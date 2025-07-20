import { ChartDataset, ChartOptions, RatingHistory, Settings } from '../types';
import { checkForUpdates } from './api';
import { BACKFILL_STATE_KEY, DATASET_STYLES, ICONS } from './constants';
import { formatDate, getStoredData, getUserId } from './utils';

let ratingChart: any = null;
let isGraphExpanded = false;
let refreshIntervalId: number | null = null;
let countdownIntervalId: number | null = null;
let isSyncing = false;

/**
 * Set the sync state and update UI
 */
export function setSyncState(syncing: boolean, text: string = ''): void {
    isSyncing = syncing;
    const statusEl = document.getElementById('guesslyticsStatus');
    const timerEl = document.getElementById('guesslyticsTimer');
    const resyncBtn = document.getElementById('guesslyticsResyncBtn') as HTMLButtonElement;
    
    if (!statusEl || !timerEl || !resyncBtn) return;

    resyncBtn.disabled = isSyncing;
    
    if (isSyncing) {
        if (countdownIntervalId) clearInterval(countdownIntervalId);
        timerEl.style.display = 'none';
        statusEl.innerHTML = `${text || 'Syncing...'} <div class="gg-spinner"></div>`;
    } else {
        statusEl.innerText = text;
        const userId = getUserId();
        
        // Hide timer while status text is showing
        timerEl.style.display = 'none';
        
        // Wait for status text to be cleared before showing timer
        setTimeout(() => {
            if (statusEl && statusEl.innerText === text) {
                statusEl.innerText = '';
            }
            
            // Start refresh cycle and show timer after status is cleared
            if (userId) {
                // This is a temporary fix - the actual settings and callback will be provided by the main script
                startRefreshCycle(userId, { autoRefreshInterval: 60 } as any, async () => {});
            }
        }, 3000);
    }
}

/**
 * Set up the UI elements
 */
export function setupUI(userId: string | null, settings: Settings): void {
    const targetElement = document.querySelector('[class*="division-header_right"]');
    if (!targetElement || document.getElementById('guesslyticsContainer')) return;
    
    const container = document.createElement('div');
    container.id = 'guesslyticsContainer';
    container.innerHTML = `
        <div class="guesslytics-header">
            <div class="guesslytics-title-wrapper"><h3>RATING HISTORY</h3><span id="guesslyticsStatus"></span><span id="guesslyticsTimer"></span></div>
            <div class="chart-buttons">
                <button id="guesslyticsResyncBtn" title="Manual Sync">${ICONS.RESYNC}</button>
                <button id="guesslyticsToggleBtn" title="Toggle Graph Size">${ICONS.EXPAND}</button>
                <button id="guesslyticsSettingsBtn" title="Settings">${ICONS.SETTINGS}</button>
            </div>
        </div>
        <div id="graphWrapper"><div id="guesslyticsStats"></div><canvas id="guesslyticsCanvas"></canvas></div>`;
    
    targetElement.innerHTML = '';
    targetElement.appendChild(container);

    if (!document.getElementById('guesslyticsSettingsPanel')) {
        const settingsPanel = document.createElement('div');
        settingsPanel.id = 'guesslyticsSettingsPanel';
        document.body.appendChild(settingsPanel);
    }

    document.getElementById('guesslyticsToggleBtn')!.onclick = () => {
        isGraphExpanded = !isGraphExpanded;
        container.classList.toggle('expanded', isGraphExpanded);
        document.getElementById('guesslyticsToggleBtn')!.innerHTML = isGraphExpanded ? ICONS.COLLAPSE : ICONS.EXPAND;
        document.getElementById('guesslyticsStats')!.style.display = isGraphExpanded ? 'flex' : 'none';
        if(isGraphExpanded) calculateAndRenderStats();
    };
    
    document.getElementById('guesslyticsSettingsBtn')!.onclick = () => {
        document.getElementById('guesslyticsSettingsPanel')!.style.display = 'block';
        renderSettingsPanel(settings);
    };
    
    document.getElementById('guesslyticsResyncBtn')!.onclick = async () => {
        if (isSyncing || !userId) return;
        await checkForUpdates(userId, true, settings.apiRequestDelay, setSyncState);
    };

    GM_addStyle(`
        #guesslyticsContainer { display: flex; flex-direction: column; width: 100%; height: 210px; background: rgba(28,28,28,${settings.backgroundOpacity / 100}); border-radius: 8px; border: 1px solid #444; transition: height 0.3s ease, background-color 0.3s ease; box-sizing: border-box; }
        #guesslyticsContainer.expanded { height: 400px; }
        .guesslytics-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; border-bottom: 1px solid #444; flex-shrink: 0; }
        .guesslytics-title-wrapper { display: flex; align-items: center; gap: 10px; color: #fff; font-size: 14px; }
        #guesslyticsStatus { font-size: 12px; color: #00BCD4; display: flex; align-items: center; gap: 5px; }
        #guesslyticsTimer { font-size: 11px; color: #888; }
        #graphWrapper { display: flex; flex-direction: column; flex-grow: 1; min-height: 0; padding: 5px 10px 10px 5px; box-sizing: border-box; }
        #guesslyticsStats { display: none; flex-wrap: wrap; justify-content: space-around; padding: 5px 10px; gap: 10px; border-bottom: 1px solid #444; margin-bottom: 5px; flex-shrink: 0; }
        .stat-item { text-align: center; } .stat-item .value { font-size: 16px; font-weight: bold; color: #fff; } .stat-item .label { font-size: 11px; color: #aaa; } .stat-item .value.positive { color: #4CAF50; } .stat-item .value.negative { color: #F44336; }
        #guesslyticsCanvas { flex-grow: 1; min-height: 0; }
        .chart-buttons { display: flex; gap: 5px; } .chart-buttons button { background: #333; border: 1px solid #555; border-radius: 5px; cursor: pointer; color: white; width: 24px; height: 24px; padding: 3px; }
        .chart-buttons button:hover { background: #444; } .chart-buttons button:disabled { opacity: 0.5; cursor: not-allowed; }
        /* Settings Modal */
        #guesslyticsSettingsPanel { display: none; }
        #guesslyticsSettingsOverlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 10000; }
        #guesslyticsSettingsModal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 400px; background: #1c1c1c; color: #fff; padding: 25px; border-radius: 8px; z-index: 10001; border: 1px solid #444; }
        #guesslyticsSettingsModal h2 { margin-top: 0; text-align: center; }
        .settings-section { margin-bottom: 10px; } .settings-section h4 { font-size: 14px; margin: 0 0 8px; border-bottom: 1px solid #444; padding-bottom: 4px; }
        .settings-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 13px; }
        #backfillDaysRow { display: flex; } /* Visible by default */
        #backfillDaysRow.hidden { display: none !important; } /* Hide when given the hidden class */
        .settings-row input { width: 60px; text-align: center; background: #333; border: 1px solid #555; color: #fff; border-radius: 4px; padding: 4px; }
        .settings-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: #00BCD4; }
        .graph-toggle-row { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 15px; } .graph-toggle-item { display: flex; align-items: center; justify-content: space-between; }
        .color-swatch { width: 12px; height: 12px; border-radius: 3px; margin-right: 8px; border: 1px solid #888; }
        .settings-actions { display: flex; gap: 10px; margin-top: 10px; }
        .settings-actions button { flex-grow: 1; padding: 8px; border: none; color: #fff; font-weight: bold; cursor: pointer; border-radius: 4px; }
        #clearDataBtn { background: #c53030; } #resetSettingsBtn { background: #717171; }
        .settings-stats { font-size: 13px; color: #ccc; border-top: 1px solid #444; padding-top: 10px; margin-top: 10px; }
        .settings-footer { text-align: center; font-size: 11px; color: #888; margin-top: 10px; border-top: 1px solid #444; padding-top: 10px; }
        .settings-footer a { color: #aaa; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; } .settings-footer svg { width: 14px; height: 14px; }
        /* Spinner */
        .gg-spinner { animation: gg-spinner 1s linear infinite; box-sizing: border-box; position: relative; display: block; transform: scale(var(--ggs,0.7)); width: 16px; height: 16px; border: 2px solid; border-top-color: transparent; border-radius: 50%; }
        @keyframes gg-spinner { 0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) } }
    `);
}

/**
 * Calculate and render statistics
 */
export async function calculateAndRenderStats(): Promise<void> {
    if (!isGraphExpanded || !ratingChart) return;
    
    const statsEl = document.getElementById('guesslyticsStats');
    if (!statsEl) return;
    
    const data = await getStoredData();
    const visibleMin = ratingChart.scales.x.min;
    const visibleMax = ratingChart.scales.x.max;
    
    const visibleData = data.overall.filter(d => { 
        const ts = new Date(d.timestamp).getTime(); 
        return ts >= visibleMin && ts <= visibleMax; 
    });
    
    if (visibleData.length < 2) { 
        statsEl.innerHTML = '<div class="stat-item"><div class="label">Not enough data in this view for stats</div></div>'; 
        return; 
    }
    
    const lastGame = visibleData[visibleData.length - 1];
    const secondLastGame = visibleData[visibleData.length - 2];
    const lastChange = lastGame.rating - secondLastGame.rating;
    const lastChangeEl = `<div class="value ${lastChange >= 0 ? 'positive' : 'negative'}">${lastChange >= 0 ? '+' : ''}${lastChange}</div>`;
    
    let wins = 0, losses = 0, gains = 0, lossesTotal = 0, peakRating = visibleData[0].rating;
    
    for (let i = 1; i < visibleData.length; i++) {
        const change = visibleData[i].rating - visibleData[i - 1].rating;
        if (change > 0) { wins++; gains += change; }
        if (change < 0) { losses++; lossesTotal += change; }
        if (visibleData[i].rating > peakRating) peakRating = visibleData[i].rating;
    }
    
    const netChange = visibleData[visibleData.length - 1].rating - visibleData[0].rating;
    const totalGames = visibleData.length - 1;
    const avgNet = totalGames > 0 ? (netChange / totalGames).toFixed(2) : '0';
    const avgNetEl = `<div class="value ${Number(avgNet) >= 0 ? 'positive' : 'negative'}">${Number(avgNet) >= 0 ? '+' : ''}${avgNet}</div>`;
    
    const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    let winRateClass = '';
    if (winRate > 50) winRateClass = 'positive';
    if (winRate < 50) winRateClass = 'negative';
    const winRateEl = `<div class="value ${winRateClass}">${winRate}%</div>`;
    
    const avgGain = wins > 0 ? (gains / wins).toFixed(2) : '0';
    const avgLoss = losses > 0 ? (lossesTotal / losses).toFixed(2) : '0';
    
    statsEl.innerHTML = `
        <div class="stat-item">${lastChangeEl}<div class="label">Last Change</div></div>
        <div class="stat-item">${avgNetEl}<div class="label">Avg. Net/Game</div></div>
        <div class="stat-item">${winRateEl}<div class="label">Win Rate</div></div>
        <div class="stat-item"><div class="value positive">+${avgGain}</div><div class="label">Avg Gain</div></div>
        <div class="stat-item"><div class="value negative">${avgLoss}</div><div class="label">Avg Loss</div></div>
        <div class="stat-item"><div class="value">${peakRating}</div><div class="label">Peak Rating</div></div>`;
}

/**
 * Render the settings panel
 */
export async function renderSettingsPanel(settings: Settings): Promise<void> {
    const settingsPanel = document.getElementById('guesslyticsSettingsPanel');
    if (!settingsPanel) return;
    
    const data = await getStoredData();
    const backfillState = await GM_getValue(BACKFILL_STATE_KEY, { lastLimitDays: 0, lastSyncTimestamp: null });
    
    const stats = {
        points: data.overall.length,
        oldest: data.overall.length > 0 ? formatDate(data.overall[0].timestamp) : 'N/A',
        newest: data.overall.length > 0 ? formatDate(data.overall[data.overall.length - 1].timestamp) : 'N/A',
        lastSync: formatDate(backfillState.lastSyncTimestamp)
    };
    
    settingsPanel.innerHTML = `
        <div id="guesslyticsSettingsOverlay"></div>
        <div id="guesslyticsSettingsModal">
            <h2>Guesslytics Settings</h2>
            <div class="settings-section"><h4>Graphs</h4>
                <div class="graph-toggle-row">${Object.entries(DATASET_STYLES).map(([key, val]) => 
                    `<div class="graph-toggle-item"><label for="ds_${key}" style="display:flex;align-items:center;">
                    <span class="color-swatch" style="background:${val.color};"></span>${val.label}</label>
                    <input type="checkbox" id="ds_${key}" data-key="${key}" ${settings.visibleDatasets[key as keyof typeof settings.visibleDatasets] ? 'checked' : ''}>
                    </div>`).join('')}
                </div>
                <div class="settings-row"><label for="showAreaFill">Show Area Fill</label>
                <input type="checkbox" id="showAreaFill" ${settings.showAreaFill ? 'checked' : ''}></div></div>
            <div class="settings-section"><h4>Data Sync</h4>
                <div class="settings-row"><label for="backfillFull">Sync Full History</label>
                <input type="checkbox" id="backfillFull" ${settings.backfillFullHistory ? 'checked' : ''}></div>
                <div class="settings-row" id="backfillDaysRow"><label for="backfillDays">Sync history for (days)</label>
                <input type="number" id="backfillDays" value="${settings.backfillDays}" min="1"></div></div>
            <div class="settings-section"><h4>Advanced</h4>
                <div class="settings-row"><label for="initialZoomDays">Initial Zoom (days)</label>
                <input type="number" id="initialZoomDays" value="${settings.initialZoomDays || 7}" min="1"></div>
                <div class="settings-row"><label for="autoRefreshInterval">Refresh Interval (sec)</label>
                <input type="number" id="autoRefreshInterval" value="${settings.autoRefreshInterval}" min="10"></div>
                <div class="settings-row"><label for="apiRequestDelay">API Request Delay (ms)</label>
                <input type="number" id="apiRequestDelay" value="${settings.apiRequestDelay}" min="50"></div>
                <div class="settings-row"><label for="bgOpacity">Background Opacity (%)</label>
                <input type="range" id="bgOpacity" value="${settings.backgroundOpacity}" min="0" max="100"></div></div>
            <div class="settings-stats"><b>Games Tracked:</b> ${stats.points} | <b>Last Sync:</b> ${stats.lastSync}<br>
            <b>Date Range:</b> ${stats.oldest} – ${stats.newest}</div>
            <div class="settings-actions"><button id="resetSettingsBtn">Reset Settings</button>
            <button id="clearDataBtn">Clear All Data</button></div>
            <div class="settings-footer"><a href="https://github.com/Avanatiker/Guesslytics" target="_blank">
            ${ICONS.GITHUB} Guesslytics v${GM_info.script.version} by Constructor</a></div>
        </div>`;
    
    document.getElementById('guesslyticsSettingsOverlay')!.onclick = () => settingsPanel.style.display = 'none';
    
    // Set initial visibility of backfill days row based on backfillFullHistory setting
    const backfillDaysRow = document.getElementById('backfillDaysRow');
    const fullHistoryCheck = document.getElementById('backfillFull') as HTMLInputElement;
    
    if (backfillDaysRow && fullHistoryCheck) {
        // Set initial visibility
        if (settings.backfillFullHistory) {
            backfillDaysRow.classList.add('hidden');
        } else {
            backfillDaysRow.classList.remove('hidden');
        }
        
        // Add change handler for the fullHistoryCheck checkbox
        fullHistoryCheck.onchange = () => { 
            if (backfillDaysRow) {
                if (fullHistoryCheck.checked) {
                    backfillDaysRow.classList.add('hidden');
                } else {
                    backfillDaysRow.classList.remove('hidden');
                }
            }
            // The saveAndRedraw function will be called by the event handler in index.ts
        };
    }
    
    // Dispatch a custom event to signal that the settings panel has been rendered
    // This allows index.ts to attach event handlers after the panel is rendered
    const settingsRenderedEvent = new CustomEvent('guesslyticsSettingsRendered');
    document.dispatchEvent(settingsRenderedEvent);
}

/**
 * Render the chart
 */
export function renderGraph(data: RatingHistory, settings: Settings): void {
    const wasEmpty = !ratingChart || ratingChart.data.datasets.every((ds: ChartDataset) => ds.data.length === 0);
    const currentZoom = (ratingChart && !wasEmpty) ? 
        { min: ratingChart.scales.x.min, max: ratingChart.scales.x.max } : null;
    
    if (ratingChart) ratingChart.destroy();
    
    const canvas = document.getElementById('guesslyticsCanvas') as HTMLCanvasElement;
    if (!canvas) return;
    
    canvas.style.cursor = 'grab';
    
    const timestamps = data.overall.map(d => new Date(d.timestamp).getTime());
    const minTimestamp = data.overall.length > 0 ? Math.min(...timestamps) : null;
    const maxTimestamp = data.overall.length > 0 ? Math.max(...timestamps) : null;
    
    const datasets = Object.keys(DATASET_STYLES).map(key => {
        const style = DATASET_STYLES[key];
        const gradient = canvas.getContext('2d')!.createLinearGradient(0, 0, 0, isGraphExpanded ? 400 : 210);
        gradient.addColorStop(0, `${style.color}55`); 
        gradient.addColorStop(1, `${style.color}05`);
        
        return {
            label: style.label, 
            data: data[key as keyof RatingHistory].map(d => ({ 
                x: new Date(d.timestamp).getTime(), 
                y: d.rating, 
                gameId: d.gameId 
            })),
            borderColor: style.color, 
            borderWidth: key === 'overall' ? 2.5 : 2,
            pointRadius: 0, 
            pointHoverRadius: 6, 
            pointHoverBorderColor: '#fff', 
            pointHoverBackgroundColor: style.color,
            fill: settings.showAreaFill, 
            backgroundColor: gradient, 
            tension: 0, // Changed from 0.1 to 0 for linear interpolation to avoid tooltip issues
            hidden: !settings.visibleDatasets[key as keyof typeof settings.visibleDatasets]
        };
    });
    
    let wasDragging = false;
    
    const chartOptions: ChartOptions = {
        animation: false, 
        responsive: true, 
        maintainAspectRatio: false,
        interaction: { mode: 'x', intersect: false },
        onClick: (e, elements) => {
            if (wasDragging) return;
            if (elements.length > 0) {
                const { datasetIndex, index } = elements[0];
                const gameId = ratingChart.data.datasets[datasetIndex].data[index].gameId;
                if (gameId) window.open(`https://www.geoguessr.com/duels/${gameId}`, '_blank');
            }
        },
        plugins: { 
            title: { display: false }, 
            legend: { display: false }, 
            tooltip: { 
                position: 'nearest', 
                callbacks: { 
                    // Direct approach to handle tooltip labels
                    // We'll use a custom formatter that completely replaces the default behavior
                    // This ensures we have full control over what's displayed
                    title: (items) => formatDate(items[0].parsed.x),
                    
                    // Disable the default label formatter
                    label: () => null,
                    
                    // Use a custom formatter that builds the entire tooltip content
                    // This gives us complete control over the output
                    afterBody: (tooltipItems) => {
                        // Use a Set to track which datasets we've already processed
                        const processedDatasets = new Set();
                        const lines = [];
                        
                        // Process each tooltip item
                        tooltipItems.forEach(item => {
                            // Only process each dataset once
                            if (!processedDatasets.has(item.dataset.label)) {
                                processedDatasets.add(item.dataset.label);
                                lines.push(`${item.dataset.label}: ${item.parsed.y}`);
                            }
                        });
                        
                        return lines;
                    }
                } 
            }
        },
        scales: { 
            x: { 
                type: 'time', 
                time: { unit: 'day' }, 
                ticks: { color: '#aaa' }, 
                grid: { color: 'rgba(255,255,255,0.1)' } 
            }, 
            y: { 
                ticks: { color: '#aaa' }, 
                grid: { color: 'rgba(255,255,255,0.1)' } 
            } 
        }
    };
    
    if (currentZoom?.min && currentZoom?.max) {
        chartOptions.scales.x.min = currentZoom.min;
        chartOptions.scales.x.max = currentZoom.max;
    } else if (data.overall.length >= 1) {
        const lastTimestamp = data.overall.length > 0 ? 
            new Date(data.overall[data.overall.length - 1].timestamp).getTime() : Date.now();
        const minZoomDate = new Date(lastTimestamp);
        minZoomDate.setDate(minZoomDate.getDate() - (settings.initialZoomDays || 7));
        chartOptions.scales.x.min = minZoomDate.getTime();
        chartOptions.scales.x.max = lastTimestamp;
    }
    
    // Chart.js crosshair plugin
    const crosshairLinePlugin = {
        id: 'crosshairLine',
        afterDatasetsDraw: (chart: any) => {
            const { tooltip, ctx, chartArea: { top, bottom } } = chart;
            if (tooltip.getActiveElements()?.length > 0) {
                const x = tooltip.getActiveElements()[0].element.x;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x, bottom);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.stroke();
                ctx.restore();
            }
        }
    };
    
    ratingChart = new Chart(canvas, { 
        type: 'line', 
        data: { datasets }, 
        options: chartOptions, 
        plugins: [crosshairLinePlugin] 
    });
    
    // Pan and zoom functionality
    let isPanning = false, lastX = 0, startX = 0;
    
    const onPanEnd = () => { 
        if (!isPanning) return; 
        isPanning = false; 
        canvas.style.cursor = 'grab'; 
        if (isGraphExpanded) calculateAndRenderStats(); 
        setTimeout(() => wasDragging = false, 50); 
    };
    
    canvas.onmousedown = (e) => { 
        isPanning = true; 
        lastX = e.clientX; 
        startX = e.clientX; 
        wasDragging = false; 
        canvas.style.cursor = 'grabbing'; 
    };
    
    canvas.onmouseup = onPanEnd;
    canvas.onmouseleave = onPanEnd;
    
    canvas.onmousemove = (e) => {
        if (isPanning) {
            if (Math.abs(e.clientX - startX) > 5) wasDragging = true;
            const deltaX = e.clientX - lastX;
            lastX = e.clientX;
            const scales = ratingChart.scales.x;
            let newMin = scales.min - (scales.max - scales.min) * (deltaX / scales.width);
            let newMax = scales.max - (scales.max - scales.min) * (deltaX / scales.width);
            
            if (data.overall.length > 1) {
                if (newMin < minTimestamp) { 
                    const diff = minTimestamp - newMin; 
                    newMin += diff; 
                    newMax += diff; 
                }
                if (newMax > maxTimestamp) { 
                    const diff = newMax - maxTimestamp; 
                    newMin -= diff; 
                    newMax -= diff; 
                }
            }
            
            ratingChart.options.scales.x.min = newMin;
            ratingChart.options.scales.x.max = newMax;
            ratingChart.update('none');
        }
    };
    
    canvas.onwheel = (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 0.85 : 1.15;
        const scales = ratingChart.scales.x;
        const mouseTimestamp = scales.getValueForPixel(e.offsetX);
        let newMin = mouseTimestamp - (mouseTimestamp - scales.min) * zoomFactor;
        let newMax = mouseTimestamp + (scales.max - mouseTimestamp) * zoomFactor;
        
        if (data.overall.length > 1) {
            if (newMin < minTimestamp) newMin = minTimestamp;
            if (newMax > maxTimestamp) newMax = maxTimestamp;
        }
        
        if (newMax - newMin < 1000 * 60 * 5) return;
        
        ratingChart.options.scales.x.min = newMin;
        ratingChart.options.scales.x.max = newMax;
        ratingChart.update('none');
        
        if(isGraphExpanded) calculateAndRenderStats();
    };
    
    if(isGraphExpanded) calculateAndRenderStats();
}

/**
 * Start the refresh cycle
 */
export function startRefreshCycle(
    userId: string | null,
    settings: Settings,
    checkForUpdatesCallback: (userId: string, isManual: boolean) => Promise<void>
): void {
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    if (countdownIntervalId) clearInterval(countdownIntervalId);
    
    if (!userId || settings.autoRefreshInterval <= 0 || isSyncing) {
        const timerEl = document.getElementById('guesslyticsTimer');
        if(timerEl) timerEl.style.display = 'none';
        return;
    }
    
    const timerEl = document.getElementById('guesslyticsTimer');
    if (!timerEl) return;
    
    timerEl.style.display = 'inline';
    let nextSyncTime = Date.now() + settings.autoRefreshInterval * 1000;
    
    // Immediately update the timer text to avoid showing the old time
    const remaining = Math.round((nextSyncTime - Date.now()) / 1000);
    if (remaining > 0) {
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        timerEl.innerText = minutes > 0 ? 
            `(Next sync in ${minutes}m ${seconds}s)` : 
            `(Next sync in ${seconds}s)`;
    }
    
    refreshIntervalId = window.setInterval(() => { 
        checkForUpdatesCallback(userId, false); 
        nextSyncTime = Date.now() + settings.autoRefreshInterval * 1000; 
    }, settings.autoRefreshInterval * 1000);
    
    countdownIntervalId = window.setInterval(() => {
        const remaining = Math.round((nextSyncTime - Date.now()) / 1000);
        if (remaining > 0) {
            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;
            timerEl.innerText = minutes > 0 ? 
                `(Next sync in ${minutes}m ${seconds}s)` : 
                `(Next sync in ${seconds}s)`;
        }
    }, 1000);
}
