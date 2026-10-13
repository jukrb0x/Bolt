import {
  chmodSync,
  cpSync,
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

export const repoRoot = path.resolve(import.meta.dir, "..");

const entry = path.join(repoRoot, "src/main.ts");
const record = path.join(repoRoot, "e2e/fakes/record.ts");
const recordExe = path.join(repoRoot, "e2e/fakes/win/record.exe");
const engineTemplate = path.join(repoRoot, "e2e/fakes/engine");
const fakeBin = path.join(
  repoRoot,
  "e2e/fakes/bin",
  process.platform === "win32" ? "win" : "posix",
);

const gitEnv = {
  GIT_AUTHOR_NAME: "Bolt E2E",
  GIT_AUTHOR_EMAIL: "bolt-e2e@example.com",
  GIT_COMMITTER_NAME: "Bolt E2E",
  GIT_COMMITTER_EMAIL: "bolt-e2e@example.com",
};

export function slash(value: string): string {
  return value.replace(/\\/g, "/");
}

export interface FakeCall {
  tool: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  exit: number;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  log: string;
}

export interface Project {
  dir: string;
  engine: string;
  uproject: string;
}

export function readCalls(log: string): FakeCall[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split(/\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FakeCall);
}

export function findCall(log: string, fragment: string): FakeCall {
  const hit = readCalls(log).find((call) => slash(call.tool).includes(fragment));
  if (!hit) {
    const seen = readCalls(log)
      .map((call) => call.tool)
      .join(", ");
    throw new Error(`no fake call containing "${fragment}"; saw ${seen || "(none)"}`);
  }
  return hit;
}

export function callsMatching(log: string, fragment: string): FakeCall[] {
  return readCalls(log).filter((call) => slash(call.tool).includes(fragment));
}

function chmodTree(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) chmodTree(full);
    else chmodSync(full, 0o755);
  }
}

/** Shell bodies installed under the filename the handler already executes. */
const POSIX_AS_WINDOWS: Array<[string, string]> = [
  ["Setup.sh", "Setup.bat"],
  ["GenerateProjectFiles.sh", "GenerateProjectFiles.bat"],
  ["Engine/Build/BatchFiles/Build.sh", "Engine/Build/BatchFiles/Build.bat"],
  [
    "Engine/Build/BatchFiles/GenerateProjectFiles.sh",
    "Engine/Build/BatchFiles/GenerateProjectFiles.bat",
  ],
  ["Engine/Build/BatchFiles/RunUAT.sh", "Engine/Build/BatchFiles/RunUAT.bat"],
  ["Engine/Binaries/Win64/UE4Editor.sh", "Engine/Binaries/Win64/UE4Editor.exe"],
  ["Engine/Binaries/Win64/UE4Editor-Cmd.sh", "Engine/Binaries/Win64/UE4Editor-Cmd.exe"],
  ["Engine/Binaries/Win64/UnrealEditor.sh", "Engine/Binaries/Win64/UnrealEditor.exe"],
  ["Engine/Binaries/Win64/UnrealEditor-Cmd.sh", "Engine/Binaries/Win64/UnrealEditor-Cmd.exe"],
];

const WINDOWS_EXES = [
  "Engine/Binaries/Win64/UE4Editor.exe",
  "Engine/Binaries/Win64/UE4Editor-Cmd.exe",
  "Engine/Binaries/Win64/UnrealEditor.exe",
  "Engine/Binaries/Win64/UnrealEditor-Cmd.exe",
];

export type EngineMajor = 4 | 5;

export interface EngineLayout {
  /** Which engine the tree looks like. Default 4. */
  major?: EngineMajor;
  /** Write Engine/Build/Build.version. Default true. False leaves only the binaries to detect. */
  buildVersion?: boolean;
}

/** Template paths that belong to the other engine version's layout. */
function foreignFiles(major: EngineMajor): string[] {
  const other = major === 5 ? "UE4Editor" : "UnrealEditor";
  const ubt =
    major === 5
      ? ["Engine/Binaries/DotNET/UnrealBuildTool.sh", "Engine/Binaries/DotNET/UnrealBuildTool.cmd"]
      : ["Engine/Binaries/DotNET/UnrealBuildTool"];
  return [
    ...["", "-Cmd"].flatMap((suffix) =>
      [".sh", ".cmd", ".exe"].map((ext) => `Engine/Binaries/Win64/${other}${suffix}${ext}`),
    ),
    ...ubt,
  ];
}

const ownsFile = (major: EngineMajor, rel: string) =>
  !rel.includes(major === 5 ? "UE4Editor" : "UnrealEditor");

