import { expect, test } from "bun:test";
import { Notifier, WeComProvider, TelegramProvider } from "../notify";
import type { BuildContext } from "../notify";

const ctx: BuildContext = {
  buildId: "20260303_142035",
  projectName: "MyGame",
  gitBranch: "main",
  startTime: new Date("2026-03-03T14:20:35").getTime(),
};

// ─── Notifier flag gating ─────────────────────────────────────────────────────

test("Notifier does not fire start event when on_start=false", async () => {
  let calls = 0;
  const p = { send: async () => { calls++; } };
  const notifier = new (Notifier as any)([p], { on_start: false, on_op_complete: true, on_failure: true, on_complete: true });
  await notifier.fire({ kind: "start", ctx, ops: ["build"] });
  expect(calls).toBe(0);
});

test("Notifier fires start event when on_start=true", async () => {
  let calls = 0;
  const p = { send: async () => { calls++; } };
  const notifier = new (Notifier as any)([p], { on_start: true, on_op_complete: false, on_failure: false, on_complete: false });
  await notifier.fire({ kind: "start", ctx, ops: ["build"] });
  expect(calls).toBe(1);
});

test("Notifier does not fire op_complete when on_op_complete=false", async () => {
  let calls = 0;
  const p = { send: async () => { calls++; } };
  const notifier = new (Notifier as any)([p], { on_start: true, on_op_complete: false, on_failure: true, on_complete: true });
  await notifier.fire({ kind: "op_complete", ctx, opName: "build", opDuration: 1000 });
  expect(calls).toBe(0);
});

test("Notifier does not fire op_failure when on_failure=false", async () => {
  let calls = 0;
  const p = { send: async () => { calls++; } };
  const notifier = new (Notifier as any)([p], { on_start: true, on_op_complete: true, on_failure: false, on_complete: true });
  await notifier.fire({ kind: "op_failure", ctx, opName: "build", opDuration: 1000, error: "oops" });
  expect(calls).toBe(0);
});

test("Notifier does not throw when a provider fails", async () => {
  const bad = { send: async () => { throw new Error("network down"); } };
  const notifier = new (Notifier as any)([bad], { on_start: true, on_op_complete: true, on_failure: true, on_complete: true });
  await notifier.fire({ kind: "start", ctx, ops: [] });
  // must not throw
});

test("Notifier.fromConfig returns empty notifier when cfg is undefined", async () => {
  let calls = 0;
  const notifier = Notifier.fromConfig(undefined);
  // fire anything — no providers, nothing should happen
  await notifier.fire({ kind: "start", ctx, ops: [] });
  expect(calls).toBe(0);
});

// ─── WeComProvider formatting ─────────────────────────────────────────────────

test("WeComProvider start message contains project name, branch, build ID, and all op names", () => {
  const p = new WeComProvider({ type: "wecom", webhook_url: "https://example.com" });
  const payload = p.buildPayload({ kind: "start", ctx, ops: ["update", "build", "start"] });
  expect(payload.msgtype).toBe("markdown");
  const c = payload.markdown.content;
  expect(c).toContain("MyGame");
  expect(c).toContain("main");
  expect(c).toContain("20260303_142035");
  expect(c).toContain("update");
  expect(c).toContain("build");
  expect(c).toContain("start");
  // numbered list format
  expect(c).toContain("1. update");
  expect(c).toContain("2. build");
});

test("WeComProvider op_complete message contains op name and formatted duration", () => {
  const p = new WeComProvider({ type: "wecom", webhook_url: "https://example.com" });
  const payload = p.buildPayload({ kind: "op_complete", ctx, opName: "build", opDuration: 272000 });
  const c = payload.markdown.content;
  expect(c).toContain("build");
  expect(c).toContain("4m 32s");
  expect(c).toContain("info"); // font color
});

test("WeComProvider op_failure message contains op name, error, and warning color", () => {
  const p = new WeComProvider({ type: "wecom", webhook_url: "https://example.com" });
  const payload = p.buildPayload({ kind: "op_failure", ctx, opName: "build", opDuration: 5000, error: "exit 1" });
  const c = payload.markdown.content;
  expect(c).toContain("build");
  expect(c).toContain("exit 1");
  expect(c).toContain("warning"); // font color
  expect(c).toContain("5s");
});

test("WeComProvider complete message shows total duration, per-op results and font colors", () => {
  const p = new WeComProvider({ type: "wecom", webhook_url: "https://example.com" });
  const payload = p.buildPayload({
    kind: "complete",
    ctx,
    duration: 330000,
    results: [
      { op: "update", ok: true, duration: 45000 },
      { op: "build", ok: false, duration: 272000 },
    ],
  });
  const c = payload.markdown.content;
  expect(c).toContain("5m 30s"); // total
  expect(c).toContain("update");
  expect(c).toContain("build");
  expect(c).toContain("45s");
  expect(c).toContain("4m 32s");
  expect(c).toContain("warning"); // build failed → warning color on summary
});

// ─── TelegramProvider formatting ──────────────────────────────────────────────

test("TelegramProvider start message contains project and all op names", () => {
  const p = new TelegramProvider({ type: "telegram", bot_token: "123:ABC", chat_id: "-100" });
  const text = p.buildText({ kind: "start", ctx, ops: ["update", "build"] });
  expect(text).toContain("MyGame");
  expect(text).toContain("update");
  expect(text).toContain("build");
});

test("TelegramProvider op_complete message is short and contains op name and duration", () => {
  const p = new TelegramProvider({ type: "telegram", bot_token: "123:ABC", chat_id: "-100" });
  const text = p.buildText({ kind: "op_complete", ctx, opName: "build", opDuration: 60000 });
  expect(text).toContain("build");
  expect(text).toContain("1m");
});
