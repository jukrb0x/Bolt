import type { BoltConfig, Step } from "./config";

export interface ParsedOp {
  name: string; // op name (e.g. "update", "build")
  value: string; // variant key or override value (default: "default")
  isExact: boolean; // true if separator was "=" or ":" (exact target override for build)
  params: Record<string, string>; // inline params from --key=val tokens following this op
}

export interface ResolvedOp {
  name: string; // display name (e.g. "update[svn]" or "update")
  steps: Step[]; // resolved steps ready for execStep
  params: Record<string, string>; // inline params forwarded to execStep
}

const GLOBAL_FLAGS = new Set(["--dry-run"]);

export function parseGoArgs(tokens: string[]): ParsedOp[] {
  const ops: ParsedOp[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // Skip global flags at top level
    if (GLOBAL_FLAGS.has(token)) {
      i++;
      continue;
    }

    // Non-flag token = op token
    if (!token.startsWith("--")) {
      const colonIdx = token.indexOf(":");
      let name: string, value: string, isExact: boolean;
      if (colonIdx !== -1) {
        name = token.slice(0, colonIdx);
        value = token.slice(colonIdx + 1);
        isExact = true;
      } else {
        name = token;
        value = "default";
        isExact = false;
      }

      // Consume following --key=val tokens (must contain "=") as inline params for this op
      const params: Record<string, string> = {};
      i++;
      while (
        i < tokens.length &&
        tokens[i].startsWith("--") &&
        !GLOBAL_FLAGS.has(tokens[i]) &&
        tokens[i].includes("=")
      ) {
        const param = tokens[i].slice(2);
        const eqIdx = param.indexOf("=");
        params[param.slice(0, eqIdx)] = param.slice(eqIdx + 1);
        i++;
      }

      ops.push({ name, value, isExact, params });
      continue;
    }

    // --flag style token (e.g. --update, --build=client)
    const stripped = token.slice(2);
    const eqIdx = stripped.indexOf("=");
    let name: string, value: string, isExact: boolean;
    if (eqIdx !== -1) {
      name = stripped.slice(0, eqIdx);
      value = stripped.slice(eqIdx + 1);
      isExact = true;
    } else {
      name = stripped;
      value = "default";
      isExact = false;
    }
    i++;

    // Consume following --key=val tokens (must contain "=") as inline params for this op
    const params: Record<string, string> = {};
    while (
      i < tokens.length &&
      tokens[i].startsWith("--") &&
      !GLOBAL_FLAGS.has(tokens[i]) &&
      tokens[i].includes("=")
    ) {
      const param = tokens[i].slice(2);
      const paramEqIdx = param.indexOf("=");
      params[param.slice(0, paramEqIdx)] = param.slice(paramEqIdx + 1);
      i++;
    }

    ops.push({ name, value, isExact, params });
  }

  return ops;
}

export function resolveOps(parsed: ParsedOp[], cfg: BoltConfig): ResolvedOp[] {
  return parsed.map((p) => {
    const opDef = cfg.ops[p.name];
    if (!opDef) throw new Error(`Unknown op: "${p.name}"`);

    if (!p.isExact) {
      // Use value as variant key directly
      const steps = opDef[p.value];
      if (!steps) throw new Error(`Unknown variant "${p.value}" for op "${p.name}"`);
      const displayName = p.value === "default" ? p.name : `${p.name}[${p.value}]`;
      return { name: displayName, steps, params: p.params };
    }

    // isExact: try as variant key first
    const variantSteps = opDef[p.value];
    if (variantSteps) {
      const displayName = p.value === "default" ? p.name : `${p.name}[${p.value}]`;
      return { name: displayName, steps: variantSteps, params: p.params };
    }

    // Fall back to "default" variant, deep-clone and override with.target
    const defaultSteps = opDef["default"];
    if (!defaultSteps) throw new Error(`Unknown variant "${p.value}" for op "${p.name}"`);

    const cloned: Step[] = defaultSteps.map((step) => {
      if (step.with && "target" in step.with) {
        return { ...step, with: { ...step.with, target: p.value } };
      }
      return { ...step };
    });

    return { name: `${p.name}[${p.value}]`, steps: cloned, params: p.params };
  });
}

export function sortByPipeline(ops: ResolvedOp[], order: string[]): ResolvedOp[] {
  const clone = [...ops];
  return clone.sort((a, b) => {
    const nameA = a.name.replace(/\[.*\]$/, "");
    const nameB = b.name.replace(/\[.*\]$/, "");
    const idxA = order.indexOf(nameA);
    const idxB = order.indexOf(nameB);
    if (idxA === -1 && idxB === -1) return 0; // both unknown: preserve relative order
    if (idxA === -1) return 1; // unknown goes to end
    if (idxB === -1) return -1;
    return idxA - idxB;
  });
}
