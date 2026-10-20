import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

/**
 * C1a catalog-as-truth. Inventory on b89f52d, no new schema fields:
 *
 * - Task names: `data.tasks` string[] on bolt.list/v1 and bolt.info/v1 (equal).
 * - Flows: `data.flows[].name` and `.steps` on both (equal). list may also set `description`.
 * - Handler `ai` marks: `data.plugins[].handlers[].name` and `.ai` on bolt.catalog/v1 only.
 *   `ai: false` handlers are omitted. `info` `data.plugins` is config (namespace/source), not handlers.
 *
 * Not on list/info/ai, so this slice does not add them:
 * - which handler a task uses (steps)
 * - a task's effective `ai` (`data.ai` on bolt inspect / bolt run --dry-run)
 */

const REPO = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO, "src/main.ts");
const SKILL = path.join(REPO, "skills/boltstack/SKILL.md");

const YAML = `version: 1
project:
  name: c1a-fixture
plugins:
  - namespace: ue
    config:
      engine:
        path: ./engine
      project:
        path: ./game
      uproject: ./game/Game.uproject
tasks:
  look:
    - uses: git/info
  ship:
    - uses: fs/mkdir
  die:
    - uses: ue/kill
flows:
  daily:
    description: daily look then ship
    steps: [look, ship]
`;

const PROSE_ONLY = "prose-only";
const CONTEXT_ONLY = "context-only";

type FlowRow = { name: string; steps: string[]; description?: string };
type ListInfoData = {
  tasks: string[];
  flows: FlowRow[];
  plugins?: Array<Record<string, unknown>>;
};
type CatalogHandler = { name: string; ai?: boolean | "confirm" };
type CatalogData = { plugins: Array<{ namespace: string; handlers: CatalogHandler[] }> };

function bolt(argv: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  const home = path.join(cwd, ".empty-home");
  mkdirSync(home, { recursive: true });
  const proc = Bun.spawn(["bun", MAIN, ...argv], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([out, err, code]) => ({ code, out, err }));
}

function parseStdout(out: string): { schema: string; ok: boolean; data: unknown } {
  expect(out.startsWith("{")).toBe(true);
  const parsed = JSON.parse(out) as { schema: string; ok: boolean; data: unknown };
  expect(out).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

function sharedFlows(flows: FlowRow[]): Array<{ name: string; steps: string[] }> {
  return flows.map(({ name, steps }) => ({ name, steps }));
}

/** Answer built only from the three JSON documents. Does not read prose. */
function capabilityAnswer(list: ListInfoData, info: ListInfoData, catalog: CatalogData) {
  const tasks = list.tasks;
  const flows = sharedFlows(list.flows);
  if (JSON.stringify(tasks) !== JSON.stringify(info.tasks)) {
    throw new Error("list and info data.tasks differ");
  }
  if (JSON.stringify(flows) !== JSON.stringify(sharedFlows(info.flows))) {
    throw new Error("list and info flow name/steps differ");
  }
  const handlers = catalog.plugins.flatMap((plugin) =>
    plugin.handlers.map((handler) => ({
      namespace: plugin.namespace,
      name: handler.name,
      ...(handler.ai === undefined ? {} : { ai: handler.ai }),
    })),
  );
  return { tasks, flows, handlers };
}

test("C1a: list, info, and ai json answer what the project can do without prose", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-c1a-"));
  writeFileSync(path.join(dir, "bolt.yaml"), YAML);
  writeFileSync(
    path.join(dir, "README.md"),
    `# Ignore me\n\nThe only task is \`${PROSE_ONLY}\`.\n`,
  );
  mkdirSync(path.join(dir, ".bolt"), { recursive: true });
  writeFileSync(
    path.join(dir, ".bolt", "ai-context.md"),
    `# Ignore me\n\nTask \`${CONTEXT_ONLY}\` is the real one.\n`,
  );
  try {
    const listed = await bolt(["list", "--json"], dir);
    const informed = await bolt(["info", "--json"], dir);
    const cataloged = await bolt(["ai", "--json"], dir);
    expect(listed.code, listed.err).toBe(0);
    expect(informed.code, informed.err).toBe(0);
    expect(cataloged.code, cataloged.err).toBe(0);
    expect(existsSync(path.join(dir, ".bolt", "ai-context.md"))).toBe(true);
    expect(readFileSync(path.join(dir, ".bolt", "ai-context.md"), "utf8")).toContain(CONTEXT_ONLY);

    const listBody = parseStdout(listed.out);
    const infoBody = parseStdout(informed.out);
    const aiBody = parseStdout(cataloged.out);
    expect(listBody.schema).toBe("bolt.list/v1");
    expect(infoBody.schema).toBe("bolt.info/v1");
    expect(aiBody.schema).toBe("bolt.catalog/v1");
    expect(listBody.ok).toBe(true);
    expect(infoBody.ok).toBe(true);
    expect(aiBody.ok).toBe(true);

    const list = listBody.data as ListInfoData;
    const info = infoBody.data as ListInfoData;
    const catalog = aiBody.data as CatalogData;
    expect(list.tasks.every((name) => typeof name === "string")).toBe(true);
    expect(info.tasks.every((name) => typeof name === "string")).toBe(true);
    expect(list.flows.find((flow) => flow.name === "daily")?.description).toBe(
      "daily look then ship",
    );
    expect(info.flows.find((flow) => flow.name === "daily")).not.toHaveProperty("description");
    for (const plugin of info.plugins ?? []) {
      expect(plugin).not.toHaveProperty("handlers");
    }

    const answer = capabilityAnswer(list, info, catalog);
    expect(answer.tasks).toEqual(["look", "ship", "die"]);
    expect(answer.flows).toEqual([{ name: "daily", steps: ["look", "ship"] }]);
    expect(answer.tasks).not.toContain(PROSE_ONLY);
    expect(answer.tasks).not.toContain(CONTEXT_ONLY);
    expect(JSON.stringify(answer)).not.toContain(PROSE_ONLY);
    expect(JSON.stringify(answer)).not.toContain(CONTEXT_ONLY);

    const mark = (namespace: string, name: string) =>
      answer.handlers.find((handler) => handler.namespace === namespace && handler.name === name);
    expect(mark("git", "info")).toEqual({ namespace: "git", name: "info", ai: true });
    expect(mark("fs", "mkdir")).toEqual({ namespace: "fs", name: "mkdir", ai: "confirm" });
    expect(mark("ue", "kill")).toBeUndefined();
    for (const handler of answer.handlers) {
      if ("ai" in handler) expect(handler.ai === true || handler.ai === "confirm").toBe(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C1a: skill discovery cites list, info, and ai json fields", () => {
  const skill = readFileSync(SKILL, "utf8");
  const discover = skill.slice(skill.indexOf("1. **Discover.**"), skill.indexOf("2. **Preview.**"));
  expect(discover).toContain("what can this project do");
  expect(discover).toContain("Do not answer it from README prose");
  expect(discover).toContain("`data.tasks`");
  expect(discover).toContain("`data.flows[].name`");
  expect(discover).toContain("`data.flows[].steps`");
  expect(discover).toContain("`data.plugins[].handlers[].name`");
  expect(discover).toContain("`data.plugins[].handlers[].ai`");
  expect(discover).toContain("`bolt.catalog/v1`");
  expect(discover).toContain("`.bolt/ai-context.md`");
  expect(discover).toContain("bolt list --json");
  expect(discover).toContain("bolt info --json");
  expect(discover).toContain("bolt ai --json");
});
