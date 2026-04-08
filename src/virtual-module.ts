/**
 * Registers "boltstack" as a Bun virtual module.
 *
 * When Bolt runs as a compiled binary, user plugins cannot resolve "boltstack"
 * from node_modules. This virtual module provides the runtime implementations
 * so that `import { PluginBase, handler, ... } from "boltstack"` works.
 *
 * Must be imported at the very top of src/main.ts — before any user plugin loading.
 */

import { plugin } from "bun";

plugin({
  name: "boltstack-virtual-module",
  setup(build) {
    build.module("boltstack", () => {
      return {
        // Re-export everything the public API needs at runtime
        exports: {
          // From plugin.ts — runtime implementations
          ...require("./plugin"),
        },
        loader: "object",
      };
    });
  },
});
