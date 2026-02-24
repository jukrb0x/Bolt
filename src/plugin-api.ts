/**
 * Public API surface for Bolt plugins.
 * This file is the entry point for `tsconfig.types.json` — tsc emits bolt.d.ts from here.
 * Keep this file free of any runtime imports (bun, zod, fs, etc.).
 */

// Plugin interfaces
export type { BoltPlugin, BoltPluginHandler, BoltPluginContext, BoltLogger } from "./plugin";

// Config types available on ctx.cfg
export type {
  BoltConfig,
  Target,
  TargetKind,
  Step,
  GoPipeline,
  OpVariant,
  OpsMap,
  PluginEntry,
  NotificationsConfig,
  NotifyProviderCfg,
} from "./config-types";
