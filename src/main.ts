import "./virtual-module"; // Register "boltstack" virtual module before anything loads plugins
import { defineCommand, runMain } from "citty";
import { cleanupInstalledBolt } from "./commands/update";
import { commands } from "./commands";
import { VERSION } from "./version";
import { checkGlobalArgs } from "./global-args";
import { USAGE_EXIT_CODE } from "./commands/run";

if (process.platform === "win32") cleanupInstalledBolt(process.execPath);

const main = defineCommand({
  meta: {
    name: "bolt",
    version: VERSION,
    description: "Bolt - build and workflow automation for game development",
  },
  subCommands: commands,
});

const globalError = checkGlobalArgs(process.argv.slice(2));
if (globalError) {
  console.error(`[ERROR] ${globalError}`);
  process.exit(USAGE_EXIT_CODE);
}

runMain(main);
