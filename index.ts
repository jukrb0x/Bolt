/**
 * Bolt plugin API — import from here in your plugin files.
 *
 * Project-scope:  .bolt/plugins/<namespace>/index.ts
 * User-scope:     ~/.bolt/plugins/<namespace>/index.ts
 * Explicit path:  bolt.yaml → plugins: [{ namespace, path }]
 *
 * Minimal plugin skeleton:
 *
 *   import type { BoltPlugin } from "bolt";
 *
 *   const plugin: BoltPlugin = {
 *     namespace: "myplugin",
 *     handlers: {
 *       hello: async (params, ctx) => {
 *         ctx.logger.info(`Hello, ${params.name ?? "world"}!`);
 *       },
 *     },
 *   };
 *
 *   export default plugin;
 */

export type { BoltPlugin, BoltPluginHandler, BoltPluginContext } from "./src/plugin";
export type {
  BoltConfig,
  Target,
  TargetKind,
  Step,
  GoPipeline,
  OpsMap,
  OpVariant,
  PluginEntry,
  NotificationsConfig,
  NotifyProviderCfg,
} from "./src/config";
