import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { checkConfig, loadConfig } from "../config";
import ue from "../plugins/ue";
import svn from "../plugins/svn";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO_ROOT, "src/main.ts");

function writeProject(yaml: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-hooks-"));
  writeFileSync(path.join(dir, "bolt.yaml"), yaml.endsWith("\n") ? yaml : `${yaml}\n`);
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

function project(body: string): string {
  return `version: 1\nproject:\n  name: Demo\n${body}`;
}

async function bolt(
  argv: string[],
  cwd: string,
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", MAIN, ...argv], {
    cwd,
    env: { ...process.env, BOLT_AGENT: "" },
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

test("ue and svn declare plugin API v2", () => {
  expect(ue.apiVersion).toBe(2);
  expect(svn.apiVersion).toBe(2);
});

test("core config validation does not special-case ue or svn metadata", () => {
  const src = readFileSync(path.join(REPO_ROOT, "src/config.ts"), "utf8");
  expect(src).not.toMatch(/ueMetadataErrors|svnMetadataErrors|tasksReferenceUe/);
  expect(src).not.toMatch(/from ["']\.\/plugins\/ue["']/);
  expect(src).not.toMatch(/from ["']\.\/plugins\/svn["']/);
});

test("bolt init, ai-context, and the runner do not call the reserved hooks", () => {
  expect(readFileSync(path.join(REPO_ROOT, "src/commands/init.ts"), "utf8")).not.toMatch(
    /initDetect/,
  );
  expect(readFileSync(path.join(REPO_ROOT, "src/ai-context.ts"), "utf8")).not.toMatch(
    /\.aiContext\b/,
  );
  expect(readFileSync(path.join(REPO_ROOT, "src/runner.ts"), "utf8")).not.toMatch(
    /\.aiPathRoots\b/,
  );
});

test("a config with no plugin entries still loads", async () => {
  const dir = writeProject(project("tasks:\n  hi:\n    - run: echo hi\n"));
  try {
    const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
    expect(cfg.project.name).toBe("Demo");
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a registered builtin without a yaml entry is not a generic required error", async () => {
  const dir = writeProject(
    project("tasks:\n  info:\n    - uses: git/info\n      with: { path: . }\n"),
  );
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(true);
    expect(result.errors.some((e) => e.code === "CONFIG_PLUGIN_REQUIRED")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an svn entry with no config still passes", async () => {
  const dir = writeProject(project("plugins:\n  - namespace: svn\n"));
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid metadata on any loaded plugin is CONFIG_PLUGIN_INVALID", async () => {
  const dir = writeProject(
    project("plugins:\n  - namespace: custom\n    path: ./custom.js\n    config: { host: 1 }\n"),
    {
      "custom.js": `export default {
  namespace: "custom",
  apiVersion: 2,
  metadata: {
    safeParse(data) {
      if (data && typeof data.host === "string") return { success: true, data };
      return {
        success: false,
        error: { issues: [{ path: ["host"], message: "Expected string, received number" }] },
      };
    },
  },
  handlers: { go: async () => {} },
};
`,
    },
  );
  try {
    const configPath = path.join(dir, "bolt.yaml");
    const result = await checkConfig(configPath);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      path: "plugins.custom.config.host",
      message: "Expected string, received number",
      code: "CONFIG_PLUGIN_INVALID",
    });
    await expect(loadConfig(configPath)).rejects.toThrow(/CONFIG_PLUGIN_INVALID/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a plugin API v1 plugin is still loaded and its metadata is checked", async () => {
  const dir = writeProject(
    project("plugins:\n  - namespace: v1\n    path: ./v1.js\n    config: {}\n"),
    {
      "v1.js": `export default {
  namespace: "v1",
  handlers: { go: async () => {} },
  metadata: {
    safeParse() {
      return { success: false, error: { issues: [{ path: ["host"], message: "Required" }] } };
    },
  },
};
`,
    },
  );
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      path: "plugins.v1.config.host",
      message: "Required",
      code: "CONFIG_PLUGIN_INVALID",
    });
    expect(result.warnings).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a plugin API v1 plugin with no hooks does not warn", async () => {
  const dir = writeProject(
    project("plugins:\n  - namespace: v1\n    path: ./v1.js\ntasks:\n  go:\n    - uses: v1/go\n"),
    {
      "v1.js": `export default {
  namespace: "v1",
  handlers: { go: async () => {} },
};
`,
    },
  );
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid ue metadata is CONFIG_PLUGIN_INVALID and does not use a ue-only code path", async () => {
  const dir = writeProject(
    project(`plugins:
  - namespace: ue
    config:
      engine: { path: e }
      project: { path: p }
      uproject: p.uproject
      targets:
        editor: { kind: invalid_kind }
`),
  );
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.code === "CONFIG_PLUGIN_INVALID" && e.path.includes("kind")),
    ).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid svn metadata is CONFIG_PLUGIN_INVALID", async () => {
  const dir = writeProject(
    project('plugins:\n  - namespace: svn\n    config: { use_tortoise: "yes" }\n'),
  );
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "CONFIG_PLUGIN_INVALID" && e.path.includes("use_tortoise"),
      ),
    ).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tasks that use ue/ without a ue entry are CONFIG_PLUGIN_REQUIRED with the engine hint", async () => {
  const dir = writeProject(project("tasks:\n  build:\n    - uses: ue/build\n"));
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "CONFIG_PLUGIN_INVALID")).toBe(false);
    expect(result.errors).toContainEqual({
      path: "plugins.ue",
      message: "ue metadata is required when a task uses a ue/ handler",
      code: "CONFIG_PLUGIN_REQUIRED",
      hint: "Add plugins: [{ namespace: ue, config: { engine, project, uproject } }]",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unregistered namespace is a generic CONFIG_PLUGIN_REQUIRED", async () => {
  const dir = writeProject(
    project(
      "tasks:\n  go:\n    - uses: nope/foo\n    - uses: nope/bar\n    - uses: ./actions/local\n",
    ),
  );
  try {
    const configPath = path.join(dir, "bolt.yaml");
    const result = await checkConfig(configPath);
    expect(result.errors).toEqual([
      {
        path: "plugins.nope",
        message: 'tasks use "nope/…" but plugin "nope" is not registered',
        code: "CONFIG_PLUGIN_REQUIRED",
        hint: 'Add a plugins entry for "nope" or install the plugin.',
      },
    ]);
    await expect(loadConfig(configPath)).rejects.toThrow(/CONFIG_PLUGIN_REQUIRED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ue and an unregistered namespace get different required hints", async () => {
  const dir = writeProject(project("tasks:\n  go:\n    - uses: ue/build\n    - uses: nope/foo\n"));
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    const ueIssue = result.errors.find((e) => e.path === "plugins.ue");
    const nope = result.errors.find((e) => e.path === "plugins.nope");
    expect(ueIssue?.hint).toBe(
      "Add plugins: [{ namespace: ue, config: { engine, project, uproject } }]",
    );
    expect(nope?.hint).toBe('Add a plugins entry for "nope" or install the plugin.');
    expect(ueIssue?.hint).not.toContain('Add a plugins entry for "ue"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateConfig receives present, config, tasks, and configPath", async () => {
  const dir = writeProject(
    project(`plugins:
  - namespace: spy
    path: ./spy.js
    config: { host: example }
tasks:
  build:
    - uses: spy/go
`),
    {
      "spy.js": "",
    },
  );
  const spyFile = path.join(dir, "spy-out.json");
  writeFileSync(
    path.join(dir, "spy.js"),
    `import { writeFileSync } from "fs";
export default {
  namespace: "spy",
  apiVersion: 2,
  handlers: { go: async () => {} },
  validateConfig(input) {
    writeFileSync(${JSON.stringify(spyFile)}, JSON.stringify({
      namespace: input.namespace,
      present: input.present,
      config: input.config,
      tasks: input.tasks,
      configPath: input.configPath,
    }));
    return [];
  },
};
`,
  );
  try {
    const configPath = path.join(dir, "bolt.yaml");
    const result = await checkConfig(configPath);
    expect(result.ok).toBe(true);
    const seen = JSON.parse(readFileSync(spyFile, "utf8")) as {
      namespace: string;
      present: boolean;
      config: unknown;
      tasks: Record<string, unknown>;
      configPath: string;
    };
    expect(seen).toEqual({
      namespace: "spy",
      present: true,
      config: { host: "example" },
      tasks: { build: [{ uses: "spy/go" }] },
      configPath,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a present plugin with no config object passes config undefined", async () => {
  const dir = writeProject(project("plugins:\n  - namespace: spy\n    path: ./spy.js\n"), {
    "spy.js": "",
  });
  const spyFile = path.join(dir, "spy-out.json");
  writeFileSync(
    path.join(dir, "spy.js"),
    `import { writeFileSync } from "fs";
export default {
  namespace: "spy",
  apiVersion: 2,
  handlers: { go: async () => {} },
  validateConfig(input) {
    writeFileSync(${JSON.stringify(spyFile)}, JSON.stringify({
      present: input.present,
      config: input.config === undefined ? null : input.config,
      omitted: input.config === undefined,
    }));
    return [];
  },
};
`,
  );
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(spyFile, "utf8"))).toEqual({
      present: true,
      config: null,
      omitted: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hooks run when the method exists even if apiVersion is not 2, and bolt check warns", async () => {
  const dir = writeProject(project("plugins:\n  - namespace: old\n    path: ./old.js\n"), {
    "old.js": `export default {
  namespace: "old",
  apiVersion: 1,
  handlers: { go: async () => {} },
  validateConfig() {
    return [{ path: "plugins.old", message: "from hook", code: "CONFIG_PLUGIN_REQUIRED", hint: "upgrade" }];
  },
};
`,
  });
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.errors).toContainEqual({
      path: "plugins.old",
      message: "from hook",
      code: "CONFIG_PLUGIN_REQUIRED",
      hint: "upgrade",
    });
    expect(result.warnings).toEqual(["Set apiVersion = 2 on plugin old"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a hook that does not return ConfigIssue[] is CONFIG_PLUGIN_HOOK", async () => {
  const dir = writeProject(project("plugins:\n  - namespace: bad\n    path: ./bad.js\n"), {
    "bad.js": `export default {
  namespace: "bad",
  apiVersion: 2,
  handlers: { go: async () => {} },
  validateConfig() {
    return { path: "plugins.bad", message: "not an array" };
  },
};
`,
  });
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.errors).toEqual([
      {
        path: "plugins.bad",
        message: "validateConfig must return ConfigIssue[]",
        code: "CONFIG_PLUGIN_HOOK",
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a hook that throws is CONFIG_PLUGIN_HOOK and does not abort the check", async () => {
  const dir = writeProject(project("plugins:\n  - namespace: bad\n    path: ./bad.js\n"), {
    "bad.js": `export default {
  namespace: "bad",
  apiVersion: 2,
  handlers: { go: async () => {} },
  validateConfig() {
    throw new Error("boom");
  },
};
`,
  });
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      {
        path: "plugins.bad",
        message: "validateConfig threw: boom",
        code: "CONFIG_PLUGIN_HOOK",
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project plugin on disk is registered without being imported", async () => {
  const dir = writeProject(project("tasks:\n  go:\n    - uses: marker/go\n"), {
    ".bolt/plugins/marker/index.js": `throw new Error("imported during check");\n`,
  });
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a path plugin that fails to load does not crash check", async () => {
  const dir = writeProject(
    project(
      "plugins:\n  - namespace: boom\n    path: ./boom.js\ntasks:\n  go:\n    - uses: boom/go\n",
    ),
    { "boom.js": `throw new Error("plugin exploded");\n` },
  );
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bolt check --json reports CONFIG_PLUGIN_REQUIRED and exits 3", async () => {
  const dir = writeProject(project("tasks:\n  build:\n    - uses: ue/build\n"));
  try {
    const json = await bolt(["check", "--json"], dir);
    expect(json.code).toBe(3);
    const body = JSON.parse(json.out) as {
      ok: boolean;
      errors: Array<{ code: string; message: string; hint?: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.errors).toContainEqual({
      code: "CONFIG_PLUGIN_REQUIRED",
      message: "plugins.ue: ue metadata is required when a task uses a ue/ handler",
      hint: "Add plugins: [{ namespace: ue, config: { engine, project, uproject } }]",
    });

    const human = await bolt(["check"], dir);
    expect(human.code).toBe(3);
    expect(human.out).toContain(
      "Add plugins: [{ namespace: ue, config: { engine, project, uproject } }]",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
