/**
 * Generates reference pages for the Mintlify site from source of truth:
 *   - schema/v1/*.json          -> reference/config/*.mdx
 *   - built-in plugin manifests -> reference/plugins/*.mdx
 *   - citty command definitions -> reference/cli/*.mdx
 *
 * Usage:
 *   bun apps/docs/scripts/generate.ts           write files
 *   bun apps/docs/scripts/generate.ts --check   fail if files are stale
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { PluginRegistry } from "../../../src/plugin-registry";
import { builtinPlugins } from "../../../src/plugins";
import type { HandlerManifest } from "../../../src/plugin";
import { commandSources, commands } from "../../../src/commands";
import { cell } from "./mdx-text";

const DOCS = path.resolve(import.meta.dir, "..");
const REPO = path.resolve(DOCS, "../..");
const OUT = path.join(DOCS, "reference");
const CHECK = process.argv.includes("--check");

const BANNER =
  "{/* GENERATED FILE. Do not edit by hand. Run `bun run docs:gen` from the repo root. */}";

type Json = Record<string, any>;
const files = new Map<string, string>();

function page(rel: string, title: string, description: string, body: string): void {
  const text = `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n${BANNER}\n\n${body.trim()}\n`;
  files.set(rel, format(rel, text));
}

/** Run oxfmt on generated text so `bun run fmt:check` and the drift check agree. */
function format(rel: string, text: string): string {
  const bin = path.join(
    REPO,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "oxfmt.exe" : "oxfmt",
  );
  const res = spawnSync(
    bin,
    ["-c", path.join(REPO, ".oxfmtrc.json"), `--stdin-filepath=apps/docs/${rel}.mdx`],
    { cwd: REPO, input: text, encoding: "utf8" },
  );
  if (res.status !== 0) throw new Error(`oxfmt failed for ${rel}: ${res.stderr || res.error}`);
  return res.stdout;
}

/** Plain code-point order, independent of locale. */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inline code safe inside a table cell. */
function code(text: string): string {
  return "`" + text.replace(/\|/g, "\\|").replace(/`/g, "'") + "`";
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------- config schema

function typeOf(s: Json | boolean | undefined): string {
  if (s === undefined || s === true) return "any";
  if (s === false) return "never";
  if (s.$ref) return s.$ref.split("/").pop();
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v: unknown) => JSON.stringify(v)).join(" | ");
  const union = s.anyOf ?? s.oneOf;
  if (union) return union.map(typeOf).join(" | ");
  if (s.allOf) return s.allOf.map(typeOf).join(" & ");
  const t = Array.isArray(s.type) ? s.type.join(" | ") : s.type;
  if (t === "array") return `${typeOf(s.items)}[]`;
  if (t === "object" && s.additionalProperties && !s.properties)
    return `map<string, ${typeOf(s.additionalProperties)}>`;
  return t ?? "any";
}

function constraints(s: Json): string[] {
  const out: string[] = [];
  for (const k of [
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minItems",
    "pattern",
    "format",
  ])
    if (s[k] !== undefined) out.push(`${k}: ${s[k]}`);
  return out;
}

