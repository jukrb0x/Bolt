import { defineCommand } from "citty";
import pluginNewCmd from "./plugin-new";
import pluginListCmd from "./plugin-list";

export default defineCommand({
  meta: {
    name: "plugin",
    description: "Manage bolt plugins"
  },
  subCommands: {
    new: pluginNewCmd,
    list: pluginListCmd,
  },
});
