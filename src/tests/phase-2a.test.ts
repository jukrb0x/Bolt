import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO_ROOT, "src/main.ts");

function parseStdout(out: string): Record<string, unknown> {
  expect(out.trim().startsWith("{")).toBe(true);
  return JSON.parse(out) as Record<string, unknown>;
}

async function bolt(
  argv: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", MAIN, ...argv], {
    cwd,
    env: { ...process.env, ...env, BOLT_AGENT: env.BOLT_AGENT ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

function writePlugin(dir: string, body: string, file = "index.ts") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), body);
}

function project(dir: string, tasks: string, local = "") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    `version: 1\nproject:\n  name: Demo\n${tasks.endsWith("\n") ? tasks : `${tasks}\n`}`,
  );
  if (local)
    writeFileSync(path.join(dir, "bolt.local.yaml"), local.endsWith("\n") ? local : `${local}\n`);
}

function truePlugin(top: string, ran: string): string {
  return `import { defineHandler, definePlugin } from "boltstack";
import { writeFileSync } from "fs";
writeFileSync(${JSON.stringify(top)}, "top\\n");
export default definePlugin({
  namespace: "demo",
  version: "1",
  description: "demo",
  handlers: {
    go: defineHandler({ ai: true, description: "go" }, async () => {
      writeFileSync(${JSON.stringify(ran)}, "ran\\n");
    }),
  },
});
`;
}

