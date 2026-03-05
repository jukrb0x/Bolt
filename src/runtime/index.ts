// src/runtime/index.ts
export type { Runtime, SpawnResult, SpawnOptions } from "./types";
export { createBunRuntime } from "./bun";
export { createNodeRuntime } from "./node";

/**
 * Create a runtime, auto-detecting Bun vs Node.js environment.
 */
export function createRuntime(): import("./types").Runtime {
  if (typeof Bun !== "undefined") {
    return require("./bun").createBunRuntime();
  }
  return require("./node").createNodeRuntime();
}