/**
 * Copy the fake engine laid out as UE4 (UE4Editor, DotNET/UnrealBuildTool) or
 * UE5 (UnrealEditor, DotNET/UnrealBuildTool/UnrealBuildTool). Only that
 * version's editor binaries exist, so a handler that names the wrong editor
 * fails.
 */
export function installEngine(dest: string, layout: EngineLayout = {}): void {
  const major = layout.major ?? 4;
  mkdirSync(dest, { recursive: true });
  cpSync(engineTemplate, dest, { recursive: true });
  for (const rel of foreignFiles(major)) {
    rmSync(path.join(dest, rel), { recursive: true, force: true });
  }
  if (layout.buildVersion !== false) {
    const version = major === 5 ? [5, 4, 4] : [4, 27, 2];
    writeFileSync(
      path.join(dest, "Engine/Build/Build.version"),
      `${JSON.stringify({ MajorVersion: version[0], MinorVersion: version[1], PatchVersion: version[2] }, null, 2)}\n`,
    );
  }
  if (process.platform === "win32") {
    for (const rel of WINDOWS_EXES.filter((file) => ownsFile(major, file))) {
      const file = path.join(dest, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      cpSync(recordExe, file);
    }
    return;
  }
  for (const [srcRel, destRel] of POSIX_AS_WINDOWS.filter(([, file]) => ownsFile(major, file))) {
    const file = path.join(dest, destRel);
    mkdirSync(path.dirname(file), { recursive: true });
    cpSync(path.join(engineTemplate, srcRel), file);
  }
  chmodTree(dest);
}

export function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, ...gitEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.exitCode}): ${stderr || stdout}`);
  }
  return stdout;
}

function quote(value: string): string {
  return slash(value).replace(/"/g, '\\"');
}

export function writeBolt(
  dir: string,
  body: string,
  opts?: {
    tortoise?: boolean;
    notifications?: string;
    extraPlugins?: string;
    engineConfig?: string;
    ueConfig?: string;
  },
): void {
  const engine = path.join(dir, "engine");
  const uproject = path.join(dir, "Sample.uproject");
  const text = `version: 1
project:
  name: Sample
${opts?.notifications ?? ""}plugins:
  - namespace: ue
    config:
      engine:
        path: "${quote(engine)}"
        vcs: git
        branch: main
${opts?.engineConfig ?? ""}      project:
        path: "${quote(dir)}"
        vcs: svn
${opts?.ueConfig ?? ""}      uproject: "${quote(uproject)}"
      targets:
        editor:
          kind: editor
          config: development
        client:
          kind: program
          name: SampleClient
          config: shipping
  - namespace: svn
    config:
      use_tortoise: ${opts?.tortoise ? "true" : "false"}
${opts?.extraPlugins ?? ""}${body.endsWith("\n") ? body : `${body}\n`}`;
  writeFileSync(path.join(dir, "bolt.yaml"), text);
}

const SAMPLE_TASKS = `tasks:
  setup:
    - uses: ue/setup
  gen:
    - uses: ue/generate_project
  build-editor:
    - uses: ue/build
      with: { target: editor }
  build-client:
    - uses: ue/build
      with: { target: client }
  build-engine:
    - uses: ue/build
      with: { target: engine }
  build-program:
    - uses: ue/build_program
      with: { target: CustomProgram }
  fill:
    - uses: ue/fillddc
  start:
    - uses: ue/start
  start-named:
    - uses: ue/start
      with: { target: SampleEditor }
  kill:
    - uses: ue/kill
  update-engine:
    - uses: ue/update_engine
  update-project:
    - uses: ue/update_project
  info:
    - uses: ue/info
  svn-cleanup:
    - uses: svn/cleanup
      with: { path: "." }
  ue-cleanup:
    - uses: ue/svn_cleanup
  svn-revert:
    - uses: svn/revert
      with: { path: "." }
  svn-info:
    - uses: svn/info
      with: { path: "." }
  svn-commit:
    - uses: svn/commit
      with: { path: ".", message: "e2e" }
  ini-set:
    - uses: ue/ini_set
      with: { file: Config/DefaultEngine.ini, section: Core.System, key: Bar, value: "2" }
  ini-get:
    - uses: ue/ini_get
      with: { file: Config/DefaultEngine.ini, section: Core.System, key: Bar }
  ini-remove:
    - uses: ue/ini_remove
      with: { file: Config/DefaultEngine.ini, section: Core.System, key: Foo }
  ini-override:
    - uses: ue/ini_override
      with: { file: Config/DefaultEngine.ini, override-file: Config/Override.ini }
  ini-read:
    - uses: ue/ini_read_all
      with: { file: Config/DefaultEngine.ini }
  mkdir:
    - uses: fs/mkdir
      with: { path: nested/dir }
  copy:
    - uses: fs/copy
      with: { src: hello.txt, dst: out/hello.txt }
  move:
    - uses: fs/move
      with: { src: out/hello.txt, dst: out/moved.txt }
  delete:
    - uses: fs/delete
      with: { path: out/moved.txt }
  json-set:
    - uses: json/set
      with: { file: data.json, key: a.b, value: next }
  json-merge:
    - uses: json/merge
      with: { file: data.json, patch: patch.json }
  fix-dll:
    - uses: ue/fix_dll
