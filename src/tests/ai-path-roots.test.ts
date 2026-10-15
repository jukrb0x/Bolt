import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { Runner } from "../runner";
import type { BoltConfig } from "../config";
import ue from "../plugins/ue";
import { builtinPlugins } from "../plugins";
import { testCfg, testUeConfig } from "./env";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const CONCRETE = /from\s+["'][^"']*plugins\/(ue|fs|json|git|svn)["']/;

function productionSources(): string[] {
  const root = path.join(REPO_ROOT, "src");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (dir === root && (name === "plugins" || name === "tests")) continue;
        walk(full);
        continue;
      }
      if (name.endsWith(".ts")) out.push(full);
    }
  };
  walk(root);
  return out;
}

test("runner drops UE ini special cases and keeps core AI_PATH_RESTRICTED", () => {
  const runner = readFileSync(path.join(REPO_ROOT, "src/runner.ts"), "utf8");
  expect(runner).not.toMatch(/ueConfigSchema|AI_UE_INI|ueProjectRoot/);
  expect(runner).not.toMatch(CONCRETE);
  expect(runner).toMatch(/\.aiPathRoots\b/);
  expect(runner).toContain('["git/info", ["path"]]');
  expect(runner).toContain('["svn/info", ["path"]]');
  expect(runner).toContain('["fs/copy", ["src", "dst"]]');
  expect(runner).toContain('["json/set", ["file"]]');
});

test("only the builtins index imports concrete plugins and exports BoltPlugin[]", () => {
  const hits = productionSources().filter((file) => CONCRETE.test(readFileSync(file, "utf8")));
  expect(hits).toEqual([]);
  const index = readFileSync(path.join(REPO_ROOT, "src/plugins/index.ts"), "utf8");
  for (const name of ["ue", "fs", "json", "git", "svn"]) {
    expect(index).toMatch(new RegExp(`from ["']\\./${name}["']`));
  }
  expect(index).toMatch(/:\s*readonly BoltPlugin\[\]/);
  expect(Array.isArray(builtinPlugins)).toBe(true);
  expect(builtinPlugins.map((plugin) => plugin.namespace)).toEqual([
    "git",
    "svn",
    "ue",
    "fs",
    "json",
  ]);
});

test("ue aiPathRoots resolves project.path and fails closed when it is missing", () => {
  const relative = ue.aiPathRoots?.({
    cfg: {
      ...testCfg,
      plugins: [
        {
          namespace: "ue",
          config: { ...testUeConfig, project: { path: "game", vcs: "svn" } },
        },
      ],
    },
    configDir: "/tmp/bolt",
  });
  expect(relative).toEqual([
    {
      refs: ["ue/ini_get", "ue/ini_read_all"],
      params: ["file"],
      root: path.resolve("/tmp/bolt", "game"),
      label: "UE project directory",
    },
  ]);

  const absolute = ue.aiPathRoots?.({
    cfg: {
      ...testCfg,
      plugins: [
        {
          namespace: "ue",
          config: { ...testUeConfig, project: { path: "/var/game", vcs: "svn" } },
        },
      ],
    },
    configDir: "/tmp/bolt",
  });
  expect(absolute?.[0]?.root).toBe("/var/game");

  const missing = ue.aiPathRoots?.({
    cfg: { ...testCfg, plugins: [] },
    configDir: "/tmp/bolt",
  });
  expect(missing).toEqual([
    {
      refs: ["ue/ini_get", "ue/ini_read_all"],
      params: ["file"],
      root: "",
      label: "UE project directory",
    },
  ]);
});

test("AI ue/ini_get with no project.path is AI_FORBIDDEN", async () => {
  const cfg: BoltConfig = {
    ...testCfg,
    plugins: [],
    tasks: {
      read: [{ uses: "ue/ini_get", with: { file: "x.ini", section: "S", key: "K" } }],
    },
  };
  await expect(
    new Runner(cfg, { aiInvocation: true, configDir: "/tmp/bolt" }).runTask("read"),
  ).rejects.toMatchObject({
    code: "AI_FORBIDDEN",
    message: expect.stringMatching(/cannot be verified to be inside the UE project directory/),
  });
});

test("a plugin aiPathRoots label confines AI runs, is cached, and does not confine humans", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-path-roots-"));
  const box = path.join(dir, "box");
  const count = path.join(dir, "count.txt");
  mkdirSync(box);
  writeFileSync(path.join(box, "note.txt"), "ok");
  writeFileSync(
    path.join(dir, "probe.js"),
    `import { appendFileSync } from "fs";
export default {
  namespace: "probe",
  apiVersion: 2,
  handlers: { read: async () => {} },
  aiPathRoots() {
    appendFileSync(${JSON.stringify(count)}, "x");
    return [{ refs: ["probe/read"], params: ["file"], root: ${JSON.stringify(box)}, label: "probe box" }];
  },
};
`,
  );
  const cfg = (file: string): BoltConfig => ({
    ...testCfg,
    plugins: [{ namespace: "probe", path: "./probe.js" }],
    tasks: {
      once: [{ uses: "probe/read", with: { file } }],
      twice: [
        { uses: "probe/read", with: { file: "note.txt" } },
        { uses: "probe/read", with: { file: "note.txt" } },
      ],
    },
  });
  try {
    await expect(
      new Runner(cfg("../outside.txt"), { aiInvocation: true, configDir: dir }).runTask("once"),
    ).rejects.toMatchObject({
      code: "AI_FORBIDDEN",
      message: expect.stringMatching(/probe box/),
    });
    await expect(
      new Runner(cfg("note.txt"), { aiInvocation: true, configDir: dir }).runTask("twice"),
    ).resolves.toBeUndefined();
    await expect(
      new Runner(cfg("../outside.txt"), { configDir: dir }).runTask("once"),
    ).resolves.toBeUndefined();
    expect(readFileSync(count, "utf8")).toBe("xx");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
