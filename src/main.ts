import "./virtual-module"; // Register "boltstack" virtual module before anything loads plugins
import { defineCommand, runMain } from "citty";
import runCmd from "./commands/run";
import listCmd from "./commands/list";
import infoCmd from "./commands/info";
import checkCmd from "./commands/check";
import versionCmd from "./commands/version";
import updateCmd from "./commands/update";
import pluginCmd from "./commands/plugin";
import configCmd from "./commands/config";
import inspectCmd from "./commands/inspect";
import initCmd from "./commands/init";
import aiCmd from "./commands/ai";
import pkg from "../package.json";

const main = defineCommand({
  meta: {
    name: "bolt",
    version: pkg.version,
    description: "Bolt - build and workflow automation for game development",
  },
  subCommands: {
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
    version: versionCmd,
  },
});

runMain(main);
