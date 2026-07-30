import type { PlanNode } from "./run-plan";

export function formatPlanNodes(nodes: PlanNode[], depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return nodes.flatMap((node) => {
    if (node.kind === "call") {
      return [`${pad}call: ${node.name}`, ...formatPlanNodes(node.nodes, depth + 1)];
    }
    if (node.kind === "run") return [`${pad}run: ${node.command}`];
    const params = Object.entries(node.params)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
    return [`${pad}uses: ${node.ref}${params ? `  ${params}` : ""}`];
  });
}
