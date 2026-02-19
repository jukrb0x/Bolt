import type { BoltConfig } from "../config";

const required = (key: string): string => {
  const val = Bun.env[key];
  if (!val) throw new Error(`Missing required env var: ${key} — check .env.local`);
  return val;
};

export const UE_PATH = required("UE_PATH");
export const PROJECT_PATH = required("PROJECT_PATH");
export const PROJECT_NAME = required("PROJECT_NAME");
export const SVN_ROOT = required("SVN_PROJ_ROOT");

export const testCfg: BoltConfig = {
  project: {
    name: PROJECT_NAME,
    ue_path: UE_PATH,
    project_path: PROJECT_PATH,
    project_name: PROJECT_NAME,
    svn_root: SVN_ROOT,
  },
  targets: {
    editor: { type: "editor", build_type: "development" },
    client: { type: "program", name: "MyClient", build_type: "shipping" },
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
