// src/runtime/node.ts
import type { Runtime, SpawnResult, SpawnOptions } from "./types";
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "child_process";
import * as yaml from "yaml";

export function createNodeRuntime(): Runtime {
  return {
    async spawn(cmd: string[], opts?: SpawnOptions): Promise<SpawnResult> {
      return new Promise((resolve) => {
        const [command, ...args] = cmd;
        const proc = nodeSpawn(command, args, {
          cwd: opts?.cwd,
          env: opts?.env ? { ...process.env, ...opts.env } : process.env,
          shell: false,
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data) => { const t = data.toString(); process.stdout.write(data); stdout += t; opts?.onOutput?.(t); });
        proc.stderr?.on("data", (data) => { const t = data.toString(); process.stderr.write(data); stderr += t; opts?.onOutput?.(t); });

        proc.on("close", (exitCode) => {
          resolve({ exitCode: exitCode ?? 1, stdout, stderr });
        });

        proc.on("error", () => {
          resolve({ exitCode: 1, stdout, stderr });
        });
      });
    },

    spawnSync(cmd: string[], opts?: SpawnOptions): SpawnResult {
      const [command, ...args] = cmd;
      const result = nodeSpawnSync(command, args, {
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : process.env,
        encoding: "utf-8",
      });
      const out = result.stdout ?? "";
      const err = result.stderr ?? "";
      if (opts?.onOutput) {
        if (out) opts.onOutput(out);
        if (err) opts.onOutput(err);
      }
      return {
        exitCode: result.status ?? 1,
        stdout: out,
        stderr: err,
      };
    },

    async shell(command: string, opts?: SpawnOptions): Promise<SpawnResult> {
      return new Promise((resolve) => {
        // Use shell: true so Node.js correctly invokes the platform shell
        // (cmd.exe on Windows, sh on Unix) without manual quoting issues.
        // Manually spawning ["cmd", "/c", command] without shell:true causes
        // Node to re-escape embedded quotes, breaking paths with spaces.
        const proc = nodeSpawn(command, [], {
          cwd: opts?.cwd,
          env: opts?.env ? { ...process.env, ...opts.env } : process.env,
          shell: true,
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data) => { const t = data.toString(); process.stdout.write(data); stdout += t; opts?.onOutput?.(t); });
        proc.stderr?.on("data", (data) => { const t = data.toString(); process.stderr.write(data); stderr += t; opts?.onOutput?.(t); });

        proc.on("close", (exitCode) => {
          resolve({ exitCode: exitCode ?? 1, stdout, stderr });
        });

        proc.on("error", () => {
          resolve({ exitCode: 1, stdout, stderr });
        });
      });
    },

    parseYaml(text: string): unknown {
      return yaml.parse(text);
    },
  };
}
