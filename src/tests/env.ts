import path from "path";
import type { BoltConfig } from "../config";
import type { Runtime } from "../runtime/types";
import type { UeConfig } from "../plugins/ue";

/**
 * Runner imports plugins[].path when it is set. Point the fixture at a real
 * module whose export namespace is not "ue", so the builtin ue plugin stays.
 */
const registrySafePath = path.join(import.meta.dir, "../plugins/json.ts");

/** Mock runtime for tests - returns success with empty output by default */
export const mockRuntime: Runtime = {
  spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  spawnSync: () => ({ exitCode: 0, stdout: "", stderr: "" }),
  shell: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  parseYaml: (text: string) => {
    const yaml = require("yaml");
    return yaml.parse(text);
  },
};

const optional = (key: string, defaultVal: string): string => {
  return Bun.env[key] || defaultVal;
};

/** True when TortoiseProc.exe is on PATH. `where` is Windows-only; other OSes count as absent. */
export function tortoiseProcOnPath(): boolean {
  if (process.platform !== "win32") return false;
  const found = Bun.spawnSync(["where", "TortoiseProc.exe"], { stdout: "pipe", stderr: "pipe" });
  return found.exitCode === 0;
}

export const ENGINE_ROOT = optional("ENGINE_ROOT", "C:/UnrealEngine");
export const PROJECT_ROOT = optional("PROJECT_ROOT", "C:/Projects/MyProject");
export const PROJECT_NAME = optional("PROJECT_NAME", "MyProject");
export const UPROJECT = optional("UPROJECT", "C:/Projects/MyProject/MyProject.uproject");

export const testUeConfig: UeConfig = {
  engine: {
    path: ENGINE_ROOT,
    vcs: "git",
  },
  project: {
    path: PROJECT_ROOT,
    vcs: "svn",
  },
  uproject: UPROJECT,
  targets: {
    editor: { kind: "editor", config: "development" },
    client: { kind: "program", name: "MyClient", config: "shipping" },
  },
};

export function withUeConfig(patch: {
  engine?: Partial<UeConfig["engine"]>;
  project?: Partial<UeConfig["project"]>;
  uproject?: string;
  targets?: UeConfig["targets"];
}): BoltConfig {
  return {
    ...testCfg,
    plugins: [
      {
        namespace: "ue",
        path: "unused",
        config: {
          ...testUeConfig,
          ...patch,
          engine: { ...testUeConfig.engine, ...patch.engine },
          project: { ...testUeConfig.project, ...patch.project },
        },
      },
    ],
  };
}

export const testCfg: BoltConfig = {
  version: 1,
  project: {
    name: PROJECT_NAME,
  },
  targets: {},
  vars: {},
  tasks: {
    kill: [{ uses: "ue/kill" }],
    update: [{ uses: "ue/update_engine" }, { uses: "ue/update_project" }],
    build: [{ uses: "ue/build", with: { target: "editor" } }],
    start: [{ uses: "ue/start" }],
  },
  flows: {},
  plugins: [
    {
      namespace: "ue",
      path: registrySafePath,
      config: testUeConfig as unknown as Record<string, unknown>,
    },
  ],
  timeout_hours: undefined,
};
