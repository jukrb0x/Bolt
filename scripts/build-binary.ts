#!/usr/bin/env bun
/**
 * Build script for creating optimized Bolt binaries.
 *
 * Uses a plugin to shim react-devtools-core at build time since it's a dev-only
 * dependency and shouldn't be included in production builds.
 *
 * One target:  bun run scripts/build-binary.ts <bun-target> <outfile>
 * All release targets, plus SHA256SUMS:  bun run scripts/build-binary.ts --all
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Build, BunPlugin } from "bun";
import { RELEASE_BINARIES } from "./release-targets";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Plugin to replace react-devtools-core with an empty shim
// The fix is not released yet:
// @reference https://github.com/vadimdemedes/ink/issues/886
// @pr https://github.com/vadimdemedes/ink/pull/885
const devtoolsShimPlugin: BunPlugin = {
  name: "devtools-shim",
  setup(build) {
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

// Plugin to provide boltstack module for dynamically loaded plugins
// When plugins import from "boltstack", redirect to the internal plugin module
const boltstackPlugin: BunPlugin = {
  name: "boltstack-internal",
  setup(build) {
    build.onResolve({ filter: /^boltstack$/ }, () => ({
      path: join(ROOT, "src/plugin.ts"),
      namespace: "file",
    }));
  },
};

async function buildOne(target: string, outfile: string): Promise<string> {
  const absOut = join(ROOT, outfile);
  mkdirSync(dirname(absOut), { recursive: true });
  console.log(`Building ${target} -> ${outfile}`);

  const result = await Bun.build({
    entrypoints: [join(ROOT, "src/main.ts")],
    compile: {
      target: target as Build.CompileTarget,
      outfile: absOut,
    },
    minify: {
      whitespace: true,
      identifiers: true,
      syntax: true,
    },
    plugins: [devtoolsShimPlugin, boltstackPlugin],
    // Define NODE_ENV as production so ink's DEV checks are tree-shaken
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.DEV": '"false"',
    },
  });

  if (!result.success) {
    console.error(`Build failed for ${target}`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }

  const artifact = result.outputs[0];
  console.log(`Built ${outfile} (hash: ${artifact?.hash}, kind: ${artifact?.kind})`);
  return absOut;
}

function writeChecksums(files: string[]): void {
  const lines = files.map((file) => {
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    return `${hash}  ${basename(file)}`;
  });
  const checksumPath = join(ROOT, "build", "SHA256SUMS");
  writeFileSync(checksumPath, `${lines.join("\n")}\n`);
  console.log(`Wrote ${checksumPath}`);
}

const args = process.argv.slice(2);
if (args[0] === "--all") {
  const declaration = join(ROOT, "build", "bolt.d.ts");
  if (!existsSync(declaration)) {
    console.error("build/bolt.d.ts is missing. Run bun run build:types and copy it into build/.");
    process.exit(1);
  }
  const files: string[] = [];
  for (const spec of RELEASE_BINARIES) {
    files.push(await buildOne(spec.target, join("build", spec.filename)));
  }
  files.push(declaration);
  writeChecksums(files);
} else {
  const target = args[0] || (process.platform === "win32" ? "bun-windows-x64" : "bun-darwin-arm64");
  const outfile =
    args[1] || (process.platform === "win32" ? "build/bolt-win-x64.exe" : "build/bolt-mac-arm64");
  await buildOne(target, outfile);
}
