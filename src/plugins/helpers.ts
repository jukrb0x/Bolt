import { readFileSync } from "fs";
import path from "path";
import type { BoltPluginContext } from "../plugin";

/**
 * Config declared for a plugin in bolt.yaml.
 *
 * Inline `cfg.plugins` wins, including pathless builtin entries.
 * Falls back to `configDir/bolt.yaml` only when the loaded config has no entry.
 */
export function declaredPluginConfig(ctx: BoltPluginContext, namespace: string): unknown {
  const inline = ctx.cfg.plugins.find((entry) => entry.namespace === namespace)?.config;
  if (inline !== undefined) return inline;

  let raw: string;
  try {
    raw = readFileSync(path.join(ctx.configDir, "bolt.yaml"), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = ctx.runtime.parseYaml(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const plugins = (parsed as { plugins?: unknown }).plugins;
  if (!Array.isArray(plugins)) return undefined;
  for (const entry of plugins) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { namespace?: unknown; config?: unknown };
    if (record.namespace === namespace) return record.config;
  }
  return undefined;
}

/** Execute a pre-built raw command string. Only use for trusted, internally-constructed commands. */
export async function execRaw(cmd: string, ctx: BoltPluginContext): Promise<void> {
  const result = await ctx.runtime.shell(cmd);
  if (result.exitCode !== 0) throw new Error(`Command failed: ${cmd}`);
}

/** Log and conditionally run a pre-built raw command string. Only use for trusted commands. */
export async function run(cmd: string, ctx: BoltPluginContext): Promise<void> {
  ctx.logger.cmd(cmd);
  if (!ctx.dryRun) await execRaw(cmd, ctx);
}
