import { interpolate } from "./interpolate";
import type { BoltConfig, Step } from "./config";

export interface PlanSection {
  label: string;
  steps: Step[];
}

/**
 * Expand a task or flow name into ordered preview sections.
 * - flow → one section per task in `flow.steps` (in listed order)
 * - task → a single section
 * Throws on an unknown name (or a flow referencing an unknown task).
 */
export function collectSections(name: string, cfg: BoltConfig): PlanSection[] {
  if (cfg.flows[name]) {
    return cfg.flows[name].steps.map((taskName) => {
      const steps = cfg.tasks[taskName];
      if (!steps) throw new Error(`Flow "${name}" references unknown task: "${taskName}"`);
      return { label: taskName, steps };
    });
  }
  if (cfg.tasks[name]) return [{ label: name, steps: cfg.tasks[name] }];
  throw new Error(`Unknown task or flow: "${name}"`);
}

export type Ctx = Record<string, Record<string, string>>;

export function makeCtx(cfg: BoltConfig): Ctx {
  return {
    project: cfg.project as unknown as Record<string, string>,
    vars: cfg.vars,
    env: process.env as Record<string, string>,
  };
}

/**
 * Produce human-readable plan lines for a list of steps, resolving `task/<name>`
 * composition inline. Global `params` shallow-override each step's `with` (params win),
 * mirroring the runner.
 */
export function walkSteps(
  steps: Step[],
  cfg: BoltConfig,
  ctx: Ctx,
  params: Record<string, string>,
  counter: { n: number },
): string[] {
  const lines: string[] = [];
  const stepCtx: Ctx = { ...ctx, params };

  for (const step of steps) {
    const idx = counter.n++;

    if (step.run) {
      lines.push(`  ${idx}  run: ${interpolate(step.run, stepCtx)}`);
      continue;
    }

    if (!step.uses) continue;
    const uses = step.uses;

    if (uses.startsWith("task/")) {
      const taskName = uses.slice("task/".length);
      const nestedSteps = cfg.tasks[taskName];
      if (!nestedSteps) {
        lines.push(`  ${idx}  uses: ${uses}  (unknown task)`);
        continue;
      }
      const yamlParams = Object.fromEntries(
        Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, stepCtx)]),
      );
      const mergedParams = { ...yamlParams, ...params };
      counter.n--; // don't consume an index for the wrapper; nested steps start here
      lines.push(...walkSteps(nestedSteps, cfg, ctx, mergedParams, counter));
      continue;
    }

    if (uses.startsWith("./") || uses.startsWith("../")) {
      lines.push(`  ${idx}  uses: ${uses}  (local action)`);
      for (const [k, v] of Object.entries(step.with ?? {})) {
        lines.push(`         ${k}: ${interpolate(v, stepCtx)}`);
      }
      continue;
    }

    // plugin call — build param line
    const yamlParams = Object.fromEntries(
      Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, stepCtx)]),
    );
    const mergedWith = { ...yamlParams, ...params };
    const paramStr = Object.entries(mergedWith)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
    lines.push(`  ${idx}  uses: ${uses}${paramStr ? "  " + paramStr : ""}`);
  }
  return lines;
}
