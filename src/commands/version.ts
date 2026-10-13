import { defineCommand } from "citty";
import { VERSION } from "../version";
import {
  MANIFEST_FORMAT,
  SUPPORTED_PLUGIN_API_VERSIONS,
  VERSION_CAPABILITIES,
} from "../plugin-compat";

/** Machine-readable feature discovery. Fields and capabilities are append-only. */
export function versionInfo() {
  return {
    version: VERSION,
    plugin_api: [...SUPPORTED_PLUGIN_API_VERSIONS],
    manifest_format: MANIFEST_FORMAT,
    capabilities: [...VERSION_CAPABILITIES],
  };
}

export default defineCommand({
  meta: { description: "Print bolt version" },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print version, supported plugin API versions, and capabilities as JSON",
    },
  },
  run({ args }) {
    if (args?.json) console.log(JSON.stringify(versionInfo(), null, 2));
    else console.log(VERSION);
  },
});
