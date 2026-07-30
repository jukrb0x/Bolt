import type { BoltConfig } from "./config";
import { interpolate } from "./interpolate";

export type PlanNode =
  | { kind: "call"; name: string; nodes: PlanNode[] }
  | { kind: "uses"; ref: string; params: Record<string, string> }
  | { kind: "run"; command: string; continueOnError: boolean };

export interface PlannedTask {
  name: string;
  nodes: PlanNode[];
}

export interface RunPlan {
  kind: "tasks" | "flow";
  name?: string;
  tasks: PlannedTask[];
}

export interface PlanError {
  path: string;
  message: string;
}

export type PlanResult = { ok: true; plan: RunPlan } | { ok: false; errors: PlanError[] };

export type PlanRequest =
  | { kind: "tasks"; names: string[]; params: Record<string, string> }
  | { kind: "flow"; name: string; params: Record<string, string> };

export function formatPlanErrors(errors: PlanError[]): string {
  return errors.map((error) => `${error.path}: ${error.message}`).join("\n");
}

export function resolveRunPlan(cfg: BoltConfig, request: PlanRequest): PlanResult {
  let names: string[];
  let planName: string | undefined;
  if (request.kind === "flow") {
    const flow = cfg.flows[request.name];
    if (!flow) {
      return {
        ok: false,
        errors: [{ path: "flow", message: `Unknown flow: "${request.name}"` }],
      };
    }
    names = flow.steps;
    planName = request.name;
  } else {
    names = request.names;
  }

  const resolveTask = (
    name: string,
    params: Record<string, string>,
    stack: string[],
    path: string,
  ): { ok: true; nodes: PlanNode[] } | { ok: false; errors: PlanError[] } => {
    const steps = cfg.tasks[name];
    if (!steps) {
      return { ok: false, errors: [{ path, message: `Unknown task: "${name}"` }] };
    }
    if (stack.includes(name)) {
      return {
        ok: false,
        errors: [{ path, message: `Task call cycle: ${[...stack, name].join(" -> ")}` }],
      };
    }

    const nodes: PlanNode[] = [];
    const nextStack = [...stack, name];
    for (const [index, step] of steps.entries()) {
      const stepPath = `${path}.steps[${index}]`;
      const ctx = {
        project: cfg.project as unknown as Record<string, string>,
        vars: cfg.vars,
        env: process.env as Record<string, string>,
        params,
      };

      if ("run" in step && step.run !== undefined) {
        nodes.push({
          kind: "run",
          command: interpolate(step.run, ctx),
          continueOnError: step["continue-on-error"] ?? false,
        });
        continue;
      }

      const yamlParams = Object.fromEntries(
        Object.entries(step.with ?? {}).map(([key, value]) => [key, interpolate(value, ctx)]),
      );
      const effectiveParams = { ...yamlParams, ...params };

      if ("call" in step && step.call !== undefined) {
        const nested = resolveTask(step.call, effectiveParams, nextStack, `${stepPath}.call`);
        if (!nested.ok) return nested;
        nodes.push({ kind: "call", name: step.call, nodes: nested.nodes });
      } else if ("uses" in step && step.uses !== undefined) {
        nodes.push({ kind: "uses", ref: step.uses, params: effectiveParams });
      }
    }
    return { ok: true, nodes };
  };

  const tasks: PlannedTask[] = [];
  for (const [index, name] of names.entries()) {
    const resolved = resolveTask(name, request.params, [], `tasks[${index}]`);
    if (!resolved.ok) return resolved;
    tasks.push({ name, nodes: resolved.nodes });
  }

  return {
    ok: true,
    plan: { kind: request.kind, name: planName, tasks },
  };
}
