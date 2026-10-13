/**
 * Capability tag vocabulary. Core maintainers own this file; adding a core tag
 * or a reserved area needs a design review (BOLT-EXT-1 §5.1).
 */

/** Core capability tags and how core resolves them. */
export const CORE_CAPABILITIES = {
  doctor: "fan-out",
  diagnose: "fan-out",
  detect: "fan-out",
  notify: "fan-out",
  "vcs.sync": "singleton",
  "vcs.info": "singleton",
  "vcs.revision": "singleton",
  "artifact.store": "singleton",
} as const;

export type KnownCapability = keyof typeof CORE_CAPABILITIES;
/** A core tag, `x-<vendor>.<name>`, or `<own-namespace>.<name>`. */
export type Capability = KnownCapability | (string & {});

/** First segments that only core tags may use, even inside a plugin's own namespace. */
export const RESERVED_CAPABILITY_AREAS: readonly string[] = [
  "doctor",
  "diagnose",
  "detect",
  "notify",
  "vcs",
  "artifact",
];

/** Shared by capability tags and event types. */
export const CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

export const MAX_CAPABILITIES_PER_HANDLER = 8;

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function suggest(tag: string): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const known of Object.keys(CORE_CAPABILITIES)) {
    const score = levenshtein(tag, known);
    if (score < bestScore) {
      best = known;
      bestScore = score;
    }
  }
  return bestScore <= Math.max(2, Math.floor(tag.length / 3)) ? best : undefined;
}

function coreTagsIn(area: string): string[] {
  return Object.keys(CORE_CAPABILITIES).filter((tag) => tag.split(".")[0] === area);
}

/**
 * Validate and normalise one handler's tags: sorted, deduped.
 * `label` names the handler, e.g. `ue/doctor`. Throws with a fix on misuse.
 */
export function normalizeCapabilities(raw: unknown, namespace: string, label: string): string[] {
  if (raw === undefined) return [];
  const list = typeof raw === "string" ? [raw] : raw;
  if (!Array.isArray(list)) {
    throw new Error(
      `${label}: capability must be a string or an array of strings. Example: capability: ["doctor"]`,
    );
  }
  const tags = [...new Set(list)].sort();
  if (tags.length > MAX_CAPABILITIES_PER_HANDLER) {
    throw new Error(
      `${label}: ${tags.length} capabilities (max ${MAX_CAPABILITIES_PER_HANDLER}). Tags describe roles; split the handler if it fills more than ${MAX_CAPABILITIES_PER_HANDLER}.`,
    );
  }
  for (const tag of tags) {
    if (typeof tag !== "string" || !CAPABILITY_PATTERN.test(tag)) {
      throw new Error(
        `${label}: capability ${JSON.stringify(tag)} is not a valid tag. Use lowercase dot-separated words such as "doctor" or "${namespace}.cook".`,
      );
    }
    if (tag in CORE_CAPABILITIES) continue;
    const area = tag.split(".")[0];
    if (RESERVED_CAPABILITY_AREAS.includes(area)) {
      throw new Error(
        `${label}: capability "${tag}" is in reserved core area "${area}"; core tags here: ${coreTagsIn(area).join(", ")}. Use one of those, or "${namespace}.<name>" for a plugin-specific tag.`,
      );
    }
    if (area.startsWith("x-") && tag.includes(".")) continue;
    if (area === namespace && tag.includes(".")) continue;
    const hint = suggest(tag);
    throw new Error(
      `${label}: unknown capability "${tag}".${hint ? ` Did you mean "${hint}"?` : ""} Use a core tag (${Object.keys(CORE_CAPABILITIES).join(", ")}), "x-<vendor>.<name>", or "${namespace}.<name>".`,
    );
  }
  return tags;
}
