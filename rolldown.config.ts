import { defineConfig } from "rolldown";
import { cssMinify, htmlMinify } from "./scripts/minify";

import pkg from "./package.json" assert { type: "json" };

// https://rollupjs.org/introduction/
export default defineConfig({
    input: "src/index.ts",
    plugins: [
        cssMinify(),
        htmlMinify(),
    ],
    resolve: {
        extensions: [".ts", ".js", ".tsx", ".jsx"],
        tsconfigFilename: "tsconfig.json",
    },
    output: {
        file: pkg.tampermonkey.outputFile,
        format: "iife",
        sourcemap: false,
        minify: true,
    },
    watch: {
        include: "src/**",
    },
});