test("version --json appends agent and execute", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-2a-ver-"));
  try {
    const run = await bolt(["version", "--json"], dir);
    expect(run.code).toBe(0);
    const info = JSON.parse(run.out) as { capabilities: string[] };
    expect(info.capabilities.slice(-2)).toEqual(["agent", "execute"]);
    expect(info.capabilities).toContain("plugin-manifest");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("implied agent flags preview or refuse without executing", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-2a-flags-"));
  const marker = path.join(dir, "ran.txt");
  project(dir, "tasks:\n  hi:\n    - run: echo hi > ran.txt\n  die:\n    - uses: ue/kill\n");
  const env = { HOME: path.join(dir, "home"), USERPROFILE: path.join(dir, "home") };
  try {
    const preview = await bolt(["run", "--dry-run", "hi", "--json"], dir, env);
    expect(preview.code).toBe(0);
    const body = parseStdout(preview.out);
    expect(body.schema).toBe("bolt.run/v1");
    expect(body.ok).toBe(true);
    const data = body.data as {
      preview: boolean;
      plan_hash: string;
      ai: string;
      plan: { plan_hash: string };
    };
    expect(data.preview).toBe(true);
    expect(data.ai).toBe("confirm");
    expect(data.plan.plan_hash).toBe(data.plan_hash);
    expect(existsSync(marker)).toBe(false);

    const implied = await bolt(["run", "hi", "--execute", "--plan=deadbeef"], dir, env);
    expect(implied.code).toBe(4);
    const refused = parseStdout(implied.out);
    expect(refused.schema).toBe("bolt.run/v1");
    expect((refused.errors as Array<{ code: string }>)[0].code).toBe("PLAN_MISMATCH");
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(path.join(dir, ".bolt", "logs"))).toBe(false);

    const agentEnv = await bolt(["run", "hi"], dir, { ...env, BOLT_AGENT: "1 " });
    expect(agentEnv.code).toBe(0);
    expect(parseStdout(agentEnv.out).schema).toBe("bolt.run/v1");
    expect((parseStdout(agentEnv.out).data as { preview: boolean }).preview).toBe(true);
    expect(existsSync(marker)).toBe(false);

    const needsPlan = await bolt(["run", "hi", "--execute"], dir, env);
    expect(needsPlan.code).toBe(2);
    expect((parseStdout(needsPlan.out).errors as Array<{ code: string }>)[0].code).toBe("USAGE");

    const barePlan = await bolt(["run", "hi", "--plan"], dir, env);
    expect(barePlan.code).toBe(2);
    expect(barePlan.out.trim().startsWith("{")).toBe(true);
    expect((parseStdout(barePlan.out).errors as Array<{ code: string }>)[0].code).toBe("USAGE");
    expect(barePlan.err).not.toContain("reserved by bolt");

    const both = await bolt(["run", "--dry-run", "hi", "--execute", "--plan=abc"], dir, env);
    expect(both.code).toBe(2);

    const sim = await bolt(["run", "hi", "--simulate", "--agent"], dir, env);
    expect(sim.code).toBe(2);
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stage 1 refusals do not import, in the required order", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-2a-stage1-"));
  const home = path.join(dir, "home");
  const env = { HOME: home, USERPROFILE: home };
  const pluginDir = path.join(dir, ".bolt", "plugins", "demo");
  const top = path.join(dir, "top.txt");
  const ran = path.join(dir, "ran.txt");
  writePlugin(pluginDir, truePlugin(top, ran));
  project(
    dir,
    "tasks:\n  go:\n    - uses: demo/go\n  die:\n    - uses: ue/kill\n  hi:\n    - run: echo hi > ran.txt\n",
  );
  try {
    const unbuilt = await bolt(["run", "go", "--execute", "--plan=00", "--json"], dir, env);
    expect(unbuilt.code).toBe(4);
    expect((parseStdout(unbuilt.out).errors as Array<{ code: string }>)[0].code).toBe(
      "PLUGIN_NOT_BUILT",
    );
    expect(existsSync(top)).toBe(false);

    const built = await bolt(["plugin", "build", "demo"], dir, env);
    expect(built.code).toBe(0);
    rmSync(top, { force: true });

    const artRoot = path.join(dir, ".bolt", ".cache", "plugins", "demo", "artefacts");
    const hash = readdirSync(artRoot)[0];
    const artefact = path.join(artRoot, hash, "index.js");
    const original = readFileSync(artefact);
    const flipped = Buffer.from(original);
    flipped[0] = flipped[0] === 0x61 ? 0x62 : 0x61;
    writeFileSync(artefact, flipped);
    writeFileSync(
      path.join(dir, "bolt.local.yaml"),
      "ai:\n  run: never\n  trust_plugins: [demo]\n",
    );
    const tampered = await bolt(
      ["run", "go", "--execute", "--plan=00", "--agent", "--json"],
      dir,
      env,
    );
    expect(tampered.code).toBe(4);
    const tamperedBody = parseStdout(tampered.out);
    expect((tamperedBody.errors as Array<{ code: string }>)[0].code).toBe("PLAN_MISMATCH");
    const reasons = (tamperedBody.data as { ai_reasons: Array<{ code?: string }> }).ai_reasons;
    expect(reasons.some((reason) => reason.code === "ARTEFACT_TAMPERED")).toBe(true);
    expect(existsSync(top)).toBe(false);
    writeFileSync(artefact, original);

    const never = await bolt(["run", "go", "--execute", "--plan=00", "--json"], dir, env);
    expect(never.code).toBe(4);
    expect((parseStdout(never.out).errors as Array<{ code: string }>)[0].code).toBe(
      "AGENT_EXECUTION_DISABLED",
    );
    expect(existsSync(top)).toBe(false);

    writeFileSync(path.join(dir, "bolt.local.yaml"), "ai:\n  trust_plugins: [demo]\n");
    const mismatch = await bolt(["run", "die", "--execute", "--plan=00", "--json"], dir, env);
    expect(mismatch.code).toBe(4);
    expect((parseStdout(mismatch.out).errors as Array<{ code: string }>)[0].code).toBe(
      "PLAN_MISMATCH",
    );

    const die = parseStdout(
      (await bolt(["run", "--dry-run", "die", "--agent", "--json"], dir, env)).out,
    );
    const dieHash = (die.data as { plan_hash: string }).plan_hash;
    const forbidden = await bolt(
      ["run", "die", "--execute", `--plan=${dieHash}`, "--confirmed-by-user", "--json"],
      dir,
      env,
    );
    expect(forbidden.code).toBe(4);
    expect((parseStdout(forbidden.out).errors as Array<{ code: string }>)[0].code).toBe(
      "AI_FORBIDDEN",
    );

    const hi = parseStdout(
      (await bolt(["run", "--dry-run", "hi", "--agent", "--json"], dir, env)).out,
    );
    const hiHash = (hi.data as { plan_hash: string }).plan_hash;
    const confirm = await bolt(["run", "hi", "--execute", `--plan=${hiHash}`, "--json"], dir, env);
    expect(confirm.code).toBe(4);
    expect((parseStdout(confirm.out).errors as Array<{ code: string }>)[0].code).toBe(
      "CONFIRM_REQUIRED",
    );
    expect(existsSync(ran)).toBe(false);

    const yes = await bolt(
      ["run", "hi", "--execute", `--plan=${hiHash}`, "--confirmed-by-user", "--json"],
      dir,
      env,
    );
    expect(yes.code).toBe(0);
    expect((parseStdout(yes.out).data as { outcome: string }).outcome).toBe("ok");
    expect(existsSync(ran)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("true-mode execute runs the handler and skips a non-participating plugin", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-2a-true-"));
  const home = path.join(dir, "home");
  const env = { HOME: home, USERPROFILE: home };
  const top = path.join(dir, "top.txt");
  const ran = path.join(dir, "ran.txt");
  const extra = path.join(dir, "extra.txt");
  writePlugin(path.join(dir, ".bolt", "plugins", "demo"), truePlugin(top, ran));
  writePlugin(
    path.join(dir, ".bolt", "plugins", "extra"),
    `const fs = require("fs");\nfs.writeFileSync(${JSON.stringify(extra)}, "extra\\n");\nmodule.exports = { namespace: "extra", handlers: { go: async () => {} } };\n`,
    "index.js",
  );
  writePlugin(
    path.join(home, ".bolt", "plugins", "userx"),
    `const fs = require("fs");\nfs.writeFileSync(${JSON.stringify(path.join(dir, "user.txt"))}, "user\\n");\nmodule.exports = { namespace: "userx", handlers: { go: async () => {} } };\n`,
    "index.js",
  );
  project(dir, "tasks:\n  go:\n    - uses: demo/go\n", "ai:\n  trust_plugins: [demo]\n");
  try {
    expect((await bolt(["plugin", "build", "demo"], dir, env)).code).toBe(0);
    rmSync(top, { force: true });
    const preview = parseStdout(
      (await bolt(["run", "--dry-run", "go", "--agent", "--json"], dir, env)).out,
    );
    expect((preview.data as { ai: boolean | string }).ai).toBe(true);
    const hash = (preview.data as { plan_hash: string }).plan_hash;
    const run = await bolt(["run", "go", "--execute", `--plan=${hash}`, "--json"], dir, env);
    expect(run.code).toBe(0);
    expect(run.out).not.toContain(top);
    const data = parseStdout(run.out).data as {
      preview: boolean;
      outcome: string;
      plan_hash: string;
    };
    expect(data.preview).toBe(false);
    expect(data.outcome).toBe("ok");
    expect(data.plan_hash).toBe(hash);
    expect(readFileSync(ran, "utf8")).toBe("ran\n");
    expect(existsSync(top)).toBe(true);
    expect(existsSync(extra)).toBe(false);
    expect(existsSync(path.join(dir, "user.txt"))).toBe(false);
    expect(existsSync(path.join(dir, ".bolt", ".cache", "plugins", "extra"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stage 2 divergence refuses before onInit and does not hide constructor", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-2a-div-"));
  const home = path.join(dir, "home");
  const env = { HOME: home, USERPROFILE: home };
  const top = path.join(dir, "top.txt");
  const ctor = path.join(dir, "ctor.txt");
  const init = path.join(dir, "init.txt");
  const ran = path.join(dir, "ran.txt");
  writePlugin(
    path.join(dir, ".bolt", "plugins", "demo"),
    `import { PluginBase, handler } from "boltstack";
import { writeFileSync } from "fs";
writeFileSync(${JSON.stringify(top)}, "top\\n");
export default class Demo extends PluginBase {
  namespace = "demo";
  version = "1";
  description = "demo";
  constructor() {
    super();
    writeFileSync(${JSON.stringify(ctor)}, "ctor\\n");
  }
  async onInit() {
    writeFileSync(${JSON.stringify(init)}, "init\\n");
  }
  @handler({ ai: false, description: "go" })
  async go() {
    writeFileSync(${JSON.stringify(ran)}, "ran\\n");
  }
}
`,
  );
  project(dir, "tasks:\n  go:\n    - uses: demo/go\n", "ai:\n  trust_plugins: [demo]\n");
  try {
    expect((await bolt(["plugin", "build", "demo"], dir, env)).code).toBe(0);
    for (const file of [top, ctor, init, ran]) rmSync(file, { force: true });
    const manDir = path.join(dir, ".bolt", ".cache", "plugins", "demo", "manifests");
    const manFile = path.join(manDir, readdirSync(manDir)[0]);
    const manifest = JSON.parse(readFileSync(manFile, "utf8")) as {
      handlers: { go: { ai: boolean | string } };
    };
    manifest.handlers.go.ai = true;
    writeFileSync(manFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const preview = parseStdout(
      (await bolt(["run", "--dry-run", "go", "--agent", "--json"], dir, env)).out,
    );
    expect((preview.data as { ai: boolean | string }).ai).toBe(true);
    const hash = (preview.data as { plan_hash: string }).plan_hash;
    const run = await bolt(["run", "go", "--execute", `--plan=${hash}`, "--json"], dir, env);
    expect(run.code).toBe(4);
    expect((parseStdout(run.out).errors as Array<{ code: string }>)[0].code).toBe("PLAN_MISMATCH");
    expect(existsSync(top)).toBe(true);
    expect(existsSync(ctor)).toBe(true);
    expect(existsSync(init)).toBe(false);
    expect(existsSync(ran)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-builtin true handler is capped unless trusted, and shadowing stays false", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-2a-cap-"));
  const home = path.join(dir, "home");
  const env = { HOME: home, USERPROFILE: home };
  writePlugin(
    path.join(dir, ".bolt", "plugins", "demo"),
    truePlugin(path.join(dir, "top.txt"), path.join(dir, "ran.txt")),
  );
  writePlugin(
    path.join(dir, ".bolt", "plugins", "git"),
    `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: "git",
  version: "1",
  description: "shadows the built-in git plugin",
  handlers: { info: defineHandler({ ai: true, description: "shadow" }, async () => {}) },
});
`,
  );
  project(dir, "tasks:\n  go:\n    - uses: demo/go\n  info:\n    - uses: git/info\n");
  try {
    expect((await bolt(["plugin", "build", "demo", "git"], dir, env)).code).toBe(0);
    const capped = parseStdout((await bolt(["inspect", "go", "--json"], dir, env)).out);
    expect((capped.data as { ai: string }).ai).toBe("confirm");
    writeFileSync(path.join(dir, "bolt.local.yaml"), "ai:\n  trust_plugins: [demo, git]\n");
    const trusted = parseStdout((await bolt(["inspect", "go", "--json"], dir, env)).out);
    expect((trusted.data as { ai: boolean | string }).ai).toBe(true);
    const shadow = parseStdout((await bolt(["inspect", "info", "--json"], dir, env)).out);
    expect((shadow.data as { ai: boolean }).ai).toBe(false);
    const warnings = shadow.warnings as Array<{ code: string }>;
    expect(warnings.some((item) => item.code === "PLUGIN_SHADOWS_BUILTIN")).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("changing only continue_on_fail changes plan_hash and refuses the old hash", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-2a-cof-"));
  const home = path.join(dir, "home");
  const env = { HOME: home, USERPROFILE: home };
  project(
    dir,
    "tasks:\n  a:\n    - run: echo a\n  b:\n    - run: echo b\nflows:\n  go:\n    steps: [a, b]\n",
  );
  try {
    const first = parseStdout(
      (await bolt(["run", "--dry-run", "go", "--agent", "--json"], dir, env)).out,
    );
    const hash = (first.data as { plan_hash: string }).plan_hash;
    writeFileSync(
      path.join(dir, "bolt.yaml"),
      "version: 1\nproject:\n  name: Demo\ntasks:\n  a:\n    - run: echo a\n  b:\n    - run: echo b\nflows:\n  go:\n    steps: [a, b]\n    continue_on_fail: [a]\n",
    );
    const second = parseStdout(
      (await bolt(["run", "--dry-run", "go", "--agent", "--json"], dir, env)).out,
    );
    const next = (second.data as { plan_hash: string }).plan_hash;
    expect(next).not.toBe(hash);
    const run = await bolt(
      ["run", "go", "--execute", `--plan=${hash}`, "--confirmed-by-user", "--json"],
      dir,
      env,
    );
    expect(run.code).toBe(4);
    expect((parseStdout(run.out).errors as Array<{ code: string }>)[0].code).toBe("PLAN_MISMATCH");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("swapping a capability mapping changes plan_hash", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-2a-capmap-"));
  const home = path.join(dir, "home");
  const env = { HOME: home, USERPROFILE: home };
  const alpha = path.join(dir, "alpha.txt");
  const beta = path.join(dir, "beta.txt");
  writePlugin(
    path.join(dir, ".bolt", "plugins", "demo"),
    `import { defineHandler, definePlugin } from "boltstack";
import { writeFileSync } from "fs";
export default definePlugin({
  namespace: "demo",
  version: "1",
  description: "two true handlers",
  apiVersion: 2,
  handlers: {
    alpha: defineHandler({ ai: true, capability: "demo.pick", description: "alpha" }, async () => {
      writeFileSync(${JSON.stringify(alpha)}, "alpha\\n");
    }),
    beta: defineHandler({ ai: true, capability: "demo.pick", description: "beta" }, async () => {
      writeFileSync(${JSON.stringify(beta)}, "beta\\n");
    }),
  },
});
`,
  );
  project(
    dir,
    "capabilities:\n  demo.pick: demo/alpha\ntasks:\n  go:\n    - uses: demo.pick\n",
    "ai:\n  trust_plugins: [demo]\n",
  );
  try {
    expect((await bolt(["plugin", "build", "demo"], dir, env)).code).toBe(0);
    const first = parseStdout(
      (await bolt(["run", "--dry-run", "go", "--agent", "--json"], dir, env)).out,
    );
    expect((first.data as { ai: boolean | string }).ai).toBe(true);
    const hash = (first.data as { plan_hash: string }).plan_hash;
    writeFileSync(
      path.join(dir, "bolt.local.yaml"),
      "ai:\n  trust_plugins: [demo]\ncapabilities:\n  demo.pick: demo/beta\n",
    );
    const second = parseStdout(
      (await bolt(["run", "--dry-run", "go", "--agent", "--json"], dir, env)).out,
    );
    const next = (second.data as { plan_hash: string }).plan_hash;
    expect(next).not.toBe(hash);
    const stale = await bolt(["run", "go", "--execute", `--plan=${hash}`, "--json"], dir, env);
    expect(stale.code).toBe(4);
    expect((parseStdout(stale.out).errors as Array<{ code: string }>)[0].code).toBe(
      "PLAN_MISMATCH",
    );
    expect(existsSync(alpha)).toBe(false);
    expect(existsSync(beta)).toBe(false);
    const fresh = await bolt(["run", "go", "--execute", `--plan=${next}`, "--json"], dir, env);
    expect(fresh.code).toBe(0);
    expect(existsSync(beta)).toBe(true);
    expect(existsSync(alpha)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
