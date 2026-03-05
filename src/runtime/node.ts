// src/runtime/node.ts
import type { Runtime, SpawnResult, SpawnOptions } from "./types";
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "child_process";

export function createNodeRuntime(): Runtime {
  // Lazy load yaml to avoid bundling issues
  let yamlParser: { parse: (text: string) => unknown } | null = null;

  function getYamlParser() {
    if (!yamlParser) {
      yamlParser = require("yaml");
    }
    return yamlParser;
  }

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

        proc.stdout?.on("data", (data) => { stdout += data.toString(); });
        proc.stderr?.on("data", (data) => { stderr += data.toString(); });

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
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },

    async shell(command: string, opts?: SpawnOptions): Promise<SpawnResult> {
      const isWindows = process.platform === "win32";
      const shell = isWindows ? "cmd" : "sh";
      const shellArg = isWindows ? "/c" : "-c";

      return new Promise((resolve) => {
        const proc = nodeSpawn(shell, [shellArg, command], {
          cwd: opts?.cwd,
          env: opts?.env ? { ...process.env, ...opts.env } : process.env,
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data) => { stdout += data.toString(); });
        proc.stderr?.on("data", (data) => { stderr += data.toString(); });

        proc.on("close", (exitCode) => {
          resolve({ exitCode: exitCode ?? 1, stdout, stderr });
        });

        proc.on("error", () => {
          resolve({ exitCode: 1, stdout, stderr });
        });
      });
    },

    parseYaml(text: string): unknown {
      return getYamlParser().parse(text);
    },
  };
}
