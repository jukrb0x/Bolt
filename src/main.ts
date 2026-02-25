import { defineCommand, runMain } from "citty";
import runCmd from "./commands/run";
import listCmd from "./commands/list";
import infoCmd from "./commands/info";
import goCmd from "./commands/go";
import checkCmd from "./commands/check";
import versionCmd from "./commands/version";
import updateCmd from "./commands/update";
import pkg from "../package.json";

const main = defineCommand({
  meta: {
    name: "bolt",
    version: pkg.version,
    description: "Unreal Engine build automation",
  },
  subCommands: {
    run: runCmd,
    list: listCmd,
    info: infoCmd,
    go: goCmd,
    check: checkCmd,
    version: versionCmd,
    "self-update": updateCmd,
  },
});

runMain(main);
