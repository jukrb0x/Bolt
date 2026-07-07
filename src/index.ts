// src/index.ts
// High-level API
export { run, createContext, type RunOptions, type CreateContextOptions } from "./api";

// Config
export { loadConfig, checkConfig } from "./config";
export type {
  BoltConfig,
  Project,
  RepoConfig,
  Target,
  Flow,
  Step,
} from "./config";

// Types
export type {
  BoltPlugin,
  BoltPluginHandler,
  BoltPluginContext,
  BoltLogger,
} from "./plugin";

// Plugin API (class-based)
export { PluginBase, handler } from "./plugin";
