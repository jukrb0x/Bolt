import type { BoltPluginContext } from "../plugin";

/**
 * Config declared for a plugin.
 *
 * `cfg.plugins` is the whole list, including an empty one. A missing entry
 * stays missing — this does not read an unrelated bolt.yaml from configDir.
 */
export function declaredPluginConfig(ctx: BoltPluginContext, namespace: string): unknown {
  return ctx.cfg.plugins?.find((entry) => entry.namespace === namespace)?.config;
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
