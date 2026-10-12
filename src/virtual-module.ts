/**
 * Registers "boltstack" and "zod" as Bun virtual modules.
 *
 * When Bolt runs as a compiled binary, user plugins cannot resolve these
 * packages from node_modules. One host instance is published for each name
 * so plugin zod schemas stay `instanceof` the host's ZodType.
 *
 * Must be imported at the very top of src/main.ts — before any user plugin loading.
 * The zod namespace is captured before `plugin()` runs, so this file does not
 * resolve "zod" through the hook it is about to install.
 */

import { plugin } from "bun";
import * as zod from "zod";

plugin({
  name: "boltstack-virtual-module",
  setup(build) {
    build.module("boltstack", () => {
      return {
        exports: {
          ...require("./plugin"),
        },
        loader: "object",
      };
    });

    build.module("zod", () => {
      return {
        exports: zod,
        loader: "object",
      };
    });
  },
});
