import path from "path";
import os from "os";
import { existsSync, statSync } from "fs";
import type { BoltConfig } from "./config";
import type { BoltPlugin } from "./plugin";
import { builtinPlugins } from "./plugins";
import { parseStepParams } from "./runner";
import { LOCAL_RUNNERS } from "./local-runners";
import { shellQuote } from "./suggest";
import { capabilityUsesInPlan, type PlanNode, type RunPlan } from "./run-plan";
import {
  assessCapabilities,
  formatCapabilityIssue,
  isCapabilityRef,
  type CapabilityReport,
} from "./capability-selection";

/**
 * Static `--dry-run` preview (BOLT-P0-1).
 *
 * Pure by construction: it only reads bolt.yaml (already loaded), stats files, and looks at
 * the built-in plugins compiled into bolt. It never imports, compiles, or installs a project
 * or user plugin, never calls onInit/onBeforeStep/onAfterStep or a handler, never spawns a
 * process, and never writes a file (no log file, no .bolt/ directory, no plugin cache).
 */

export { LOCAL_RUNNERS };

export interface DryRunReport {
  /** Lines to print, in order. */
  lines: string[];
  /** Config problems a real run would hit (also included in `lines`). Non-empty means exit 3. */
  problems: string[];
}

export interface DryRunOptions {
  configDir: string;
  /** Directory local actions (`uses: ./x`) are resolved against. Default: process.cwd(). */
  cwd?: string;
  /** Home directory for user plugins (~/.bolt/plugins). Default: os.homedir(). */
  home?: string;
  builtins?: Record<string, BoltPlugin>;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where a non-builtin namespace would come from, decided from paths only (nothing is
 * imported). Mirrors buildRegistry priority: bolt.yaml `plugins:` path > project
 * .bolt/plugins/<ns> > user ~/.bolt/plugins/<ns>.
 */
function pluginSource(cfg: BoltConfig, namespace: string, opts: DryRunOptions): string | undefined {
  const declared = (cfg.plugins ?? []).find((p) => p.namespace === namespace && p.path);
  if (declared?.path) return `plugin declared in bolt.yaml (${declared.path})`;
  if (isDir(path.join(opts.configDir, ".bolt", "plugins", namespace))) {
    return `project plugin .bolt/plugins/${namespace}`;
  }
  const home = opts.home ?? os.homedir();
  if (isDir(path.join(home, ".bolt", "plugins", namespace))) {
    return `user plugin ~/.bolt/plugins/${namespace}`;
  }
  return undefined;
}

function paramText(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${shellQuote(v)}`)
    .join("  ");
}

export function renderDryRun(cfg: BoltConfig, plan: RunPlan, opts: DryRunOptions): DryRunReport {
  const builtins = opts.builtins ?? (builtinPlugins as Record<string, BoltPlugin>);
  const cwd = opts.cwd ?? process.cwd();
  const lines: string[] = [];
  const problems: string[] = [];
  let unloaded = false;

  const problem = (pad: string, text: string) => {
    problems.push(text);
    lines.push(`${pad}  ! ${text}`);
  };

  const selection: CapabilityReport = assessCapabilities(cfg, opts.configDir, {
    requested: capabilityUsesInPlan(plan),
    home: opts.home,
    builtins,
    catalog: true,
  });
  for (const warning of selection.warnings) lines.push(warning);
  for (const line of selection.lines) lines.push(line);
  for (const issue of selection.errors) problem("", formatCapabilityIssue(issue));
  if (selection.warnings.length > 0 || selection.lines.length > 0 || selection.errors.length > 0) {
    lines.push("");
  }

  const walk = (nodes: PlanNode[], depth: number) => {
    const pad = "  ".repeat(depth);
    for (const node of nodes) {
      if (node.kind === "call") {
        lines.push(`${pad}would call: ${node.name}`);
        walk(node.nodes, depth + 1);
        continue;
      }
      if (node.kind === "run") {
        lines.push(`${pad}would run: ${node.command}`);
        if (node.continueOnError) lines.push(`${pad}  -> continue-on-error: a failure is ignored`);
        continue;
      }

      const params = paramText(node.params);
      lines.push(`${pad}would run uses: ${node.ref}${params ? `  ${params}` : ""}`);

      if (isCapabilityRef(node.ref)) {
        const hit = selection.resolved.find((item) => item.capability === node.ref);
        if (hit) lines.push(`${pad}  -> ${hit.capability}: ${hit.ref} (${hit.source})`);
        continue;
      }

      if (node.ref.startsWith("./") || node.ref.startsWith("../")) {
        const dir = path.resolve(cwd, node.ref);
        if (!existsSync(path.join(dir, "action.yaml"))) {
          problem(pad, `No action.yaml in ${dir}`);
          continue;
        }
        const runner = LOCAL_RUNNERS.find((r) => existsSync(path.join(dir, r)));
        if (!runner) {
          problem(
            pad,
            `No run script found in ${dir} (expected one of ${LOCAL_RUNNERS.join(", ")})`,
          );
          continue;
        }
        const env = Object.entries(node.params)
          .map(([k, v]) => `BOLT_INPUT_${k.toUpperCase()}=${v}`)
          .join(" ");
        lines.push(
          `${pad}  -> local action: would execute ${node.ref.replace(/[\\/]+$/, "")}/${runner}${env ? ` with ${env}` : ""}`,
        );
        continue;
      }

      const slash = node.ref.indexOf("/");
      const namespace = node.ref.slice(0, slash);
      const operation = node.ref.slice(slash + 1);
      const declared = (cfg.plugins ?? []).find((p) => p.namespace === namespace && p.path);
      if (declared?.path && !existsSync(path.resolve(opts.configDir, declared.path))) {
        problem(
          pad,
          `Plugin "${namespace}" is declared in bolt.yaml plugins: with path ${declared.path}, ` +
            `which does not exist. Fix the path in bolt.yaml.`,
        );
        continue;
      }
      const source = pluginSource(cfg, namespace, opts);
      if (source) {
        unloaded = true;
        lines.push(
          `${pad}  -> ${source}: not loaded in dry-run; its handler and params are not validated (not an error)`,
        );
        continue;
      }
      const builtin = builtins[namespace];
      if (!builtin) {
        problem(
          pad,
          `Unknown plugin namespace "${namespace}": not a built-in plugin, and no plugin named ` +
            `"${namespace}" was found in bolt.yaml plugins:, .bolt/plugins/, or ~/.bolt/plugins/`,
        );
        continue;
      }
      if (!builtin.handlers[operation]) {
        const ops = Object.keys(builtin.handlers).join(", ");
        problem(pad, `Unknown op "${operation}" in plugin "${namespace}" (available: ${ops})`);
        continue;
      }
      try {
        parseStepParams(builtin, node.ref, operation, node.params);
        lines.push(`${pad}  -> built-in plugin ${namespace}: handler not called in dry-run`);
      } catch (e: any) {
        problem(
          pad,
          String(e?.message ?? e)
            .replace(/:\n\s*/, ": ")
            .replace(/\.?\n\s*/g, "; "),
        );
      }
    }
  };

  for (const task of plan.tasks) {
    lines.push(`>> ${task.name}${task.continueOnFailure ? "  (continue_on_fail)" : ""}`);
    walk(task.nodes, 1);
    lines.push("");
  }

  if (unloaded) {
    lines.push(
      "Note: project and user plugins are not loaded in dry-run. A plugin that resolves under a",
      "different namespace, or a handler that rejects its params, is only detected by --simulate",
      "or a real run.",
      "",
    );
  }
  return { lines, problems };
}

export const DRY_RUN_HEADER = "Dry run: showing what would run. Nothing is executed.";

export function dryRunFooter(problems: number): string[] {
  const head =
    problems > 0
      ? `Dry run found ${problems} config problem(s) a real run would fail on (marked with !). Fix bolt.yaml and run the dry run again.`
      : "Dry run complete.";
  return [
    head,
    "Nothing was executed: no commands, plugins, hooks, or handlers ran, and no files were written.",
    "To preview with plugin dry-run logic, hooks, and a log file, use --simulate.",
  ];
}
