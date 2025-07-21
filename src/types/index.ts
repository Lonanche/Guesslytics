// Application types are defined here
// Tampermonkey API types and Chart.js types are defined in global.d.ts

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
    verboseLogging: boolean;
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
    ended?: boolean;
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
            backgroundColor?: string;
            titleColor?: string;
            bodyColor?: string;
            borderColor?: string;
            borderWidth?: number;
            padding?: number;
            displayColors?: boolean;
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
