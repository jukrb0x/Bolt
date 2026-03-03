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
import pkg from "../package.json";

const main = defineCommand({
  meta: {
    name: "bolt",
    version: pkg.version,
    description: "Bolt - build and workflow automation for Unreal Engine",
  },
  subCommands: {
    run: runCmd,
    list: listCmd,
    info: infoCmd,
    go: goCmd,
    check: checkCmd,
    version: versionCmd,
    "self-update": updateCmd,
    plugin: pluginCmd,
    config: configCmd,
    inspect: inspectCmd,
  },
});

runMain(main);
