import type { BoltConfig, Step } from "./config"

export interface ParsedOp {
  name:    string   // op name (e.g. "update", "build")
  value:   string   // variant key or override value (default: "default")
  isExact: boolean  // true if separator was "=" (exact target override for build)
}

export interface ResolvedOp {
  name:  string  // display name (e.g. "update[svn]" or "update")
  steps: Step[]  // resolved steps ready for execStep
}

export function parseGoArgs(tokens: string[]): ParsedOp[] {
  return tokens.map(token => {
    if (token.startsWith("--")) {
      // --name  or  --name=value
      const stripped = token.slice(2)
      const eqIdx = stripped.indexOf("=")
      if (eqIdx !== -1) {
        return { name: stripped.slice(0, eqIdx), value: stripped.slice(eqIdx + 1), isExact: true }
      }
      return { name: stripped, value: "default", isExact: false }
    }

    // name  or  name:value
    const colonIdx = token.indexOf(":")
    if (colonIdx !== -1) {
      return { name: token.slice(0, colonIdx), value: token.slice(colonIdx + 1), isExact: true }
    }
    return { name: token, value: "default", isExact: false }
  })
}

export function resolveOps(parsed: ParsedOp[], cfg: BoltConfig): ResolvedOp[] {
  return parsed.map(p => {
    const opDef = cfg.ops[p.name]
    if (!opDef) throw new Error(`Unknown op: "${p.name}"`)

    if (!p.isExact) {
      // Use value as variant key directly
      const steps = opDef[p.value]
      if (!steps) throw new Error(`Unknown variant "${p.value}" for op "${p.name}"`)
      const displayName = p.value === "default" ? p.name : `${p.name}[${p.value}]`
      return { name: displayName, steps }
    }

    // isExact: try as variant key first
    const variantSteps = opDef[p.value]
    if (variantSteps) {
      const displayName = p.value === "default" ? p.name : `${p.name}[${p.value}]`
      return { name: displayName, steps: variantSteps }
    }

    // Fall back to "default" variant, deep-clone and override with.target
    const defaultSteps = opDef["default"]
    if (!defaultSteps) throw new Error(`Unknown variant "${p.value}" for op "${p.name}"`)

    const cloned: Step[] = defaultSteps.map(step => {
      if (step.with && "target" in step.with) {
        return { ...step, with: { ...step.with, target: p.value } }
      }
      return { ...step }
    })

    return { name: `${p.name}[${p.value}]`, steps: cloned }
  })
}

export function sortByPipeline(ops: ResolvedOp[], order: string[]): ResolvedOp[] {
  const clone = [...ops]
  return clone.sort((a, b) => {
    const nameA = a.name.replace(/\[.*\]$/, "")
    const nameB = b.name.replace(/\[.*\]$/, "")
    const idxA  = order.indexOf(nameA)
    const idxB  = order.indexOf(nameB)
    if (idxA === -1 && idxB === -1) return 0  // both unknown: preserve relative order
    if (idxA === -1) return 1                  // unknown goes to end
    if (idxB === -1) return -1
    return idxA - idxB
  })
}
