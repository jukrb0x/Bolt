import { readFileSync, existsSync } from "fs"
import path from "path"
import type { BoltConfig } from "../config"

function loadEnv(): Record<string, string> {
  const envFile = path.join(import.meta.dir, "../../.env.local")
  if (!existsSync(envFile)) throw new Error(".env.local not found — copy from BuildConfig.ini")
  const env: Record<string, string> = {}
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

const env = loadEnv()

export const UE_PATH      = env.UE_PATH
export const PROJECT_PATH = env.PROJECT_PATH
export const PROJECT_NAME = env.PROJECT_NAME
export const SVN_ROOT     = env.SVN_PROJ_ROOT

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
