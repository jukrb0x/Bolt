// Register boltstack as a runtime module for dynamically loaded plugins
// This allows plugins to import { PluginBase, handler } from "boltstack"
Bun.plugin({
  name: "boltstack-resolver",
  setup(build) {
    build.module("boltstack", () => {
      return {
        exports: {
          PluginBase: require("./plugin").PluginBase,
          handler: require("./plugin").handler,
        },
      };
    });
  },
});

import { defineCommand, runMain } from "citty";
import runCmd from "./commands/run";
import listCmd from "./commands/list";
import infoCmd from "./commands/info";
import goCmd from "./commands/go";
import checkCmd from "./commands/check";
import versionCmd from "./commands/version";
import updateCmd from "./commands/update";
import pluginCmd from "./commands/plugin";
import configCmd from "./commands/config";
import inspectCmd from "./commands/inspect";
import helpCmd from "./commands/help";
import initCmd from "./commands/init";
import aiCmd from "./commands/ai";
import pkg from "../package.json";

// Export PluginBase and handler for dynamically loaded plugins
// This allows plugins to import from "boltstack" at runtime
export { PluginBase, handler } from "./plugin";

const main = defineCommand({
  meta: {
    name: "bolt",
    version: pkg.version,
    description: "Bolt - build and workflow automation for Unreal Engine",
  },
  subCommands: {
    go: goCmd,
    run: runCmd,
    list: listCmd,
    info: infoCmd,
    check: checkCmd,
    config: configCmd,
    init: initCmd,
    plugin: pluginCmd,
    inspect: inspectCmd,
    "self-update": updateCmd,
    ai: aiCmd,
    help: helpCmd,
    version: versionCmd,
  },
});

runMain(main);
