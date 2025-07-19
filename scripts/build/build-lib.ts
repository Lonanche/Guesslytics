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

    await prependFile(
        pluginOutputFile,
        `// ==UserScript==
// @name         ${pkgValue("name")}
// @description  ${pkgValue("description")}
// @version      ${pkgValue("version")}
// @author       ${pkgValue("author")}
// @updateURL    ${pkgValue("updateURL")}
// @downloadURL  ${pkgValue("downloadURL")}
// @match        */*
// @grant        none
// @run-at       document-start
// ==/UserScript==
`
    );

    if (!silent)
        console.log(`✔ Finished script ${pkgValue("name")} v${pkgValue("version")}`);
};
