import { expect, test } from "bun:test";
import { Notifier, WeComProvider, TelegramProvider } from "../notify";
import type { NotifyEvent } from "../notify";

test("Notifier.fire calls all providers", async () => {
  let calls = 0;
  const fakeProvider = { send: async (_e: NotifyEvent) => { calls++; } };
  const notifier = new Notifier([fakeProvider, fakeProvider]);
  await notifier.fire({ kind: "start", ops: ["build", "start"] });
  expect(calls).toBe(2);
});

test("Notifier.fire does not throw when a provider fails", async () => {
  const badProvider = { send: async (_e: NotifyEvent) => { throw new Error("network down"); } };
  const notifier = new Notifier([badProvider]);
  await notifier.fire({ kind: "complete", duration: 1234, results: [] });
  // must not throw
});

test("WeComProvider.buildPayload start event contains op names", () => {
  const p = new WeComProvider({ type: "wecom", webhook_url: "https://example.com" });
  const payload = p.buildPayload({ kind: "start", ops: ["build", "start"] });
  expect(payload.msgtype).toBe("markdown");
  expect(payload.markdown.content).toContain("build");
  expect(payload.markdown.content).toContain("start");
});

test("WeComProvider.buildPayload failure event contains op name and error", () => {
  const p = new WeComProvider({ type: "wecom", webhook_url: "https://example.com" });
  const payload = p.buildPayload({ kind: "failure", opName: "build", error: "exit 1" });
  expect(payload.markdown.content).toContain("build");
  expect(payload.markdown.content).toContain("exit 1");
});

test("WeComProvider.buildPayload complete event contains duration in seconds", () => {
  const p = new WeComProvider({ type: "wecom", webhook_url: "https://example.com" });
  const payload = p.buildPayload({
    kind: "complete",
    duration: 5500,
    results: [{ op: "build", ok: true }, { op: "start", ok: false }],
  });
  expect(payload.markdown.content).toContain("5s");
  expect(payload.markdown.content).toContain("build");
});

test("TelegramProvider.buildText start event contains op names", () => {
  const p = new TelegramProvider({ type: "telegram", bot_token: "123:ABC", chat_id: "-100" });
  const text = p.buildText({ kind: "start", ops: ["update", "build"] });
  expect(text).toContain("update");
  expect(text).toContain("build");
});
