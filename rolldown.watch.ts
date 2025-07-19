import chokidar from "chokidar";
import { OutputOptions, rolldown } from "rolldown";

import pkg from "./package.json";
import rolldownConfig from "./rolldown.config.ts";
import { execSync, patchBuild } from "./scripts/build/build-lib";

const config = {
    // Run lint before build,
    // @Note: This is very slow
    shouldLint: false
};

console.log("Watching for changes...");
if (!config.shouldLint) {
    console.log(
        "\x1b[33m",
        "⚠  Type checks and linting won't run while in watch mode. It is recommended to run `yarn build` afterwards.",
        "\x1b[0m"
    );
}
console.log("");

const _internal = {
    count: 0,
    start: 0
};

chokidar.watch("./src").on("change", async (path) => {
    _internal.count++;
    _internal.start = Date.now();
    console.log(`Found ${path} changed, rebuilding...`);

    if (config.shouldLint) {
        const { output: lintOutput, exitCode: lintExitCode } = execSync("yarn lint");
        if (lintExitCode !== 0) {
            console.log("❌ Linting failed");
            console.log(lintOutput);
            return;
        }
    }

    const bundle = await rolldown(rolldownConfig);
    await bundle.write(rolldownConfig.output as OutputOptions);

    await patchBuild(true);

    const duration = Date.now() - _internal.start;
    console.log(`✅ Rebuilt ${pkg.tampermonkey.outputFile} in ${duration}ms`);
});
