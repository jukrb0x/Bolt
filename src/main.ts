import "./virtual-module"; // Register "boltstack" virtual module before anything loads plugins
import { defineCommand, runMain } from "citty";
import runCmd from "./commands/run";
import listCmd from "./commands/list";
import infoCmd from "./commands/info";
import checkCmd from "./commands/check";
import migrateCmd from "./commands/migrate";
import versionCmd from "./commands/version";
import updateCmd, { cleanupInstalledBolt } from "./commands/update";
import pluginCmd from "./commands/plugin";
import configCmd from "./commands/config";
import inspectCmd from "./commands/inspect";
import initCmd from "./commands/init";
import typesCmd from "./commands/types";
import aiCmd from "./commands/ai";
import { VERSION } from "./version";

if (process.platform === "win32") cleanupInstalledBolt(process.execPath);

const main = defineCommand({
  meta: {
    name: "bolt",
    version: VERSION,
    description: "Bolt - build and workflow automation for game development",
  },
  subCommands: {
    run: runCmd,
    list: listCmd,
    info: infoCmd,
    check: checkCmd,
    migrate: migrateCmd,
    config: configCmd,
    init: initCmd,
    types: typesCmd,
    plugin: pluginCmd,
    inspect: inspectCmd,
    "self-update": updateCmd,
    ai: aiCmd,
    version: versionCmd,
  },
});

runMain(main);
