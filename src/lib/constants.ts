import { DatasetStyle, Settings } from '../types';

// Settings constants
export const SETTINGS_KEY = 'guesslyticsSettings';
export const RATING_HISTORY_KEY = 'guesslyticsRatingHistory';
export const BACKFILL_STATE_KEY = 'guesslyticsBackfillState';

// Default settings
export const DEFAULT_SETTINGS: Settings = {
    statsTimeframe: 7,
    backfillFullHistory: false,
    backfillDays: 30,
    showAreaFill: true,
    visibleDatasets: { overall: true, moving: true, noMove: true, nmpz: true },
    autoRefreshInterval: 60,
    apiRequestDelay: 250,
    backgroundOpacity: 15,
    initialZoomDays: 7,
    verboseLogging: false,
};

// Icons for UI
export const ICONS = {
    EXPAND: `<i class="fa-solid fa-expand"></i>`,
    COLLAPSE: `<i class="fa-solid fa-compress"></i>`,
    SETTINGS: `<i class="fa-solid fa-gear"></i>`,
    GITHUB: `<i class="fa-brands fa-github"></i>`,
    RESYNC: `<i class="fa-solid fa-sync-alt"></i>`,
    CHART: `<i class="fa-solid fa-chart-line" style="color: white;"></i>`,
};

// Dataset styles for chart
export const DATASET_STYLES: Record<string, DatasetStyle> = {
    overall: { label: 'Overall', color: '#FFFFFF' },
    moving: { label: 'Moving', color: '#4A90E2' },
    noMove: { label: 'No Move', color: '#F5A623' },
    nmpz: { label: 'NMPZ', color: '#BD10E0' }
};
