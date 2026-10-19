/**
 * Fixtures for empty-shell rejection.
 * `shell` is marked studio_setup_shell and writes a marker if called.
 * `bare` reports a structured probe gap, then returns ok() with no changed flag.
 * `echo` returns ok() with no gap fields.
 * `installer` reports a gap and a structured ensure noop.
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { defineHandler, definePlugin, fail, ok } from "boltstack";

function marker(configDir: string, id: string): string {
  return path.join(configDir, ".bolt", "env-checks", id);
}

export default definePlugin({
  namespace: "shellfix",
  version: "0.0.0",
  description: "Empty-shell env.check fixtures",
  apiVersion: 2,
  handlers: {
    shell: defineHandler(
      {
        description: "One-shot setup",
        ai: false,
        capability: "env.check",
        checkId: "fixture.shell",
        studioSetupShell: true,
      },
      async (_params, ctx) => {
        const file = marker(ctx.configDir, "fixture.shell");
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, "ran");
        return ok("setup");
      },
    ),
    bare: defineHandler(
      {
        description: "Ensure result without noop",
        ai: false,
        capability: "env.check",
        checkId: "fixture.bare",
      },
      async (_params, ctx) => {
        if (ctx.envCheck?.action === "ensure") return ok("setup complete");
        return fail("missing", {
          data: { current: null, expected: "present", fix: "Return data.changed from ensure" },
        });
      },
    ),
    echo: defineHandler(
      {
        description: "Probe result without gap fields",
        ai: false,
        capability: "env.check",
        checkId: "fixture.echo",
      },
      async () => ok("please install"),
    ),
    installer: defineHandler(
      {
        description: "Installer adapter that returns a structured noop",
        ai: false,
        capability: "env.check",
        checkId: "fixture.installer",
      },
      async (_params, ctx) => {
        if (ctx.envCheck?.action === "ensure") {
          return ok("installer noop", {
            data: {
              current: null,
              expected: "present",
              fix: null,
              changed: false,
              reason: "already_satisfied",
            },
          });
        }
        return fail("missing", {
          data: { current: null, expected: "present", fix: "Install via adapter" },
        });
      },
    ),
  },
});
