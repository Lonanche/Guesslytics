// Tampermonkey API declarations
declare function GM_setValue(key: string, value: any): Promise<void>;
declare function GM_getValue(key: string, defaultValue?: any): Promise<any>;
declare function GM_addStyle(css: string): void;

interface GM_ScriptInfo {
    script: {
        version: string;
        name: string;
        author: string;
        description: string;
        namespace: string;
    };
}

declare const GM_info: GM_ScriptInfo;

interface GM_xmlhttpRequestResponse {
    status: number;
    response: any;
    responseText?: string;
}

interface GM_xmlhttpRequestOptions {
    method: string;
    url: string;
    responseType?: string;
    timeout?: number;
    onload?: (response: GM_xmlhttpRequestResponse) => void;
    onerror?: (error: any) => void;
    ontimeout?: () => void;
}

declare function GM_xmlhttpRequest(options: GM_xmlhttpRequestOptions): void;

// Chart.js declarations
declare namespace Chart {
    const defaults: {
        font: {
            family: string;
        };
        color: string;
        borderColor: string;
        plugins: {
            tooltip: {
                backgroundColor: string;
                titleColor: string;
                bodyColor: string;
                borderColor: string;
                borderWidth: number;
            };
            legend: {
                labels: {
                    color: string;
                };
            };
        };
    };
    
    function register(...plugins: any[]): void;
    
    interface ChartArea {
        top: number;
        right: number;
        bottom: number;
        left: number;
        width: number;
        height: number;
    }
    
    interface TooltipItem {
        chart: Chart;
        label: string;
        datasetIndex: number;
        index: number;
        parsed: {
            x: number;
            y: number;
        };
        formattedValue: string;
        dataset: {
            label: string;
            data: any[];
        };
        element: {
            x: number;
            y: number;
        };
    }
    
    interface Plugin {
        id: string;
        beforeInit?: (chart: Chart) => void;
        afterInit?: (chart: Chart) => void;
        beforeUpdate?: (chart: Chart) => void;
        afterUpdate?: (chart: Chart) => void;
        beforeDraw?: (chart: Chart) => void;
        afterDraw?: (chart: Chart) => void;
        beforeDatasetsDraw?: (chart: Chart) => void;
        afterDatasetsDraw?: (chart: Chart, args: any) => void;
        beforeEvent?: (chart: Chart, event: any) => void;
        afterEvent?: (chart: Chart, event: any) => void;
        resize?: (chart: Chart) => void;
        destroy?: (chart: Chart) => void;
    }
}

declare class Chart {
    constructor(canvas: HTMLCanvasElement, config: {
        type: string;
        data: {
            datasets: any[];
        };
        options: any;
        plugins?: Chart.Plugin[];
    });
    
    destroy(): void;
    update(mode?: 'none' | 'normal' | 'reset' | 'resize' | 'show' | 'hide' | 'active' | 'inactive'): void;
    
    scales: {
        x: {
            min: number;
            max: number;
            width: number;
            getValueForPixel(pixel: number): number;
        };
        y: {
            min: number;
            max: number;
            height: number;
            getValueForPixel(pixel: number): number;
        };
    };
    
    data: {
        datasets: any[];
    };
    
    options: any;
    
    ctx: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
    chartArea: Chart.ChartArea;
    
    getElementsAtEventForMode(e: Event, mode: string, options: any, useFinalPosition: boolean): any[];
    getDatasetMeta(datasetIndex: number): any;
    getActiveElements(): any[];
    tooltip: {
        getActiveElements(): any[];
    };
}
