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
      // Use Bun's built-in cross-platform shell ($) instead of cmd.exe/sh
      // to avoid Windows cmd.exe quote-escaping issues with embedded quotes in paths.
      // Bun.spawn(["cmd", "/c", command]) re-escapes quotes for CreateProcessW,
      // turning "path" into \"path\" which cmd.exe misinterprets.
      const cwd = opts?.cwd ?? process.cwd();
      const env = opts?.env ? { ...process.env, ...opts.env } : process.env;
      const result = await Bun.$`${{ raw: command }}`
        .nothrow()
        .cwd(cwd)
        .env(env);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    },

    parseYaml(text: string): unknown {
      const { YAML } = Bun as any;
      return YAML.parse(text);
    },
  };
}
