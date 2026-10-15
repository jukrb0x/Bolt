import type { BoltPlugin } from "./plugin";
import { handlersDiffer } from "./plugin-cache";
import type { PreviewParticipant } from "./plan-preview";
import { PluginRegistry, type PluginSource } from "./plugin-registry";

export type VerifiedLoad =
  | { ok: true; registry: PluginRegistry }
  | { ok: false; namespace: string; detail: string };

/**
 * Stage 2 loader. Imports only participating plugins, and only from the
 * content-addressed artefact Stage 1 already re-hashed. Never compiles,
 * never installs, never imports a source directory.
 *
 * On divergence the module top-level and (for a class plugin) the constructor
 * have already run. onInit, hooks, and handlers have not.
 */
export async function loadVerifiedPlugins(
  participants: PreviewParticipant[],
  builtins: BoltPlugin[],
): Promise<VerifiedLoad> {
  const registry = new PluginRegistry();
  for (const plugin of builtins) registry.register(plugin);
  for (const participant of participants) {
    if (participant.source === "builtin") continue;
    if (!participant.built || !participant.artefactPath || !participant.manifest) {
      return { ok: false, namespace: participant.namespace, detail: "missing artefact" };
    }
    let plugin: BoltPlugin;
    try {
      plugin = await registry.importArtefact(
        participant.namespace,
        participant.artefactPath,
        participant.config,
        participant.source as Exclude<PluginSource, "builtin">,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, namespace: participant.namespace, detail: message };
    }
    const detail = handlersDiffer(plugin, participant.manifest);
    if (detail) return { ok: false, namespace: participant.namespace, detail };
  }
  return { ok: true, registry };
}
