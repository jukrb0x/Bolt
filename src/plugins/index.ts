// src/plugins/index.ts
import type { BoltPlugin } from "../plugin";
import gitPlugin from "./git";
import svnPlugin from "./svn";
import uePlugin from "./ue";
import fsPlugin from "./fs";
import jsonPlugin from "./json";

// Export plugins for direct access
export const git = gitPlugin;
export const svn = svnPlugin;
export const ue = uePlugin;
export const fs = fsPlugin;
export const json = jsonPlugin;

/** Built-in plugins in registration order. */
export const builtinPlugins: readonly BoltPlugin[] = [
  gitPlugin,
  svnPlugin,
  uePlugin,
  fsPlugin,
  jsonPlugin,
];

// Re-export types
export type { BoltPlugin, BoltPluginHandler, BoltPluginContext } from "../plugin";
