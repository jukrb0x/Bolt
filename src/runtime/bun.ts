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

      // Tee piped output to the console so user-visible commands stream in real time
      const [stdout, stderr] = await Promise.all([
        (async () => {
          let buf = "";
          for await (const chunk of proc.stdout) {
            const text = new TextDecoder().decode(chunk);
            process.stdout.write(text);
            opts?.onOutput?.(text);
            buf += text;
          }
          return buf;
        })(),
        (async () => {
          let buf = "";
          for await (const chunk of proc.stderr) {
            const text = new TextDecoder().decode(chunk);
            process.stderr.write(text);
            opts?.onOutput?.(text);
            buf += text;
          }
          return buf;
        })(),
      ]);

      const exitCode = await proc.exited;
      return { exitCode, stdout, stderr };
    },

    spawnSync(cmd: string[], opts?: SpawnOptions): SpawnResult {
      const result = Bun.spawnSync(cmd, {
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = result.stdout.toString();
      const err = result.stderr.toString();
      if (opts?.onOutput) {
        if (out) opts.onOutput(out);
        if (err) opts.onOutput(err);
      }
      return {
        exitCode: result.exitCode,
        stdout: out,
        stderr: err,
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
      const out = result.stdout.toString();
      const err = result.stderr.toString();
      if (opts?.onOutput) {
        if (out) opts.onOutput(out);
        if (err) opts.onOutput(err);
      }
      return {
        exitCode: result.exitCode,
        stdout: out,
        stderr: err,
      };
    },

    parseYaml(text: string): unknown {
      const { YAML } = Bun as any;
      return YAML.parse(text);
    },
  };
}
