// Tampermonkey API types
declare function GM_setValue(key: string, value: any): void;
declare function GM_getValue(key: string, defaultValue?: any): any;
declare function GM_addStyle(css: string): void;
declare interface GM_xmlhttpRequestOptions {
    method: string;
    url: string;
    responseType?: string;
    timeout?: number;
    onload?: (response: GM_xmlhttpRequestResponse) => void;
    onerror?: (error: any) => void;
    ontimeout?: () => void;
}
declare interface GM_xmlhttpRequestResponse {
    status: number;
    response: any;
    responseText?: string;
}
declare function GM_xmlhttpRequest(options: GM_xmlhttpRequestOptions): void;

// Chart.js types - used in index.ts and ui.ts
// eslint-disable-next-line no-unused-vars
declare const Chart: any;

// Application types
export interface Settings {
    statsTimeframe: number;
    backfillFullHistory: boolean;
    backfillDays: number;
    showAreaFill: boolean;
    visibleDatasets: {
        overall: boolean;
        moving: boolean;
        noMove: boolean;
        nmpz: boolean;
    };
    autoRefreshInterval: number;
    apiRequestDelay: number;
    backgroundOpacity: number;
    initialZoomDays?: number;
}

export interface RatingEntry {
    timestamp: string;
    rating: number;
    gameId: string;
}

export interface RatingHistory {
    overall: RatingEntry[];
    moving: RatingEntry[];
    noMove: RatingEntry[];
    nmpz: RatingEntry[];
}

export interface BackfillState {
    lastLimitDays: number;
    lastSyncTimestamp: number | null;
}

export interface DatasetStyle {
    label: string;
    color: string;
}

export interface FeedEntry {
    type: number;
    payload: string | any;
    time?: string;
}

export interface FeedResponse {
    entries: FeedEntry[];
    paginationToken: string;
}

export interface DuelPlayer {
    playerId: string;
    progressChange?: {
        rankedSystemProgress?: {
            gameMode: string;
            ratingAfter?: number;
            gameModeRatingAfter?: number;
        };
    };
}

export interface DuelTeam {
    players: DuelPlayer[];
}

export interface DuelResponse {
    teams: DuelTeam[];
}

export interface ChartDataPoint {
    x: number;
    y: number;
    gameId: string;
}

export interface ChartDataset {
    label: string;
    data: ChartDataPoint[];
    borderColor: string;
    borderWidth: number;
    pointRadius: number;
    pointHoverRadius: number;
    pointHoverBorderColor: string;
    pointHoverBackgroundColor: string;
    fill: boolean;
    backgroundColor: any;
    tension: number;
    hidden: boolean;
}

export interface ChartOptions {
    animation: boolean;
    responsive: boolean;
    maintainAspectRatio: boolean;
    interaction: {
        mode: string;
        intersect: boolean;
    };
    onClick: (e: any, elements: any[]) => void;
    plugins: {
        title: {
            display: boolean;
        };
        legend: {
            display: boolean;
        };
        tooltip: {
            position: string;
            callbacks: {
                title: (items: any[]) => string;
                beforeLabel?: (ctx: any) => boolean | void;
                label: (ctx: any) => string | null;
                afterBody?: (tooltipItems: any[]) => string[];
                afterFooter?: (ctx: any) => string | null;
                labels?: (tooltipItems: any[]) => string[];
            };
        };
    };
    scales: {
        x: {
            type: string;
            time: {
                unit: string;
            };
            ticks: {
                color: string;
            };
            grid: {
                color: string;
            };
            min?: number;
            max?: number;
        };
        y: {
            ticks: {
                color: string;
            };
            grid: {
                color: string;
            };
        };
    };
}
