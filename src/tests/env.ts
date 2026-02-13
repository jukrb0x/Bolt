import type { BoltConfig } from "../config"

const required = (key: string): string => {
  const val = Bun.env[key]
  if (!val) throw new Error(`Missing required env var: ${key} — check .env.local`)
  return val
}

export const UE_PATH      = required("UE_PATH")
export const PROJECT_PATH = required("PROJECT_PATH")
export const PROJECT_NAME = required("PROJECT_NAME")
export const SVN_ROOT     = required("SVN_PROJ_ROOT")

export const testCfg: BoltConfig = {
  project: {
    name:         PROJECT_NAME,
    ue_path:      UE_PATH,
    project_path: PROJECT_PATH,
    project_name: PROJECT_NAME,
    svn_root:     SVN_ROOT,
  },
  targets: {
    editor: { type: "editor", build_type: "development" },
    client: { type: "program", name: "MyClient", build_type: "shipping" },
  },
  actions: {},
}
