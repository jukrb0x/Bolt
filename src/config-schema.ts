/**
 * JSON Schema for bolt.yaml.
 * Core fields are generic and `version` is 1. Unreal metadata is `$defs.ueConfig`,
 * referenced only from a `plugins[]` entry whose namespace is `ue`. There is no root `targets`.
 */
import { buildConfigSchemaPattern } from "./build-config";
const repo = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: { type: "string", minLength: 1 },
    vcs: { enum: ["git", "svn"], default: "git" },
    url: { type: "string" },
    branch: { type: "string" },
  },
};

const engineVersion = {
  enum: [4, 5, "4", "5"],
  description:
    "Unreal Engine major version. Omit to detect it from Engine/Build/Build.version, then from which editor binaries exist.",
};

const engineRepo = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: { ...repo.properties, version: engineVersion },
};

const editorTarget = {
  type: "string",
  pattern: "^[A-Za-z0-9_]+$",
  description:
    "Editor target and executable base name, e.g. UnrealEditor or UE4Editor. Overrides the name implied by engine.version.",
};

const ueTarget = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: { type: "string", enum: ["editor", "program", "game", "client", "server"] },
    name: { type: "string" },
    config: {
      type: "string",
      pattern: buildConfigSchemaPattern(),
      description:
        "Build configuration. Same names bolt check accepts, in any case, with surrounding space allowed.",
    },
  },
};

const ueConfig = {
  description:
    "Unreal metadata. Valid only under plugins[].config when namespace is ue, never as a root bolt.yaml field.",
  type: "object",
  additionalProperties: false,
  required: ["engine", "project", "uproject"],
  properties: {
    engine: { $ref: "#/$defs/engineRepo" },
    project: { $ref: "#/$defs/repo" },
    editor_target: editorTarget,
    uproject: { type: "string", minLength: 1 },
    targets: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/ueTarget" },
      default: {},
    },
  },
};

const svnConfig = {
  type: "object",
  additionalProperties: false,
  properties: {
    use_tortoise: { type: "boolean" },
  },
};

const stepParams = {
  type: "object",
  additionalProperties: { type: "string" },
};

const usesStep = {
  type: "object",
  additionalProperties: false,
  required: ["uses"],
  properties: {
    uses: { type: "string", minLength: 1, not: { pattern: "^task/" } },
    with: stepParams,
    "continue-on-error": { type: "boolean" },
  },
};

const callStep = {
  type: "object",
  additionalProperties: false,
  required: ["call"],
  properties: {
    call: { type: "string", minLength: 1 },
    with: stepParams,
    "continue-on-error": { type: "boolean" },
  },
};

const runStep = {
  type: "object",
  additionalProperties: false,
  required: ["run"],
  properties: {
    run: { type: "string", minLength: 1 },
    "continue-on-error": { type: "boolean" },
  },
};

const pluginPath = { type: "string" };

const BOLT_CONFIG_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "bolt.yaml",
  description:
    "Bolt pipeline contract. version is 1. Unreal engine, project, uproject, and targets belong under the ue plugin config.",
  type: "object",
  additionalProperties: false,
  required: ["version", "project"],
  properties: {
    version: { type: "number", const: 1 },
    project: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
      },
    },
    vars: {
      type: "object",
      additionalProperties: { type: "string" },
      default: {},
    },
    tasks: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/stepList" },
      default: {},
    },
    flows: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/flow" },
      default: {},
    },
    plugins: {
      type: "array",
      default: [],
      items: { $ref: "#/$defs/plugin" },
    },
    timeout_hours: { type: "number", exclusiveMinimum: 0 },
    notifications: { $ref: "#/$defs/notifications" },
  },
  $defs: {
    repo,
    engineRepo,
    ueTarget,
    ueConfig,
    svnConfig,
    step: { oneOf: [usesStep, callStep, runStep] },
    stepList: {
      type: "array",
      items: { $ref: "#/$defs/step" },
    },
    flow: {
      type: "object",
      additionalProperties: false,
      required: ["steps"],
      properties: {
        description: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        continue_on_fail: { type: "array", items: { type: "string" }, default: [] },
      },
    },
    plugin: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["namespace", "config"],
          properties: {
            namespace: { type: "string", const: "ue" },
            path: pluginPath,
            config: { $ref: "#/$defs/ueConfig" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["namespace"],
          properties: {
            namespace: { type: "string", const: "svn" },
            path: pluginPath,
            config: { $ref: "#/$defs/svnConfig" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["namespace"],
          properties: {
            namespace: { type: "string", not: { enum: ["ue", "svn"] } },
            path: pluginPath,
            config: { type: "object" },
          },
        },
      ],
    },
    wecom: {
      type: "object",
      additionalProperties: false,
      required: ["type", "webhook_url"],
      properties: {
        type: { const: "wecom" },
        webhook_url: { type: "string" },
        chat_id: { type: "string" },
      },
    },
    telegram: {
      type: "object",
      additionalProperties: false,
      required: ["type", "bot_token", "chat_id"],
      properties: {
        type: { const: "telegram" },
        bot_token: { type: "string" },
        chat_id: { type: "string" },
      },
    },
    notifications: {
      type: "object",
      additionalProperties: false,
      properties: {
        on_start: { type: "boolean", default: true },
        on_op_complete: { type: "boolean", default: true },
        on_failure: { type: "boolean", default: true },
        on_complete: { type: "boolean", default: true },
        providers: {
          type: "array",
          items: { oneOf: [{ $ref: "#/$defs/wecom" }, { $ref: "#/$defs/telegram" }] },
          default: [],
        },
      },
    },
  },
};

export function boltConfigJsonSchema(): Record<string, unknown> {
  return BOLT_CONFIG_JSON_SCHEMA;
}

const partialRepo = {
  type: "object",
  additionalProperties: false,
  properties: repo.properties,
};

const partialEngineRepo = {
  type: "object",
  additionalProperties: false,
  properties: engineRepo.properties,
};

const BOLT_LOCAL_CONFIG_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "bolt.local.yaml",
  description:
    "Per-machine overrides (gitignored). vars override bolt.yaml vars. plugins.<namespace> is deep-merged over the config of the bolt.yaml plugin with that namespace before validation.",
  type: "object",
  additionalProperties: false,
  properties: {
    vars: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    plugins: {
      type: "object",
      properties: {
        ue: {
          type: "object",
          additionalProperties: false,
          properties: {
            engine: partialEngineRepo,
            project: partialRepo,
            editor_target: editorTarget,
            uproject: { type: "string", minLength: 1 },
            targets: {
              type: "object",
              additionalProperties: { $ref: "#/$defs/partialUeTarget" },
            },
          },
        },
        svn: svnConfig,
      },
      additionalProperties: { type: "object" },
    },
  },
  $defs: {
    // Merged over the bolt.yaml target, so every field is optional here.
    partialUeTarget: {
      type: "object",
      additionalProperties: false,
      properties: ueTarget.properties,
    },
  },
};

export function boltLocalConfigJsonSchema(): Record<string, unknown> {
  return BOLT_LOCAL_CONFIG_JSON_SCHEMA;
}
