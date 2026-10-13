import "./virtual-module"; // Register "boltstack" virtual module before anything loads plugins
import { defineCommand, runMain } from "citty";
import { cleanupInstalledBolt } from "./commands/update";
import { commands } from "./commands";
import { VERSION } from "./version";

if (process.platform === "win32") cleanupInstalledBolt(process.execPath);

const main = defineCommand({
  meta: {
    name: "bolt",
    version: VERSION,
    description: "Bolt - build and workflow automation for game development",
  },
  subCommands: commands,
});

runMain(main);
