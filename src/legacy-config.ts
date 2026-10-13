/**
 * Bolt v2.0 config detection and migration.
 *
 * v2.0 bolt.yaml had no `version`, kept engine/project repo identity under `project`,
 * and Unreal `targets` at the root. v2.0 bolt.local.yaml held per-machine
 * `engine_path`, `project_path`, `uproject`, and `use_tortoise`. v2.0 tasks could
 * read `${{ project.engine_repo.path }}`, `${{ project.project_repo.path }}`,
 * `${{ project.uproject }}`, and extra `${{ project.<key> }}` strings.
 * Version 1 moves Unreal metadata to the `ue` plugin config, lets bolt.local.yaml
 * override plugin config by namespace under `plugins`, and only has `project.name`.
 */

import path from "path";

type Obj = Record<string, unknown>;

/**
 * v2.0 resolved engine_path, project_path, and uproject against the bolt.yaml
 * directory before tasks saw them, so the vars that replace those references
 * get the same absolute value. Windows drive paths count as absolute on any OS.
 */
export function resolveLegacyPath(value: unknown, configDir: string | undefined): string {
  const text = String(value);
  if (!configDir || path.isAbsolute(text) || path.win32.isAbsolute(text)) return text;
  return path.resolve(configDir, text);
}

const LEGACY_LOCAL_KEYS = ["engine_path", "project_path", "uproject", "use_tortoise"] as const;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** v2.0 interpolation keys that came from bolt.local.yaml, and the local var each becomes. */
const LEGACY_PROJECT_REFS: Record<string, string> = {
  "engine_repo.path": "engine_path",
  "project_repo.path": "project_path",
  uproject: "uproject",
};

const PROJECT_REF = /\$\{\{\s*project\.([\w.]+)\s*\}\}/g;

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Deep-merge `incoming` into `existing`; values already in `existing` win.
 * Each differing leaf is reported through `conflict`.
 */
function mergeKeepExisting(
  existing: unknown,
  incoming: unknown,
  at: string,
  conflict: (path: string, kept: unknown, dropped: unknown) => void,
): unknown {
  if (existing === undefined) return incoming;
  if (isObj(existing) && isObj(incoming)) {
    const out: Obj = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      if (UNSAFE_KEYS.has(key)) continue;
      out[key] = mergeKeepExisting(existing[key], value, at ? `${at}.${key}` : key, conflict);
    }
    return out;
  }
  if (JSON.stringify(existing) !== JSON.stringify(incoming)) conflict(at, existing, incoming);
  return existing;
}

