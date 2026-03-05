// src/plugins/index.ts
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

// Export collection for registry
export const builtinPlugins = {
  git: gitPlugin,
  svn: svnPlugin,
  ue: uePlugin,
  fs: fsPlugin,
  json: jsonPlugin,
};

// Re-export types
export type { BoltPlugin, BoltPluginHandler, BoltPluginContext } from "../plugin";
