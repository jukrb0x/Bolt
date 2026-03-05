// src/core/index.ts

// Core classes
export { Runner } from "../runner";
export { Logger } from "../logger";
export { PluginRegistry, buildRegistry } from "../plugin-registry";

// Runtime
export { createRuntime, createBunRuntime, createNodeRuntime } from "../runtime";
export type { Runtime, SpawnResult, SpawnOptions } from "../runtime";

// Types
export type { BoltPluginContext, BoltPlugin, BoltPluginHandler, BoltLogger } from "../plugin";
