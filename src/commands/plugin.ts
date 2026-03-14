import { defineCommand } from "citty";
import pluginNewCmd from "./plugin-new";
import pluginListCmd from "./plugin-list";
import pluginBuildCmd from "./plugin-build";

export default defineCommand({
  meta: {
    name: "plugin",
    description: "Manage bolt plugins"
  },
  subCommands: {
    new: pluginNewCmd,
    list: pluginListCmd,
    build: pluginBuildCmd,
  },
});
