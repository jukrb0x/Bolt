import { expect, test, spyOn } from "bun:test";
import { VERSION } from "../version";

test("VERSION matches semver pattern", () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
});

test("version command logs VERSION", async () => {
  const logged: unknown[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args) => {
    logged.push(args[0]);
  });

  const mod = await import("../commands/version");
  const cmd = mod.default as any;
  await cmd.run({});

  spy.mockRestore();
  expect(logged).toContain(VERSION);
});
