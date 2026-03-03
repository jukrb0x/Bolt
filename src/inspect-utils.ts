import { interpolate } from "./interpolate";
import type { BoltConfig, Step } from "./config";

export type Ctx = Record<string, Record<string, string>>;

export function makeCtx(cfg: BoltConfig): Ctx {
  return {
    project: cfg.project as Record<string, string>,
    vars: cfg.vars,
    env: process.env as Record<string, string>,
  };
}

export function walkSteps(
  steps: Step[],
  cfg: BoltConfig,
  ctx: Ctx,
  opParams: Record<string, string>,
  counter: { n: number },
): string[] {
  const lines: string[] = [];
  for (const step of steps) {
    const idx = counter.n++;

    if (step.run) {
      const cmd = interpolate(step.run, ctx);
      lines.push(`  ${idx}  run: ${cmd}`);
      continue;
    }

    if (!step.uses) continue;

    const uses = step.uses;

    if (uses.startsWith("ops/")) {
      const rest = uses.slice("ops/".length);
      const [opName, variant = "default"] = rest.split(":");
      const opDef = cfg.ops[opName];
      if (!opDef) {
        lines.push(`  ${idx}  uses: ${uses}  (unknown op)`);
        continue;
      }
      const nestedSteps = opDef[variant];
      if (!nestedSteps) {
        lines.push(`  ${idx}  uses: ${uses}  (unknown variant "${variant}")`);
        continue;
      }
      const yamlParams = Object.fromEntries(
        Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, ctx)]),
      );
      const mergedParams = { ...yamlParams, ...opParams };
      counter.n--;
      lines.push(...walkSteps(nestedSteps, cfg, ctx, mergedParams, counter));
      continue;
    }

    if (uses.startsWith("./") || uses.startsWith("../")) {
      lines.push(`  ${idx}  uses: ${uses}  (local action)`);
      for (const [k, v] of Object.entries(step.with ?? {})) {
        lines.push(`         ${k}: ${interpolate(v, ctx)}`);
      }
      continue;
    }

    // plugin call — build param line
    const yamlParams = Object.fromEntries(
      Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, ctx)]),
    );
    const mergedWith = { ...yamlParams, ...opParams };
    const paramStr = Object.entries(mergedWith)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
    lines.push(`  ${idx}  uses: ${uses}${paramStr ? "  " + paramStr : ""}`);
  }
  return lines;
}
