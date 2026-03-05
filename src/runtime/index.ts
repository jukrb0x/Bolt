// src/runtime/index.ts
export type { Runtime, SpawnResult, SpawnOptions } from "./types";
export { createBunRuntime } from "./bun";
export { createNodeRuntime } from "./node";

import type { Runtime } from "./types";
import { createBunRuntime } from "./bun";
import { createNodeRuntime } from "./node";

/**
 * Create a runtime, auto-detecting Bun vs Node.js environment.
 */
export function createRuntime(): Runtime {
  // @ts-ignore - Bun global exists in Bun runtime
  if (typeof Bun !== "undefined") {
    return createBunRuntime();
  }
  return createNodeRuntime();
}
