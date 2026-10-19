/**
 * Test fixture for `bolt env probe`. Not an installer.
 * A check is present when `<project>/.bolt/env-checks/<id>` exists.
 */
import { existsSync } from "fs";
import path from "path";
import { defineHandler, definePlugin, fail, ok } from "boltstack";

function probe(id: string) {
  return defineHandler(
    {
      description: `Probe ${id}`,
      ai: true,
      capability: "env.check",
      checkId: id,
    },
    async (_params, ctx) => {
      const expected = ctx.envCheck?.version ?? "present";
      const marker = path.join(ctx.configDir, ".bolt", "env-checks", id);
      if (existsSync(marker)) {
        return ok("present", { data: { current: "present", expected, fix: null } });
      }
      return fail("missing", {
        data: {
          current: null,
          expected,
          fix: "Install via fixture plugin ensure adapter",
        },
      });
    },
  );
}

export default definePlugin({
  namespace: "fixture",
  version: "0.0.0",
  description: "Fixture env checks",
  apiVersion: 2,
  handlers: {
    tool_a: probe("fixture.tool.a"),
    tool_b: probe("fixture.tool.b"),
  },
});
