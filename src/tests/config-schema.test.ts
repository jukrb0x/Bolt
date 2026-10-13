import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { parse } from "yaml";
import { checkConfig } from "../config";
import { boltConfigJsonSchema, boltLocalConfigJsonSchema } from "../config-schema";
import { schemaErrors } from "./schema-match";

const root = path.resolve(import.meta.dir, "../..");

test("bolt.yaml schema is version 1 and has no root targets", () => {
  const schema = boltConfigJsonSchema();
  expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
  expect(schema.type).toBe("object");
  expect(schema.additionalProperties).toBe(false);
  expect(schema.required).toEqual(["version", "project"]);

  const properties = schema.properties as Record<string, unknown>;
  expect(properties.version).toEqual({ type: "number", const: 1 });
  for (const banned of ["targets", "engine", "uproject", "engine_path", "project_path"]) {
    expect(properties[banned]).toBeUndefined();
  }

  const project = properties.project as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown>;
  };
  expect(project.additionalProperties).toBe(false);
  expect(project.required).toEqual(["name"]);
  expect(Object.keys(project.properties)).toEqual(["name"]);

  const defs = schema.$defs as Record<string, { properties: Record<string, unknown> }>;
  expect(Object.keys(defs.ueConfig.properties).sort()).toEqual(
    ["engine", "project", "targets", "uproject"].sort(),
  );
  expect(defs.ueConfig.properties.targets).toBeDefined();
  const target = defs.ueTarget as { properties: { kind: { enum: string[] } } };
  expect(target.properties.kind.enum).toEqual(["editor", "program", "game", "client", "server"]);
});

test("committed schema matches the schema the running bolt writes", () => {
  const committed = JSON.parse(readFileSync(path.join(root, "schema/v1/bolt.schema.json"), "utf8"));
  expect(committed).toEqual(boltConfigJsonSchema());
});

const documents: Array<{ name: string; yaml: string; ok: boolean }> = [
  {
    name: "generic starter",
    ok: true,
    yaml: "version: 1\nproject:\n  name: MyProject\n",
  },
  {
    name: "missing version",
    ok: false,
    yaml: "project:\n  name: MyProject\n",
  },
  {
    name: "version 2",
    ok: false,
    yaml: "version: 2\nproject:\n  name: MyProject\n",
  },
  {
    name: "root targets",
    ok: false,
    yaml: [
      "version: 1",
      "project:",
      "  name: MyProject",
      "targets:",
      "  editor: { kind: editor }",
    ].join("\n"),
  },
  {
    name: "engine on project",
    ok: false,
    yaml: ["version: 1", "project:", "  name: MyProject", "  engine: { vcs: git }"].join("\n"),
  },
  {
    name: "ue metadata under the ue plugin",
    ok: true,
    yaml: [
      "version: 1",
      "project: { name: MyProject }",
      "plugins:",
      "  - namespace: ue",
      "    config:",
      "      engine: { path: ./engine, vcs: git }",
      "      project: { path: ./project, vcs: svn }",
      "      uproject: ./project/MyProject.uproject",
      "      targets:",
      "        editor: { kind: editor, config: development }",
      "        client: { kind: program, name: MyClient, config: shipping }",
    ].join("\n"),
  },
  {
    name: "mixed-case and padded ue build configs",
    ok: true,
    yaml: [
      "version: 1",
      "project: { name: MyProject }",
      "plugins:",
      "  - namespace: ue",
      "    config:",
      "      engine: { path: e }",
      "      project: { path: p }",
      "      uproject: p.uproject",
      "      targets:",
      "        editor: { kind: editor, config: Development }",
      '        game: { kind: game, config: " DebugGame " }',
      '        client: { kind: client, config: "  development  " }',
    ].join("\n"),
  },
  {
    name: "invalid ue target kind",
    ok: false,
    yaml: [
      "version: 1",
      "project: { name: MyProject }",
      "plugins:",
      "  - namespace: ue",
      "    config:",
      "      engine: { path: e }",
      "      project: { path: p }",
      "      uproject: p.uproject",
      "      targets:",
      "        editor: { kind: invalid_kind }",
    ].join("\n"),
  },
  {
    name: "svn flag under the svn plugin",
    ok: true,
    yaml: [
      "version: 1",
      "project: { name: MyProject }",
      "plugins:",
      "  - namespace: svn",
      "    config: { use_tortoise: false }",
    ].join("\n"),
  },
  {
    name: "svn flag with the wrong type",
    ok: false,
    yaml: [
      "version: 1",
      "project: { name: MyProject }",
      "plugins:",
      "  - namespace: svn",
      '    config: { use_tortoise: "yes" }',
    ].join("\n"),
  },
  {
    name: "legacy task reference",
    ok: false,
    yaml: [
      "version: 1",
      "project: { name: MyProject }",
      "tasks:",
      "  legacy: [{ uses: task/build }]",
    ].join("\n"),
  },
  {
    name: "run step with parameters",
    ok: false,
    yaml: [
      "version: 1",
      "project: { name: MyProject }",
      "tasks:",
      "  hi:",
      "    - run: echo hi",
      "      with: { mode: debug }",
    ].join("\n"),
  },
  {
    name: "custom plugin and a wecom notification",
    ok: true,
    yaml: [
      "version: 1",
      "project: { name: MyProject }",
      "plugins:",
      "  - namespace: extra",
      "    path: ./plugins/extra.ts",
      "    config: { host: example }",
      "notifications:",
      "  providers:",
      "    - { type: wecom, webhook_url: https://example.invalid/hook }",
    ].join("\n"),
  },
  {
    name: "unknown notification provider",
    ok: false,
    yaml: [
      "version: 1",
      "project: { name: MyProject }",
      "notifications:",
      "  providers:",
      "    - { type: slack, webhook_url: https://example.invalid/hook }",
    ].join("\n"),
  },
];

for (const document of documents) {
  test(`schema agrees with bolt check: ${document.name}`, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bolt-schema-"));
    const file = path.join(dir, "bolt.yaml");
    writeFileSync(file, document.yaml);
    const checked = await checkConfig(file);
    const errors = schemaErrors(boltConfigJsonSchema(), parse(document.yaml));
    expect(checked.ok).toBe(document.ok);
    expect(errors.length === 0).toBe(document.ok);
  });
}

test("committed bolt.local.yaml schema matches the running bolt", () => {
  const committed = JSON.parse(
    readFileSync(path.join(root, "schema/v1/bolt.local.schema.json"), "utf8"),
  );
  expect(committed).toEqual(boltLocalConfigJsonSchema());
});

test("bolt.local.yaml schema accepts plugin overrides and rejects v2.0 keys", () => {
  const schema = boltLocalConfigJsonSchema();
  expect(
    schemaErrors(
      schema,
      parse(
        "vars: { region: eu }\nplugins:\n  ue: { engine: { path: D:/UE } }\n  svn: { use_tortoise: true }\n",
      ),
    ),
  ).toHaveLength(0);
  expect(schemaErrors(schema, parse("engine_path: D:/UE\n")).length).toBeGreaterThan(0);
  // A target override may set only some fields; the merge supplies the rest.
  expect(
    schemaErrors(schema, parse("plugins:\n  ue: { targets: { editor: { config: debug } } }\n")),
  ).toHaveLength(0);
  expect(
    schemaErrors(schema, parse("plugins: { svn: { use_tortoise: yes-please } }\n")).length,
  ).toBeGreaterThan(0);
});
