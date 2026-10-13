// Compile-time checks for the public plugin API. `bun run typecheck` enforces them;
// the single runtime test keeps bun from reporting an empty file.
import { expect, test } from "bun:test";
import type * as Api from "../plugin-api";

declare const defineHandler: typeof Api.defineHandler;
declare const ctx: Api.BoltPluginContext;

export function typeChecks(): void {
  defineHandler({}, async () => ({ status: "ok", summary: "fine" }));
  defineHandler({}, async () => undefined);
  defineHandler({ capability: ["doctor", "x-acme.audit"] }, async () => {});
  // @ts-expect-error "success" is not a HandlerStatus
  defineHandler({}, async () => ({ status: "success" }));
  // @ts-expect-error Date is not JSON data
  defineHandler({}, async () => ({ status: "ok", data: new Date() }));

  // A hand-written mock without emit still compiles: emit is optional.
  const mock: Api.BoltPluginContext = {
    cfg: ctx.cfg,
    configDir: "/",
    dryRun: false,
    logger: ctx.logger,
    runtime: ctx.runtime,
  };
  mock.emit?.({ type: "progress", progress: { current: 1 } });

  // V2 context: emit is required.
  const v2: Api.BoltPluginContextV2 = { ...mock, emit: () => {} };
  v2.emit({ type: "log", message: "hi" });
  // @ts-expect-error emit is required on BoltPluginContextV2
  const missing: Api.BoltPluginContextV2 = mock;
  void missing;
}

test("public types compile (see bun run typecheck)", () => {
  expect(typeof typeChecks).toBe("function");
});
