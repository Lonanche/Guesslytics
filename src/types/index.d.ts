declare global {
    interface Window {}

    // Curstom template literal tags (used to minify during build)
    function css(template: TemplateStringsArray, ...args: any[]): string;
    function html(template: TemplateStringsArray, ...args: any[]): string;
}

export {};
