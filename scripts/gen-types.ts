#!/usr/bin/env bun
/**
 * Generates bolt.d.ts by concatenating the tsc-emitted declaration files.
 * Run after: bunx tsc --project tsconfig.types.json
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const dist = join(import.meta.dir, "..", "dist-types");

const header = `/**
 * Type declarations for Bolt plugins.
 * Import as: import type { BoltPlugin, BoltPluginContext } from "bolt";
 *
 * Generated — do not edit by hand. Run: bun run build:types
 */

declare module "bolt" {`;

// Read the two source files, strip their own doc comments and "import type" lines
function stripHeader(src: string): string {
  return src
    .split("\n")
    .filter((line) => !line.startsWith("/**") && !line.startsWith(" *") && !line.startsWith("import type"))
    .join("\n")
    .replace(/^\n+/, "")
    .trimEnd();
}

const configTypes = stripHeader(readFileSync(join(dist, "config-types.d.ts"), "utf8"));
const plugin = stripHeader(readFileSync(join(dist, "plugin.d.ts"), "utf8"));

const body = [configTypes, plugin]
  .map((block) =>
    block
      .split("\n")
      .map((line) => (line.trim() === "" ? "" : "  " + line))
      .join("\n"),
  )
  .join("\n\n");

const output = `${header}\n${body}\n}\n`;

const outPath = join(import.meta.dir, "..", "bolt.d.ts");
writeFileSync(outPath, output, "utf8");
console.log("Generated bolt.d.ts");
