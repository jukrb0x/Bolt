import { defineCommand, runMain } from "citty"
import runCmd  from "./commands/run"
import listCmd from "./commands/list"
import infoCmd from "./commands/info"

const main = defineCommand({
  meta: {
    name: "bolt",
    version: "0.1.0",
    description: "Unreal Engine build automation",
  },
  subCommands: {
    run:  runCmd,
    list: listCmd,
    info: infoCmd,
  },
})

runMain(main)
