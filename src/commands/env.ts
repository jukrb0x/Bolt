import { defineCommand } from "citty";
import ensureCmd from "./env-ensure";
import manifestCmd from "./env-manifest";
import probeCmd from "./env-probe";

export default defineCommand({
  meta: {
    name: "env",
    description: "Probe declared environment checks, print the manifest, and fill required gaps",
  },
  subCommands: {
    probe: probeCmd,
    ensure: ensureCmd,
    manifest: manifestCmd,
  },
});
