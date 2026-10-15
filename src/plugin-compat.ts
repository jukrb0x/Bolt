/**
 * Plugin API compatibility constants. This file is the single source for the
 * plugin API version set, the feature list printed by `bolt version --json`,
 * and the minimum bolt release that supports plugin API v2.
 */

/** Highest plugin API version this bolt implements. */
export const PLUGIN_API_VERSION = 2;

/** Every plugin API version this bolt accepts. A plugin without a version is v1. */
export const SUPPORTED_PLUGIN_API_VERSIONS: readonly number[] = [1, 2];

/**
 * First bolt release that supports plugin API v2.
 *
 * The literal "<X>" is a placeholder that is filled in when the release is cut.
 * `scripts/check-release-placeholders.ts` fails the release workflow while it is
 * still present. Messages never depend on it alone: they always point to
 * `bolt version --json` first.
 */
export const MIN_BOLT_FOR_PLUGIN_API_2: string = "<X>";

/**
 * Version of the in-memory plugin manifest shape. Bump it whenever the manifest
 * gains or changes a recorded field. Format 2 adds `capabilities` and `pluginApi`.
 */
export const MANIFEST_FORMAT = 2;

/** Append-only capability flags printed by `bolt version --json`. */
export const VERSION_CAPABILITIES: readonly string[] = [
  "handler-results",
  "capability-tags",
  "plugin-api-2",
  "plugin-manifest",
  "agent",
  "execute",
  "confirm",
];

export function isSupportedPluginApi(version: unknown): version is number {
  return typeof version === "number" && SUPPORTED_PLUGIN_API_VERSIONS.includes(version);
}

/** True while MIN_BOLT_FOR_PLUGIN_API_2 still holds the unreleased placeholder. */
export function minBoltIsPlaceholder(): boolean {
  return !/^\d+\.\d+\.\d+/.test(MIN_BOLT_FOR_PLUGIN_API_2);
}

/**
 * How to check that a bolt supports plugin API v2. The `bolt version --json`
 * check comes first; the release number is extra information.
 */
export function pluginApi2Requirement(): string {
  const release = minBoltIsPlaceholder() ? "" : ` (bolt ${MIN_BOLT_FOR_PLUGIN_API_2} or later)`;
  return `Requires a bolt whose \`bolt version --json\` lists "plugin-api-2" under capabilities${release}.`;
}
