import { execSync as nodeExecSync } from "child_process";
import pathfs from "path";
import prependFile from "prepend-file";

import pkg from "../../package.json";

export const pkgValue = (key: string) =>
    pkg?.tampermonkey?.[key] || pkg[key as keyof typeof pkg] || "";

export const pluginOutputFile = pathfs.join(process.cwd(), pkgValue("outputFile"));

export const execSync = (
    cmd: string
): {
    output: string;
    exitCode: number;
} => {
    try {
        return { output: nodeExecSync(cmd).toString(), exitCode: 0 };
    } catch (error) {
        return {
            output: error?.message || error?.stderr || error?.stdout || "",
            exitCode: error?.status || 1
        };
    }
};

export const patchBuild = async (silent = false) => {
    if (!silent) console.log(`> Patching build`);

    // @TODO:
    // @run-at       document-start

    // Get array values from package.json
    const grants = pkg.tampermonkey.grant || [];
    const requires = pkg.tampermonkey.require || [];
    const matches = Array.isArray(pkg.tampermonkey.match) ? pkg.tampermonkey.match : [pkg.tampermonkey.match];
    const connects = Array.isArray(pkg.tampermonkey.connect) ? pkg.tampermonkey.connect : [pkg.tampermonkey.connect];
    
    // Build metadata header
    let metadata = `// ==UserScript==
// @name         ${pkgValue("name")}
// @namespace    ${pkgValue("namespace")}
// @version      ${pkgValue("version")}
// @description  ${pkgValue("description")}
// @author       ${pkgValue("author")}
`;

    // Add match directives
    matches.forEach(match => {
        if (match) metadata += `// @match        ${match}\n`;
    });

    // Add connect directives
    connects.forEach(connect => {
        if (connect) metadata += `// @connect      ${connect}\n`;
    });

    // Add grant directives
    grants.forEach(grant => {
        if (grant) metadata += `// @grant        ${grant}\n`;
    });

    // Add require directives
    requires.forEach(require => {
        if (require) metadata += `// @require      ${require}\n`;
    });

    // Add update and download URLs
    if (pkgValue("updateURL")) metadata += `// @updateURL    ${pkgValue("updateURL")}\n`;
    if (pkgValue("downloadURL")) metadata += `// @downloadURL  ${pkgValue("downloadURL")}\n`;

    // Close metadata
    metadata += `// ==/UserScript==
`;

    await prependFile(
        pluginOutputFile,
        metadata
    );

    if (!silent)
        console.log(`✔ Finished script ${pkgValue("name")} v${pkgValue("version")}`);
};
