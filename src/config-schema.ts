/**
 * JSON Schema for bolt.yaml and bolt.local.yaml.
 * Core fields are generic and `version` is 1. Plugin config is an opaque object.
 */
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

const plugin = {
  type: "object",
  additionalProperties: false,
  required: ["namespace"],
  properties: {
    namespace: { type: "string" },
    path: { type: "string" },
    config: {
      type: "object",
      description:
        "Opaque plugin config. Core does not interpret these fields. The plugin validates them.",
    },
  },
};

const BOLT_CONFIG_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "bolt.yaml",
  description:
    "Bolt pipeline contract. version is 1. Plugin config is opaque: each plugin validates its own config.",
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
    capabilities: {
      type: "object",
      description:
        "Singleton capability tag to handler ref (namespace/handler). bolt.local.yaml wins per key. An empty object is the same as omitting the key. Fan-out tags are ignored with one warning.",
      additionalProperties: { type: "string", minLength: 1 },
      default: {},
    },
    timeout_hours: { type: "number", exclusiveMinimum: 0 },
    notifications: { $ref: "#/$defs/notifications" },
  },
  $defs: {
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
    plugin,
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

const BOLT_LOCAL_CONFIG_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "bolt.local.yaml",
  description:
    "Per-machine overrides (gitignored). vars override bolt.yaml vars. plugins maps a namespace to an opaque object that is deep-merged over that plugin's config before the plugin validates it. capabilities overrides bolt.yaml capabilities per key; an empty object is the same as omitting the key.",
  type: "object",
  additionalProperties: false,
  properties: {
    vars: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    capabilities: {
      type: "object",
      description:
        "Per-key override of bolt.yaml capabilities. An empty object is the same as omitting the key.",
      additionalProperties: { type: "string", minLength: 1 },
    },
    ai: {
      type: "object",
      additionalProperties: false,
      description:
        "Per-machine agent policy. ai.run never refuses every agent execute. Omitted ai.run means confirm and does not block ai:true plans. ai.trust_plugins lifts the non-builtin confirm cap. It never lifts ai:false or a plugin that shadows a built-in namespace.",
      properties: {
        run: {
          enum: ["never", "confirm"],
          description:
            "never refuses agent execute (AGENT_EXECUTION_DISABLED). confirm is the default and does not block ai:true plans.",
        },
        trust_plugins: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description:
            "Namespaces whose handlers may keep ai:true. Does not lift ai:false or shadowing.",
        },
      },
    },
    plugins: {
      type: "object",
      description:
        "Per-namespace overrides. Each value is opaque and deep-merged before that plugin validates it.",
      additionalProperties: { type: "object" },
    },
  },
};

export function boltLocalConfigJsonSchema(): Record<string, unknown> {
  return BOLT_LOCAL_CONFIG_JSON_SCHEMA;
}