/** Every string in `value` with its dotted path, for reference scans. */
export function walkStrings(
  value: unknown,
  at: string,
  visit: (path: string, text: string) => void,
): void {
  if (typeof value === "string") visit(at, value);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${at}[${i}]`, visit));
  else if (isObj(value))
    for (const [k, v] of Object.entries(value)) walkStrings(v, at ? `${at}.${k}` : k, visit);
}

/** `${{ project.<key> }}` references other than project.name, with their location. */
export function unknownProjectRefs(shared: unknown): Array<{ path: string; ref: string }> {
  const out: Array<{ path: string; ref: string }> = [];
  if (!isObj(shared)) return out;
  for (const field of ["tasks", "flows"] as const) {
    walkStrings(shared[field], field, (path, text) => {
      for (const match of text.matchAll(PROJECT_REF)) {
        if (match[1] !== "name") out.push({ path, ref: match[1] });
      }
    });
  }
  return out;
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
      for (const [key, value] of Object.entries(shared.project)) {
        if (key === "name") continue;
        if (key === "engine" || key === "project") {
          out.push({
            file: "bolt.yaml",
            path: `project.${key}`,
            message: `moved to plugins[ue].config.${key}`,
          });
        } else if (isScalar(value)) {
          out.push({ file: "bolt.yaml", path: `project.${key}`, message: "moved to vars" });
        } else {
          out.push({
            file: "bolt.yaml",
            path: `project.${key}`,
            message: "not a string; move it by hand",
          });
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
 * under `plugins.<namespace>`. Values already present in the target win. Inputs are
 * not modified.
 */
export function migrateLegacyConfig(
  sharedIn: unknown,
  localIn: unknown,
  configDir?: string,
): MigrationResult {
  const findings = findLegacyKeys(sharedIn, localIn);
  const shared: Obj = isObj(sharedIn) ? structuredClone(sharedIn) : {};
  const local: Obj | undefined = isObj(localIn) ? structuredClone(localIn) : undefined;
  const notes: string[] = [];
  const legacyRefs = unknownProjectRefs(shared);
  if (findings.length === 0 && legacyRefs.length === 0)
    return { changed: false, shared, local, notes };

  const ueShared: Obj = {};
  const ueLocal: Obj = {};
  const svnLocal: Obj = {};
  const movedVars = new Set<string>();
  const localVars: Obj = {};

  if (isObj(shared.project)) {
    const project = shared.project;
    for (const key of Object.keys(project)) {
      if (key === "name") continue;
      const value = project[key];
      if (key === "engine" || key === "project") {
        ueShared[key] = value;
        delete project[key];
      } else if (isScalar(value)) {
        const vars = isObj(shared.vars) ? shared.vars : (shared.vars = {});
        if ((vars as Obj)[key] !== undefined && (vars as Obj)[key] !== String(value)) {
          notes.push(
            `vars.${key} already exists; kept it and dropped project.${key} (${String(value)}).`,
          );
        } else {
          (vars as Obj)[key] = String(value);
        }
        movedVars.add(key);
        delete project[key];
      } else {
        notes.push(
          `project.${key} is not a string, so it was left in place. Move it to vars or a plugin config by hand.`,
        );
      }
    }
  }
  if (shared.targets !== undefined) {
    ueShared.targets = shared.targets;
    delete shared.targets;
  }

  if (local) {
    if (local.engine_path !== undefined) {
      setIn(ueLocal, ["engine", "path"], local.engine_path);
      localVars.engine_path = local.engine_path;
    }
    if (local.project_path !== undefined) {
      setIn(ueLocal, ["project", "path"], local.project_path);
      localVars.project_path = local.project_path;
    }
    if (local.uproject !== undefined) {
      ueLocal.uproject = local.uproject;
      localVars.uproject = local.uproject;
    }
    if (local.use_tortoise !== undefined) svnLocal.use_tortoise = local.use_tortoise;
    for (const key of LEGACY_LOCAL_KEYS) delete local[key];
  }

  // Rewrite v2.0 interpolations. Machine paths become local vars of the same value.
  const neededLocalVars = new Set<string>();
  let rewrote = false;
  const rewrite = (text: string, at: string): string =>
    text.replace(PROJECT_REF, (match, ref: string) => {
      if (ref === "name") return match;
      const localVar = LEGACY_PROJECT_REFS[ref];
      if (localVar) {
        neededLocalVars.add(localVar);
        rewrote = true;
        return `\${{ vars.${localVar} }}`;
      }
      if (movedVars.has(ref)) {
        rewrote = true;
        return `\${{ vars.${ref} }}`;
      }
      notes.push(
        `${at}: \${{ project.${ref} }} has no version 1 equivalent. Replace it by hand (for example with a var).`,
      );
      return match;
    });
  const rewriteAll = (value: unknown, at: string): unknown => {
    if (typeof value === "string") return rewrite(value, at);
    if (Array.isArray(value)) return value.map((v, i) => rewriteAll(v, `${at}[${i}]`));
    if (isObj(value)) {
      const out: Obj = {};
      for (const [k, v] of Object.entries(value)) out[k] = rewriteAll(v, `${at}.${k}`);
      return out;
    }
    return value;
  };
  if (shared.tasks !== undefined) shared.tasks = rewriteAll(shared.tasks, "tasks");
  if (shared.flows !== undefined) shared.flows = rewriteAll(shared.flows, "flows");

  const plugins: unknown[] = Array.isArray(shared.plugins) ? shared.plugins : [];
  const needsUe = Object.keys(ueShared).length > 0 || Object.keys(ueLocal).length > 0;
  if (needsUe) {
    let ue = findPlugin(plugins, "ue");
    if (!ue) {
      ue = { namespace: "ue" };
      plugins.push(ue);
    }
    const merged = mergeKeepExisting(
      isObj(ue.config) ? ue.config : undefined,
      ueShared,
      "",
      (at, kept, dropped) =>
        notes.push(
          `bolt.yaml plugins[ue].config.${at}: kept the existing ${JSON.stringify(kept)}; the v2.0 value ${JSON.stringify(dropped)} was not written.`,
        ),
    ) as Obj | undefined;
    if (merged && Object.keys(merged).length > 0) ue.config = merged;
  }
  if (Object.keys(svnLocal).length > 0 && !findPlugin(plugins, "svn")) {
    plugins.push({ namespace: "svn" });
  }
  if (plugins.length > 0) shared.plugins = plugins;

  const localPlugins: Obj = {};
  if (Object.keys(ueLocal).length > 0) localPlugins.ue = ueLocal;
  if (Object.keys(svnLocal).length > 0) localPlugins.svn = svnLocal;
  const localVarsNeeded: Obj = {};
  for (const name of neededLocalVars) {
    if (localVars[name] !== undefined) {
      localVarsNeeded[name] = resolveLegacyPath(localVars[name], configDir);
    } else
      notes.push(
        `tasks used the v2.0 ${name} value, now \${{ vars.${name} }}; set vars.${name} in bolt.local.yaml.`,
      );
  }
  let outLocal = local;
  if (Object.keys(localPlugins).length > 0 || Object.keys(localVarsNeeded).length > 0) {
    outLocal = outLocal ?? {};
    const conflict = (at: string, kept: unknown, dropped: unknown) =>
      notes.push(
        `bolt.local.yaml ${at}: kept the existing ${JSON.stringify(kept)}; the v2.0 value ${JSON.stringify(dropped)} was not written.`,
      );
    if (Object.keys(localVarsNeeded).length > 0) {
      outLocal.vars = mergeKeepExisting(outLocal.vars, localVarsNeeded, "vars", conflict);
    }
    if (Object.keys(localPlugins).length > 0) {
      outLocal.plugins = mergeKeepExisting(outLocal.plugins, localPlugins, "plugins", conflict);
    }
  }

  // Put version first so the rewritten file reads like a version 1 file.
  const ordered: Obj = { version: shared.version ?? 1 };
  for (const [key, value] of Object.entries(shared)) if (key !== "version") ordered[key] = value;

  if (findings.length === 0 && !rewrote) return { changed: false, shared, local, notes };
  return { changed: true, shared: ordered, local: outLocal, notes };
}
