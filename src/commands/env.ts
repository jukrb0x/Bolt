import { defineCommand } from "citty";
import probeCmd from "./env-probe";

export default defineCommand({
  meta: {
    name: "env",
    description: "Probe declared environment checks. Does not install tools",
  },
  subCommands: {
    probe: probeCmd,
  },
});
