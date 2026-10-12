// src/index.ts
// High-level API
export { run, createContext, type RunOptions, type CreateContextOptions } from "./api";

// Config
export { loadConfig, checkConfig } from "./config";
export type { BoltConfig, PluginEntry, Project, Flow, Step } from "./config";

// Types
export type {
  AiMode,
  BoltPlugin,
  BoltPluginHandler,
  BoltPluginContext,
  BoltLogger,
  HandlerDef,
  HandlerManifest,
  PluginManifest,
  PluginMeta,
  PluginLifecycleHooks,
} from "./plugin";

// Plugin API. definePlugin returns a plugin object; class plugins use withDescriptor.
export { PLUGIN_API_VERSION, PluginBase, defineHandler, definePlugin, handler } from "./plugin";