`;

export function makeProject(opts?: {
  tortoise?: boolean;
  tasks?: string;
  notifications?: string;
  extraPlugins?: string;
  git?: boolean;
  engine?: EngineLayout;
  /** Extra YAML lines under plugins[ue].config.engine (6-space indent). */
  engineConfig?: string;
  /** Extra YAML lines under plugins[ue].config (6-space indent). */
  ueConfig?: string;
}): Project {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-e2e-"));
  const engine = path.join(dir, "engine");
  installEngine(engine, opts?.engine);
  const uproject = path.join(dir, "Sample.uproject");
  writeFileSync(
    uproject,
    `${JSON.stringify({ FileVersion: 3, EngineAssociation: "5.4", Modules: [] })}\n`,
  );
  mkdirSync(path.join(dir, "Config"), { recursive: true });
  writeFileSync(path.join(dir, "Config/DefaultEngine.ini"), "[Core.System]\nFoo=1\n");
  writeFileSync(path.join(dir, "Config/Override.ini"), "[Core.System]\nFoo=9\n");
  writeFileSync(path.join(dir, "hello.txt"), "hello\n");
  writeFileSync(
    path.join(dir, "data.json"),
    `${JSON.stringify({ a: { b: "old" }, keep: 1 }, null, 2)}\n`,
  );
  writeFileSync(path.join(dir, "patch.json"), `${JSON.stringify({ keep: 2, extra: true })}\n`);
  writeFileSync(path.join(dir, "notes.txt"), "note\n");
  writeFileSync(path.join(engine, "Engine/Binaries/Win64/Zero.dll"), "");
  if (opts?.git !== false) {
    git(engine, ["init", "-b", "main"]);
    writeFileSync(path.join(engine, "README.txt"), "v1\n");
    git(engine, ["add", "README.txt"]);
    git(engine, ["commit", "-m", "init engine"]);
  }
  writeBolt(dir, opts?.tasks ?? SAMPLE_TASKS, opts);
  return { dir, engine, uproject };
}

export function placeTargetBinary(project: Project, name: string): string {
  const file = path.join(project.dir, "Binaries", "Win64", `${name}.exe`);
  mkdirSync(path.dirname(file), { recursive: true });
  if (process.platform === "win32") {
    cpSync(recordExe, file);
  } else {
    writeFileSync(file, '#!/bin/sh\nexec bun "$BOLT_FAKE_RECORD" "$0" "$@"\n');
    chmodSync(file, 0o755);
  }
  return file;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function childEnv(log: string, extra: Record<string, string>): Record<string, string> {
  const current = process.env.PATH ?? process.env.Path ?? "";
  const next = `${fakeBin}${path.delimiter}${current}`;
  return {
    ...(process.env as Record<string, string>),
    ...gitEnv,
    PATH: next,
    Path: next,
    BOLT_E2E_BIN: fakeBin,
    BOLT_FAKE_RECORD: record,
    BOLT_FAKE_LOG: log,
    ...extra,
  };
}

export async function bolt(
  dir: string,
  args: string[],
  extra: Record<string, string> = {},
): Promise<RunResult> {
  const log = path.join(dir, "fake-calls.log");
  writeFileSync(log, "");
  const proc = Bun.spawn(
    ["bun", "--tsconfig-override", path.join(repoRoot, "tsconfig.json"), entry, ...args],
    {
      cwd: dir,
      env: childEnv(log, extra),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr, output: stripAnsi(`${stdout}\n${stderr}`), log };
}

export function dispose(dir: string): void {
  // A child can still have the temp directory as its cwd (Windows EBUSY).
  // Retry, then return. The lock must not fail the test file from `finally`.
  const attempts = process.platform === "win32" ? 8 : 2;
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw err;
      if (i === attempts - 1) return;
      Bun.sleepSync(40 * (i + 1));
    }
  }
}