function propRows(s: Json, refLink: (name: string) => string, prefix: string): string[] {
  const props: Json = s.properties ?? {};
  const required = new Set<string>(s.required ?? []);
  const rows: string[] = [];
  for (const [key, p] of Object.entries(props) as [string, Json][]) {
    const name = prefix + key;
    let type = code(typeOf(p));
    const refs = JSON.stringify(p).match(/#\/\$defs\/[A-Za-z0-9_]+/g) ?? [];
    const links = [...new Set(refs.map((r) => r.split("/").pop()!))].map(refLink);
    if (links.length) type += ` (${links.join(", ")})`;
    const notes = [p.description, ...constraints(p)].filter(Boolean).join(". ");
    const def = p.default !== undefined ? code(JSON.stringify(p.default)) : "";
    rows.push(
      `| ${code(name)} | ${type} | ${required.has(key) ? "yes" : ""} | ${def} | ${cell(notes)} |`,
    );
    // Recurse into inline nested objects (and arrays of inline objects).
    if (p.properties) rows.push(...propRows(p, refLink, `${name}.`));
    else if (p.items?.properties) rows.push(...propRows(p.items, refLink, `${name}[].`));
  }
  return rows;
}

function propsTable(s: Json, refLink: (name: string) => string): string {
  const rows = propRows(s, refLink, "");
  if (!rows.length) return "_No named properties._";
  return [
    "| Field | Type | Required | Default | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function schemaPage(file: string): string {
  const schema: Json = JSON.parse(readFileSync(path.join(REPO, "schema/v1", file), "utf8"));
  const base = file.replace(/\.schema\.json$/, "");
  const rel = `reference/config/${slug(base)}-yaml`;
  const defs: Json = schema.$defs ?? schema.definitions ?? {};
  const refLink = (name: string) => `[${name}](#${slug(name)})`;
  const sections: string[] = [];
  if (schema.description) sections.push(cell(schema.description));
  sections.push(
    `Source: [\`schema/v1/${file}\`](https://github.com/jukrb0x/Bolt/blob/main/schema/v1/${file}). Draft: ${code(schema.$schema ?? "unknown")}.`,
  );
  sections.push(`## Top-level fields\n\n${propsTable(schema, refLink)}`);
  if (schema.additionalProperties === false)
    sections.push("Unknown top-level fields are rejected.");
  if (Object.keys(defs).length) {
    sections.push("## Definitions");
    for (const [name, def] of Object.entries(defs).sort(([a], [b]) => byCodePoint(a, b))) {
      const parts = [`### ${name}`, `Type: ${code(typeOf({ ...def, $ref: undefined }))}`];
      if (def.description) parts.push(cell(def.description));
      if (def.properties) parts.push(propsTable(def, refLink));
      const union = def.anyOf ?? def.oneOf;
      if (union) {
        parts.push("One of:");
        parts.push(
          union
            .map((u: Json, i: number) => {
              const head = `${i + 1}. ${code(typeOf(u))}`;
              return u.properties ? `${head}\n\n${propsTable(u, refLink)}` : head;
            })
            .join("\n\n"),
        );
      }
      sections.push(parts.join("\n\n"));
    }
  }
  page(
    rel,
    schema.title ?? base,
    `Generated field reference for ${schema.title ?? base} (schema/v1/${file}).`,
    sections.join("\n\n"),
  );
  return rel;
}

// ---------------------------------------------------------------- plugins

function paramsTable(schema: Json | undefined): string {
  if (!schema?.properties) return "_No declared parameter schema._";
  const required = new Set<string>(schema.required ?? []);
  const rows = Object.entries(schema.properties as Json).map(([name, p]: [string, Json]) => {
    const def = p.default !== undefined ? code(JSON.stringify(p.default)) : "";
    const notes = [p.description, ...constraints(p)].filter(Boolean).join(". ");
    return `| ${code(name)} | ${code(typeOf(p))} | ${required.has(name) ? "yes" : ""} | ${def} | ${cell(notes)} |`;
  });
  return [
    "| Param | Type | Required | Default | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function aiLabel(ai: HandlerManifest["ai"]): string {
  if (ai === true) return "`true` (AI may call this handler)";
  if (ai === "confirm") return '`"confirm"` (AI may call it after user confirmation)';
  return "`false` (not exposed to AI)";
}

function pluginPages(): string[] {
  const reg = new PluginRegistry();
  for (const plugin of builtinPlugins) reg.register(plugin);
  const out: string[] = [];
  for (const ns of reg.listNamespaces().sort()) {
    const manifest = reg.get(ns)!.manifest!;
    const rel = `reference/plugins/${slug(ns)}`;
    const parts: string[] = [];
    if (manifest.description) parts.push(cell(manifest.description));
    parts.push(
      `| Namespace | Version | Handlers |\n| --- | --- | --- |\n| ${code(ns)} | ${manifest.version ? code(manifest.version) : ""} | ${Object.keys(manifest.handlers).length} |`,
    );
    parts.push("## Handlers");
    for (const [name, h] of Object.entries(manifest.handlers).sort(([a], [b]) =>
      byCodePoint(a, b),
    )) {
      const lines = [`### ${ns}/${name}`];
      if (h.description) lines.push(cell(h.description));
      lines.push(`Step: ${code(`uses: ${ns}/${name}`)}. AI: ${aiLabel(h.ai)}.`);
      if (h.capabilities?.length) {
        lines.push(`Capabilities: ${h.capabilities.map((tag) => code(tag)).join(", ")}.`);
      }
      lines.push(paramsTable(h.paramsSchema as Json | undefined));
      parts.push(lines.join("\n\n"));
    }
    page(
      rel,
      `${ns} plugin`,
      manifest.description ?? `Generated handler reference for the built-in ${ns} plugin.`,
      parts.join("\n\n"),
    );
    out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------- CLI

type Resolvable<T> = T | Promise<T> | (() => T | Promise<T>);
async function resolve<T>(v: Resolvable<T>): Promise<T> {
  return typeof v === "function" ? await (v as () => T)() : await v;
}

async function commandSection(cmd: any, pathParts: string[], depth: number): Promise<string> {
  const meta = (await resolve(cmd.meta ?? {})) as Json;
  const args = (await resolve(cmd.args ?? {})) as Json;
  const subs = (await resolve(cmd.subCommands ?? {})) as Json;
  const h = "#".repeat(depth);
  const full = ["bolt", ...pathParts].join(" ");
  const parts: string[] = [];
  if (depth > 2) parts.push(`${h} ${full}`);
  if (meta.description) parts.push(cell(meta.description));
  const positional = Object.entries(args).filter(
    ([, a]: [string, Json]) => a.type === "positional",
  );
  const usage = [full, ...positional.map(([n, a]) => (a.required === false ? `[${n}]` : `<${n}>`))];
  if (Object.keys(subs).length) usage.push("<command>");
  if (Object.keys(args).length > positional.length) usage.push("[options]");
  parts.push("```bash\n" + usage.join(" ") + "\n```");
  if (Object.keys(args).length) {
    const rows = Object.entries(args).map(([name, a]: [string, Json]) => {
      const flag = a.type === "positional" ? name : `--${name}`;
      const alias = a.alias
        ? [a.alias]
            .flat()
            .map((x: string) => code(`-${x}`))
            .join(", ")
        : "";
      const def = a.default !== undefined ? code(JSON.stringify(a.default)) : "";
      return `| ${code(flag)} | ${a.type ?? "string"} | ${alias} | ${a.required ? "yes" : ""} | ${def} | ${cell(a.description)} |`;
    });
    parts.push(
      [
        "| Argument | Type | Alias | Required | Default | Description |",
        "| --- | --- | --- | --- | --- | --- |",
        ...rows,
      ].join("\n"),
    );
  }
  for (const [name, sub] of Object.entries(subs))
    parts.push(await commandSection(await resolve(sub), [...pathParts, name], depth + 1));
  return parts.join("\n\n");
}

async function cliPages(): Promise<string[]> {
  const out: string[] = [];
  for (const [name, cmd] of Object.entries(commands)) {
    const file = commandSources[name as keyof typeof commands];
    const mod = { default: cmd as any };
    const body = await commandSection(mod.default, [name], 2);
    const rel = `reference/cli/${slug(name)}`;
    const meta = (await resolve(mod.default.meta ?? {})) as Json;
    page(
      rel,
      `bolt ${name}`,
      meta.description ? String(meta.description) : `Generated reference for bolt ${name}.`,
      `Source: [\`src/commands/${file}\`](https://github.com/jukrb0x/Bolt/blob/main/src/commands/${file}).\n\n${body}\n\nUnknown or reserved flags exit \`2\` before the command runs. See [Invalid flags](/cli#invalid-flags).`,
    );
    out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------- main

const schemaFiles = readdirSync(path.join(REPO, "schema/v1"))
  .filter((f) => f.endsWith(".schema.json"))
  .sort();
const generated = {
  config: schemaFiles.map(schemaPage),
  plugins: pluginPages(),
  cli: await cliPages(),
};

// Every generated page must be reachable from docs.json navigation.
const nav = readFileSync(path.join(DOCS, "docs.json"), "utf8");
const missing = Object.values(generated)
  .flat()
  .filter((rel) => !nav.includes(`"${rel}"`));

const existing = new Set<string>();
const walk = (dir: string) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else existing.add(path.relative(DOCS, p).split(path.sep).join("/"));
  }
};
walk(OUT);

const stale: string[] = [];
for (const [rel, text] of files) {
  const file = path.join(DOCS, `${rel}.mdx`);
  const current = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  existing.delete(`${rel}.mdx`);
  if (current === text) continue;
  stale.push(`${rel}.mdx`);
  if (!CHECK) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}
for (const extra of existing) {
  stale.push(`${extra} (orphan)`);
  if (!CHECK) rmSync(path.join(DOCS, extra));
}

if (missing.length) {
  console.error(
    `Generated pages missing from apps/docs/docs.json navigation:\n  ${missing.join("\n  ")}`,
  );
  process.exit(1);
}
if (CHECK && stale.length) {
  console.error(
    `Generated docs are out of date. Run \`bun run docs:gen\` and commit:\n  ${stale.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(
  CHECK
    ? `Generated docs are up to date (${files.size} pages).`
    : `Wrote ${stale.length} of ${files.size} generated pages.`,
);
