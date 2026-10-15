import type { BoltConfig } from "./config";
import { isCapabilityRef } from "./capability-selection";
import {
  interpolateSegments,
  joinSegments,
  type InterpContext,
  type InterpSegment,
} from "./interpolate";

export type PlanNode =
  | { kind: "call"; name: string; nodes: PlanNode[] }
  | { kind: "uses"; ref: string; params: Record<string, string> }
  | { kind: "run"; command: string; continueOnError: boolean };

/** Non-enumerable so plan equality stays on the executed strings. */
export const PLAN_PROVENANCE = Symbol.for("bolt.plan.provenance");

export type PlanProvenance =
  | { kind: "run"; segments: InterpSegment[] }
  | { kind: "uses"; params: Record<string, InterpSegment[]> };

export function attachProvenance(node: object, provenance: PlanProvenance): void {
  Object.defineProperty(node, PLAN_PROVENANCE, {
    value: provenance,
    enumerable: false,
    writable: false,
  });
}

export function readProvenance(node: object): PlanProvenance | undefined {
  return (node as { [PLAN_PROVENANCE]?: PlanProvenance })[PLAN_PROVENANCE];
}

export interface PlannedTask {
  name: string;
  nodes: PlanNode[];
  continueOnFailure: boolean;
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

/**
 * Static check of a `uses:` reference. Local actions start with `./` or `../`; everything
 * else must be `namespace/op`. `task/<name>` is the removed v2.0 form of `call: <name>`.
 */
export function usesRefError(ref: string): string | undefined {
  if (ref.startsWith("./") || ref.startsWith("../")) return undefined;
  if (isCapabilityRef(ref)) return undefined;
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) {
    return `Invalid uses format (expected "ns/op" or "./local-action"): "${ref}"`;
  }
  if (ref.slice(0, slash) === "task") {
    return `legacy task reference "${ref}"; replace with "call: ${ref.slice(slash + 1)}"`;
  }
  return undefined;
}

/** Capability tags named by `uses:` in an already resolved plan. */
export function capabilityUsesInPlan(plan: RunPlan): string[] {
  const out: string[] = [];
  const walk = (nodes: PlanNode[]) => {
    for (const node of nodes) {
      if (node.kind === "call") walk(node.nodes);
      else if (node.kind === "uses" && isCapabilityRef(node.ref)) out.push(node.ref);
    }
  };
  for (const task of plan.tasks) walk(task.nodes);
  return [...new Set(out)];
}

export function resolveRunPlan(cfg: BoltConfig, request: PlanRequest): PlanResult {
  let names: string[];
  let planName: string | undefined;
  let continueOnFail = new Set<string>();
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
    continueOnFail = new Set(flow.continue_on_fail);
  } else {
    names = request.names;
  }

  const resolveTask = (
    name: string,
    params: Record<string, string>,
    paramProvenance: Record<string, InterpSegment[]>,
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
      const ctx: InterpContext = {
        project: cfg.project as unknown as Record<string, string>,
        vars: cfg.vars,
        env: process.env as Record<string, string>,
        params,
        localVars: new Set(cfg.localVarKeys ?? []),
        paramProvenance,
      };

      if ("run" in step && step.run !== undefined) {
        const segments = interpolateSegments(step.run, ctx);
        const node: PlanNode = {
          kind: "run",
          command: joinSegments(segments),
          continueOnError: step["continue-on-error"] ?? false,
        };
        attachProvenance(node, { kind: "run", segments });
        nodes.push(node);
        continue;
      }

      const yamlProvenance: Record<string, InterpSegment[]> = {};
      for (const [key, value] of Object.entries(step.with ?? {})) {
        yamlProvenance[key] = interpolateSegments(value, ctx);
      }
      const provenance: Record<string, InterpSegment[]> = { ...yamlProvenance };
      for (const [key, value] of Object.entries(params)) {
        provenance[key] = paramProvenance[key] ?? [{ kind: "param", name: key, value }];
      }
      const effectiveParams: Record<string, string> = {};
      for (const [key, segments] of Object.entries(provenance)) {
        effectiveParams[key] = joinSegments(segments);
      }

      if ("call" in step && step.call !== undefined) {
        const nested = resolveTask(
          step.call,
          effectiveParams,
          provenance,
          nextStack,
          `${stepPath}.call`,
        );
        if (!nested.ok) return nested;
        nodes.push({ kind: "call", name: step.call, nodes: nested.nodes });
      } else if ("uses" in step && step.uses !== undefined) {
        const refError = usesRefError(step.uses);
        if (refError)
          return { ok: false, errors: [{ path: `${stepPath}.uses`, message: refError }] };
        const node: PlanNode = { kind: "uses", ref: step.uses, params: effectiveParams };
        attachProvenance(node, { kind: "uses", params: provenance });
        nodes.push(node);
      }
    }
    return { ok: true, nodes };
  };

  const tasks: PlannedTask[] = [];
  for (const [index, name] of names.entries()) {
    const cliProvenance: Record<string, InterpSegment[]> = {};
    for (const [key, value] of Object.entries(request.params)) {
      cliProvenance[key] = [{ kind: "param", name: key, value }];
    }
    const resolved = resolveTask(name, request.params, cliProvenance, [], `tasks[${index}]`);
    if (!resolved.ok) return resolved;
    tasks.push({
      name,
      nodes: resolved.nodes,
      continueOnFailure: continueOnFail.has(name),
    });
  }

  return {
    ok: true,
    plan: { kind: request.kind, name: planName, tasks },
  };
}
