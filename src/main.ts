import { defineCommand, runMain } from "citty"
import runCmd  from "./commands/run"
import listCmd from "./commands/list"
import infoCmd from "./commands/info"
import pkg from "../package.json"

const main = defineCommand({
  meta: {
    name: "bolt",
    version: pkg.version,
    description: "Unreal Engine build automation",
  },
  subCommands: {
    run:  runCmd,
    list: listCmd,
    info: infoCmd,
  },
})

runMain(main)
