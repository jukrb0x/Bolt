// src/runtime/bun.ts
import type { Runtime, SpawnResult, SpawnOptions } from "./types";

export function createBunRuntime(): Runtime {
  return {
    async spawn(cmd: string[], opts?: SpawnOptions): Promise<SpawnResult> {
      const proc = Bun.spawn(cmd, {
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      return { exitCode, stdout, stderr };
    },

    spawnSync(cmd: string[], opts?: SpawnOptions): SpawnResult {
      const result = Bun.spawnSync(cmd, {
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    },

    async shell(command: string, opts?: SpawnOptions): Promise<SpawnResult> {
      const isWindows = process.platform === "win32";
      const cmd = isWindows ? ["cmd", "/c", command] : ["sh", "-c", command];
      const proc = Bun.spawn(cmd, {
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      return { exitCode, stdout, stderr };
    },

    parseYaml(text: string): unknown {
      const { YAML } = Bun as any;
      return YAML.parse(text);
    },
  };
}
