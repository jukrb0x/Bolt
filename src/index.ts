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
  BoltPluginContextV2,
  BoltLogger,
  Artifact,
  BoltEvent,
  Capability,
  Diagnostic,
  HandlerResult,
  HandlerStatus,
  JsonValue,
  KnownCapability,
  NextStep,
  HandlerDef,
  HandlerManifest,
  PluginManifest,
  PluginMeta,
  PluginLifecycleHooks,
} from "./plugin";

// Plugin API. definePlugin returns a plugin object; class plugins use withDescriptor.
export {
  PLUGIN_API_VERSION,
  SUPPORTED_PLUGIN_API_VERSIONS,
  PluginBase,
  createTestContext,
  defineHandler,
  definePlugin,
  fail,
  handler,
  ok,
  skipped,
  warn,
} from "./plugin";
