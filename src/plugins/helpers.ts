import { $ } from "bun";
import type { BoltPluginContext } from "../plugin";

/** Execute a pre-built raw command string. Only use for trusted, internally-constructed commands. */
export async function execRaw(cmd: string): Promise<void> {
  const result = await $`${{ raw: cmd }}`.nothrow();
  if (result.exitCode !== 0) throw new Error(`Command failed: ${cmd}`);
}

/** Log and conditionally run a pre-built raw command string. Only use for trusted commands. */
export async function run(cmd: string, ctx: BoltPluginContext): Promise<void> {
  ctx.logger.info(cmd);
  if (!ctx.dryRun) await execRaw(cmd);
}
