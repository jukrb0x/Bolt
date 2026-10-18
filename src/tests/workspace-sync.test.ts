import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { loadConfig } from "../config";

const REPO = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO, "src/main.ts");

const YAML = `version: 1
project:
  name: Demo
workspace:
  roots:
    - id: engine
      path: ./engine
      role: engine
      vcs: git
    - id: game
      path: ./game
      role: project
      vcs: svn
`;

function tempProject(yaml: string, extra?: (dir: string) => void): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-a1c-"));
  writeFileSync(path.join(dir, "bolt.yaml"), yaml);
  extra?.(dir);
  return dir;
}

function bolt(argv: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  const home = path.join(cwd, ".empty-home");
  mkdirSync(home, { recursive: true });
  const proc = Bun.spawn(
    ["bun", "--tsconfig-override", path.join(REPO, "tsconfig.json"), MAIN, ...argv],
    {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([out, err, code]) => ({ code, out, err }));
}

test("bolt.local.yaml cannot override a workspace path", async () => {
  const dir = tempProject(YAML, (root) => {
    writeFileSync(path.join(root, "bolt.local.yaml"), "workspace:\n  roots: []\n");
  });
  try {
    await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(/bolt\.local\.yaml/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bolt workspace sync is an unknown command", async () => {
  const dir = tempProject(YAML);
  try {
    for (const argv of [
      ["workspace", "sync"],
      ["workspace", "sync", "--dry-run"],
      ["workspace", "sync", "--json"],
      ["workspace", "sync", "--dry-run", "--json"],
    ]) {
      const run = await bolt(argv, dir);
      expect(run.code).toBe(2);
      const text = `${run.out}\n${run.err}`;
      expect(text).toContain('Unknown command "workspace"');
      expect(text).not.toContain("plan");
      expect(text).not.toContain("target_rev");
      expect(text).not.toContain("will_touch");
      expect(text).not.toContain("bolt.workspace.sync");
      expect(text).not.toContain("sync_policy");
    }
    const help = await bolt(["--help"], dir);
    expect(help.code).toBe(0);
    expect(help.out).not.toContain("workspace sync");
    expect(help.out).not.toMatch(/^\s+workspace\s/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
