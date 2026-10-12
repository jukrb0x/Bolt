import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { repoRoot } from "./harness";

function binarySpec(): { target: string; outfile: string } {
  if (process.platform === "win32") {
    return { target: "bun-windows-x64", outfile: "build/plugin-runtime-e2e/bolt.exe" };
  }
  if (process.platform === "darwin") {
    const target = process.arch === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64";
    return { target, outfile: "build/plugin-runtime-e2e/bolt" };
  }
  return { target: "bun-linux-x64", outfile: "build/plugin-runtime-e2e/bolt" };
}

test(
  "compiled binary runs a class plugin @handler",
  async () => {
    const { target, outfile } = binarySpec();
    const absOut = path.join(repoRoot, outfile);
    const build = Bun.spawn(["bun", "run", "scripts/build-binary.ts", target, outfile], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildOut, buildErr, buildCode] = await Promise.all([
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
      build.exited,
    ]);
    expect(buildCode, `${buildOut}\n${buildErr}`).toBe(0);

    const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-handler-e2e-"));
    const outFile = path.join(dir, "out.json");
    try {
      writeFileSync(
        path.join(dir, "bolt.yaml"),
        [
          "version: 1",
          "project:",
          "  name: Decor",
          "plugins:",
          "  - namespace: decor",
          "    path: ./plugin.ts",
          "tasks:",
          "  ping:",
          "    - uses: decor/ping",
          "      with:",
          '        n: "2"',
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(dir, "plugin.ts"),
        [
          'import { writeFileSync } from "fs";',
          'import { handler, PluginBase } from "boltstack";',
          'import { z } from "zod";',
          "",
          "class Decor extends PluginBase {",
          '  namespace = "decor";',
          "",
          "  @handler({",
          '    description: "ping",',
          "    params: z.object({ n: z.coerce.number() }),",
          "  })",
          "  async ping(params: { n: number }) {",
          `    writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(params));`,
          "  }",
          "}",
          "",
          "export default Decor;",
          "",
        ].join("\n"),
      );

      const run = Bun.spawn([absOut, "run", "ping"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(run.stdout).text(),
        new Response(run.stderr).text(),
        run.exited,
      ]);
      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
      expect(JSON.parse(readFileSync(outFile, "utf8"))).toEqual({ n: 2 });

      const list = Bun.spawn([absOut, "plugin", "list"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [listOut, listErr, listCode] = await Promise.all([
        new Response(list.stdout).text(),
        new Response(list.stderr).text(),
        list.exited,
      ]);
      expect(listCode, `${listOut}\n${listErr}`).toBe(0);
      expect(listOut.replace(/\u001b\[[0-9;]*m/g, "")).toContain("decor/ping");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  { timeout: 600_000 },
);
