#!/usr/bin/env bun
/**
 * Build script for creating optimized Bolt binaries.
 *
 * Uses a plugin to shim react-devtools-core at build time since it's a dev-only
 * dependency and shouldn't be included in production builds.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { BunPlugin, Build } from "bun";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const target =
  process.argv[2] || (process.platform === "win32" ? "bun-windows-x64" : "bun-darwin-arm64");
const outfile =
  process.argv[3] ||
  (process.platform === "win32" ? "build/bolt-win-x64.exe" : "build/bolt-mac-arm64");

console.log(`Building for ${target}...`);

// Plugin to replace react-devtools-core with an empty shim
// The fix is not released yet:
// @reference https://github.com/vadimdemedes/ink/issues/886
// @pr https://github.com/vadimdemedes/ink/pull/885
const devtoolsShimPlugin: BunPlugin = {
  name: "devtools-shim",
  setup(build) {
    // Intercept imports of react-devtools-core and return empty module
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "shim",
    }));

    build.onLoad({ filter: /.*/, namespace: "shim" }, () => ({
      contents: "export default { initialize: () => {}, connectToDevTools: () => {} };",
      loader: "js",
    }));
  },
};

const result = await Bun.build({
  entrypoints: [join(ROOT, "src/main.ts")],
  compile: {
    target: target as Build.CompileTarget,
    outfile: join(ROOT, outfile),
  },
  minify: {
    whitespace: true,
    identifiers: true,
    syntax: true,
  },
  plugins: [devtoolsShimPlugin],
  // Define NODE_ENV as production so ink's DEV checks are tree-shaken
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.DEV": '"false"',
  },
});

if (!result.success) {
  console.error("Build failed!");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const artifact = result.outputs[0];
console.log(`Built ${outfile} (hash: ${artifact.hash}, kind: ${artifact.kind})`);
