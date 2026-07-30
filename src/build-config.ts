import { z } from "zod";

export type BuildConfig = "development" | "debug" | "debuggame" | "shipping" | "test";
export type BuildConfigResult = { ok: true; value: BuildConfig } | { ok: false; message: string };

const ALIASES: Record<string, BuildConfig> = {
  development: "development",
  dev: "development",
  debug: "debug",
  dbg: "debug",
  debuggame: "debuggame",
  dbggame: "debuggame",
  shipping: "shipping",
  test: "test",
};

const UNREAL_NAMES: Record<BuildConfig, string> = {
  development: "Development",
  debug: "Debug",
  debuggame: "DebugGame",
  shipping: "Shipping",
  test: "Test",
};

const ACCEPTED = "development/dev, debug/dbg, debuggame/dbggame, shipping, test";

export function normalizeBuildConfig(input: string): BuildConfigResult {
  const value = ALIASES[input.trim().toLowerCase()];
  return value
    ? { ok: true, value }
    : { ok: false, message: `Unknown build configuration "${input}". Accepted: ${ACCEPTED}` };
}

export const BuildConfigSchema = z.string().transform((input, ctx): BuildConfig => {
  const result = normalizeBuildConfig(input);
  if (result.ok) return result.value;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message });
  return z.NEVER;
});

export function toUnrealBuildConfig(config: BuildConfig): string {
  return UNREAL_NAMES[config];
}
