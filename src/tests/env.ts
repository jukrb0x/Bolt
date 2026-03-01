import type { BoltConfig } from "../config";

const required = (key: string): string => {
  const val = Bun.env[key];
  if (!val) throw new Error(`Missing required env var: ${key} — check .env.local`);
  return val;
};

export const ENGINE_ROOT = required("ENGINE_ROOT");
export const PROJECT_ROOT = required("PROJECT_ROOT");
export const PROJECT_NAME = required("PROJECT_NAME");

export const testCfg: BoltConfig = {
  project: {
    name: PROJECT_NAME,
    engine_root: ENGINE_ROOT,
    project_root: PROJECT_ROOT,
    project_name: PROJECT_NAME,
    engine_vcs: "git",
    project_vcs: "svn",
  },
  targets: {
    editor: { kind: "editor", config: "development" },
    client: { kind: "program", name: "MyClient", config: "shipping" },
  },
  actions: {},
  ops: {
    kill: { default: [{ uses: "ue/kill" }] },
    update: {
      default: [{ uses: "ue/update-git" }, { uses: "ue/update-svn" }],
      git: [{ uses: "ue/update-git" }],
      svn: [{ uses: "ue/update-svn" }],
    },
    build: { default: [{ uses: "ue/build", with: { target: "editor" } }] },
    start: { default: [{ uses: "ue/start" }] },
  },
  "go-pipeline": { order: [], fail_stops: [] },
  plugins: [],
  timeout_hours: undefined,
};
