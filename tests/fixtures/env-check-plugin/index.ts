/**
 * Test fixture for `bolt env probe` and `bolt env ensure`.
 * A check is present when `<project>/.bolt/env-checks/<id>` exists.
 * Ensure creates that file. Probe only reads it.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
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
      const present = existsSync(marker);
      if (ctx.envCheck?.action === "ensure") {
        if (present || ctx.dryRun) {
          return ok(present ? "present" : "missing", {
            data: {
              current: present ? "present" : null,
              expected,
              fix: present ? null : "Install via fixture plugin ensure adapter",
              changed: false,
            },
          });
        }
        mkdirSync(path.dirname(marker), { recursive: true });
        writeFileSync(marker, "");
        return ok("ensured", {
          data: { current: "present", expected, fix: null, changed: true },
        });
      }
      if (present) {
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
