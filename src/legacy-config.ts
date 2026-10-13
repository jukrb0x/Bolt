/**
 * Bolt v2.0 config detection and migration.
 *
 * v2.0 bolt.yaml had no `version`, kept engine/project repo identity under `project`,
 * and Unreal `targets` at the root. v2.0 bolt.local.yaml held per-machine
 * `engine_path`, `project_path`, `uproject`, and `use_tortoise`.
 * Version 1 moves Unreal metadata to the `ue` plugin config and lets
 * bolt.local.yaml override plugin config by namespace under `plugins`.
 */

type Obj = Record<string, unknown>;

const LEGACY_LOCAL_KEYS = ["engine_path", "project_path", "uproject", "use_tortoise"] as const;

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export interface LegacyFinding {
  file: "bolt.yaml" | "bolt.local.yaml";
  path: string;
  message: string;
}

/** List v2.0 keys in the parsed files. Empty when nothing looks like v2.0. */
export function findLegacyKeys(shared: unknown, local: unknown): LegacyFinding[] {
  const out: LegacyFinding[] = [];
  if (isObj(shared)) {
    if (shared.version === undefined) {
      out.push({ file: "bolt.yaml", path: "version", message: "missing (v2.0 files had none)" });
    }
    if (shared.targets !== undefined) {
      out.push({
        file: "bolt.yaml",
        path: "targets",
        message: "moved to plugins[ue].config.targets",
      });
    }
    if (isObj(shared.project)) {
      for (const key of Object.keys(shared.project)) {
        if (key === "name") continue;
        if (key === "engine" || key === "project") {
          out.push({
            file: "bolt.yaml",
            path: `project.${key}`,
            message: `moved to plugins[ue].config.${key}`,
          });
        } else {
          out.push({ file: "bolt.yaml", path: `project.${key}`, message: "moved to vars" });
        }
      }
    }
  }
  if (isObj(local)) {
    for (const key of LEGACY_LOCAL_KEYS) {
      if (local[key] === undefined) continue;
      const dest =
        key === "engine_path"
          ? "plugins.ue.engine.path"
          : key === "project_path"
            ? "plugins.ue.project.path"
            : key === "uproject"
              ? "plugins.ue.uproject"
              : "plugins.svn.use_tortoise";
      out.push({ file: "bolt.local.yaml", path: key, message: `moved to ${dest}` });
    }
  }
  return out;
}

export interface MigrationResult {
  changed: boolean;
  shared: Obj;
  /** Undefined when there was no local file and nothing needs one. */
  local?: Obj;
  notes: string[];
}

function setIn(target: Obj, keys: string[], value: unknown): void {
  let cur = target;
  for (const key of keys.slice(0, -1)) {
    if (!isObj(cur[key])) cur[key] = {};
    cur = cur[key] as Obj;
  }
  cur[keys[keys.length - 1]] = value;
}

function findPlugin(plugins: unknown[], namespace: string): Obj | undefined {
  return plugins.find((p) => isObj(p) && p.namespace === namespace) as Obj | undefined;
}

/**
 * Rewrite v2.0 files to the version 1 shape. Machine paths stay in bolt.local.yaml
 * under `plugins.<namespace>`. Inputs are not modified.
 */
export function migrateLegacyConfig(sharedIn: unknown, localIn: unknown): MigrationResult {
  const findings = findLegacyKeys(sharedIn, localIn);
  const shared: Obj = isObj(sharedIn) ? structuredClone(sharedIn) : {};
  const local: Obj | undefined = isObj(localIn) ? structuredClone(localIn) : undefined;
  const notes: string[] = [];
  if (findings.length === 0) return { changed: false, shared, local, notes };

  const ueShared: Obj = {};
  const ueLocal: Obj = {};
  const svnLocal: Obj = {};

  if (isObj(shared.project)) {
    const project = shared.project;
    for (const key of Object.keys(project)) {
      if (key === "name") continue;
      const value = project[key];
      if (key === "engine" || key === "project") {
        ueShared[key] = value;
      } else {
        const vars = isObj(shared.vars) ? shared.vars : (shared.vars = {});
        (vars as Obj)[key] = String(value);
        notes.push(
          `project.${key} is now vars.${key}. Replace \${{ project.${key} }} with \${{ vars.${key} }} in your tasks.`,
        );
      }
      delete project[key];
    }
  }
  if (shared.targets !== undefined) {
    ueShared.targets = shared.targets;
    delete shared.targets;
  }

  if (local) {
    if (local.engine_path !== undefined) setIn(ueLocal, ["engine", "path"], local.engine_path);
    if (local.project_path !== undefined) setIn(ueLocal, ["project", "path"], local.project_path);
    if (local.uproject !== undefined) ueLocal.uproject = local.uproject;
    if (local.use_tortoise !== undefined) svnLocal.use_tortoise = local.use_tortoise;
    for (const key of LEGACY_LOCAL_KEYS) delete local[key];
  }

  const plugins: unknown[] = Array.isArray(shared.plugins) ? shared.plugins : [];
  const needsUe = Object.keys(ueShared).length > 0 || Object.keys(ueLocal).length > 0;
  if (needsUe) {
    let ue = findPlugin(plugins, "ue");
    if (!ue) {
      ue = { namespace: "ue" };
      plugins.push(ue);
    }
    const config = isObj(ue.config) ? ue.config : {};
    for (const [key, value] of Object.entries(ueShared)) {
      if (config[key] === undefined) config[key] = value;
      else if (isObj(config[key]) && isObj(value))
        config[key] = { ...value, ...(config[key] as Obj) };
    }
    if (Object.keys(config).length > 0) ue.config = config;
  }
  if (Object.keys(svnLocal).length > 0 && !findPlugin(plugins, "svn")) {
    plugins.push({ namespace: "svn" });
  }
  if (plugins.length > 0) shared.plugins = plugins;

  const localPlugins: Obj = {};
  if (Object.keys(ueLocal).length > 0) localPlugins.ue = ueLocal;
  if (Object.keys(svnLocal).length > 0) localPlugins.svn = svnLocal;
  let outLocal = local;
  if (Object.keys(localPlugins).length > 0) {
    outLocal = outLocal ?? {};
    const existing = isObj(outLocal.plugins) ? outLocal.plugins : {};
    outLocal.plugins = { ...existing, ...localPlugins };
  }

  // Put version first so the rewritten file reads like a version 1 file.
  const ordered: Obj = { version: shared.version ?? 1 };
  for (const [key, value] of Object.entries(shared)) if (key !== "version") ordered[key] = value;

  return { changed: true, shared: ordered, local: outLocal, notes };
}
