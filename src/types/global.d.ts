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
    };
    
    function register(...plugins: any[]): void;
}

declare class Chart {
    constructor(canvas: HTMLCanvasElement, config: any);
    destroy(): void;
    update(mode?: string): void;
    scales: {
        x: {
            min: number;
            max: number;
            width: number;
            getValueForPixel(pixel: number): number;
        };
    };
    data: {
        datasets: any[];
    };
    options: any;
}
