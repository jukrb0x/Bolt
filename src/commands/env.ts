import { defineCommand } from "citty";
import ensureCmd from "./env-ensure";
import probeCmd from "./env-probe";

export default defineCommand({
  meta: {
    name: "env",
    description: "Probe declared environment checks and fill required gaps",
  },
  subCommands: {
    probe: probeCmd,
    ensure: ensureCmd,
  },
});
