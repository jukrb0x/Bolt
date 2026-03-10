import type { BoltConfig } from "../config";
import type { Runtime } from "../runtime/types";

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

const required = (key: string): string => {
  const val = Bun.env[key];
  if (!val) throw new Error(`Missing required env var: ${key} — check .env.local`);
  return val;
};

const optional = (key: string, defaultVal: string): string => {
  return Bun.env[key] || defaultVal;
};

export const ENGINE_ROOT = optional("ENGINE_ROOT", "C:/UnrealEngine");
export const PROJECT_ROOT = optional("PROJECT_ROOT", "C:/Projects/MyProject");
export const PROJECT_NAME = optional("PROJECT_NAME", "MyProject");
export const UPROJECT = optional("UPROJECT", "C:/Projects/MyProject/MyProject.uproject");

export const testCfg: BoltConfig = {
  project: {
    name: PROJECT_NAME,
    engine_repo: {
      path: ENGINE_ROOT,
      vcs: "git",
    },
    project_repo: {
      path: PROJECT_ROOT,
      vcs: "svn",
    },
    uproject: UPROJECT,
  },
  targets: {
    editor: { kind: "editor", config: "development" },
    client: { kind: "program", name: "MyClient", config: "shipping" },
  },
  actions: {},
  ops: {
    kill: { default: [{ uses: "ue/kill" }] },
    update: {
      default: [{ uses: "ue/update_engine" }, { uses: "ue/update_project" }],
      engine: [{ uses: "ue/update_engine" }],
      project: [{ uses: "ue/update_project" }],
    },
    build: { default: [{ uses: "ue/build", with: { target: "editor" } }] },
    start: { default: [{ uses: "ue/start" }] },
  },
  "go-pipeline": { order: [], fail_stops: [] },
  plugins: [],
  timeout_hours: undefined,
};
