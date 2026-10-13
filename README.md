# ⚡Bolt

English | [简体中文](README_zh.md)

Your daily Unreal Engine workflow, automated.

Bolt is a CLI tool that turns repetitive UE tasks — updating source control, rebuilding the editor, launching the game, filling DDC — into single commands you can chain, script, and share with your team.

```
bolt run update build start
```

Stop running Build.bat by hand. Stop context-switching between TortoiseSVN, the editor, and a dozen batch scripts. Define your workflow once in `bolt.yaml`, run it anywhere.

## Install

**Windows**

```powershell
irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
```

Installs `bolt.exe` to `%USERPROFILE%\.bolt\bin` and adds that directory to your user Path. If a `bolt.exe` is already on your PATH, the script updates that copy in place instead.

**macOS and Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | sh
```

Intel macOS installs `bolt-mac-x64`. Apple Silicon installs `bolt-mac-arm64`. Linux x64 installs `bolt-linux-x64`. The binary is `~/.bolt/bin/bolt`. If a `bolt` is already on your PATH, the script updates that copy in place. To update a script install:

```
bolt self-update
```

## Quick Start

After installing, scaffold config in your project:

```bash
cd /path/to/your/project
bolt init
```

`bolt init` writes `bolt.yaml`: a `hello` task and a `demo` flow. It does not write `bolt.local.yaml`. It also writes a JSON Schema for the editor, version-matched plugin types, and a `tsconfig.json`.

```bash
bolt run demo --dry-run
bolt run demo
```

## How It Works

Bolt has two building blocks:

- A **task** is a named list of steps (the only building block).
- A **flow** is an ordered set of tasks. Flows are **fail-fast**: the first failing task aborts the flow, unless it is listed in `continue_on_fail`.

Everything runs through one verb, `bolt run`. Pass task names to run them in the order you type, or a single flow name to run a predefined goal. What you type is what runs — there is no hidden reordering.

```yaml
# bolt.yaml
version: 1

project:
  name: MyGame

plugins:
  - namespace: ue
    config:
      engine: { path: C:/UnrealEngine, vcs: git, branch: main }
      project: { path: C:/Projects/MyGame, vcs: svn }
      uproject: C:/Projects/MyGame/MyGame.uproject
      targets:
        editor: { kind: editor, config: development }
  - namespace: svn
    config:
      use_tortoise: true

tasks:
  kill: [{ uses: ue/kill }]
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build: [{ uses: ue/build, with: { target: editor } }]
  build_editor: [{ call: build }]
  start: [{ uses: ue/start }]

flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start] # update/build failures abort; start may fail
```

Then run any combination in one command:

```
bolt run kill update build start     # ad-hoc: tasks in the typed order
bolt run build                       # just rebuild the editor
bolt run build --config=debug        # params replace the old variants
bolt run build_editor --config=debuggame # aliases: dbggame, DebugGame
bolt run daily                       # run the predefined flow
```

## Commands

| Command                   | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `bolt run <names...>`     | Run tasks in the typed order, or a single flow  |
| `bolt list`               | List all tasks and flows                        |
| `bolt inspect <names...>` | Show the resolved steps for a task or flow      |
| `bolt info`               | Show project and VCS status                     |
| `bolt check`              | Validate `bolt.yaml`                            |
| `bolt init`               | Scaffold `bolt.yaml`, schema, and plugin types  |
| `bolt types`              | Write plugin types and a tsconfig for this bolt |
| `bolt config`             | Open the current `bolt.yaml` in `$EDITOR`       |
| `bolt ai`                 | Generate `.bolt/ai-context.md` for LLM agents   |
| `bolt version`            | Print version                                   |
| `bolt self-update`        | Update to the latest release                    |
| `bolt plugin list`        | List active plugins and their handlers          |
| `bolt plugin new <name>`  | Scaffold a new plugin                           |

## Configuration

Shared config lives in `bolt.yaml` and starts with `version: 1`. `project` is a name. Unreal engine, project, and target metadata belong to the `ue` plugin. `bolt.local.yaml` is optional and may override `vars` and, per plugin namespace, plugin config (for machine paths).

### bolt.yaml (shared, committed)

```yaml
version: 1

project:
  name: MyGame

plugins:
  - namespace: ue
    config:
      engine:
        path: C:/UnrealEngine # local UE root
        vcs: git # git | svn
        branch: main
      project:
        path: C:/Projects/MyGame
        vcs: svn # git | svn
      uproject: C:/Projects/MyGame/MyGame.uproject
      targets:
        editor:
          kind: editor # editor | program | game | client | server
          config: development # development | debug | debuggame | shipping | test
        client:
          kind: program
          name: MyClient
          config: shipping
  - namespace: svn
    config:
      use_tortoise: true # optional: TortoiseSVN/Proc for SVN

tasks:
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build: [{ uses: ue/build, with: { target: editor } }]
  build_editor: [{ call: build }]
  start: [{ uses: ue/start }]

flows:
  daily:
    steps: [update, build, start]
    continue_on_fail: [start]

timeout_hours: 6 # optional: abort a run that exceeds this
```

### bolt.local.yaml (optional, gitignored)

```yaml
vars:
  region: eu # overrides the same key in bolt.yaml
plugins: # deep-merged over the bolt.yaml plugin config with that namespace
  ue:
    engine: { path: D:/UE_5.4 }
  svn:
    use_tortoise: true
```

Upgrading from bolt v2.0 config files? `bolt check` shows what moved; `bolt migrate` rewrites both files (`--dry-run` to preview; backups are kept).

Relative paths in plugin config resolve against the directory containing `bolt.yaml`.

### Tasks

A task is a named list of steps. Its three explicit execution keys are `uses` for a plugin/local action, `call` for a reusable task, and `run` for a shell command:

```yaml
tasks:
  build:
    - uses: ue/build
      with:
        target: editor
  reset:
    - uses: ue/kill
      continue-on-error: true # per-step: don't fail the run if this errors
    - call: update # reuse another task inline
    - call: build
  notify:
    - run: echo "done at ${{ env.TIME }}"
```

This is an intentional v2 break: legacy `uses: task/name` steps are rejected. Replace them with `call: name`; `uses` is reserved for plugin/local actions.

Run tasks ad-hoc, in the order you type. `--key=value` params apply to the whole run and override `with:` values:

```
bolt run reset build start
bolt run build --target=client --config=shipping
bolt run build_editor --config=debuggame # aliases: dbggame, DebugGame
bolt run update build --dry-run
bolt run build -- extra=--verbose # values starting with -- go after a bare --
```

Argument parsing is strict: unknown flags, `--dry-run=<value>`, param values starting with `--`, flags before the command (`bolt --dry-run run …`), and the reserved names `dry-run`, `simulate`, `json`, `agent`, `execute`, `plan`, `confirmed-by-user`, plus `help` (handled separately), used as params all fail with exit code 2 before anything runs. Mistyped commands and task names (`bolt rn mark`, `bolt run mrk`) also exit 2 with a "Did you mean" suggestion, and `bolt run` without a name lists the project's tasks. Reserved names are case-sensitive.

### Flows

A flow is a named, ordered goal composed of tasks. Flows are fail-fast — the first failing task aborts the run — unless a task is listed in `continue_on_fail`:

```yaml
flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start] # update/build abort; start may fail
  reset:
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill] # kill may fail (nothing running) without aborting
```

```
bolt run daily
bolt run reset --dry-run
```

### Notifications

Get notified on build start, completion, or failure:

```yaml
notifications:
  on_start: true
  on_complete: true
  on_failure: true
  providers:
    - type: wecom
      webhook_url: https://qyapi.weixin.qq.com/...
    - type: telegram
      bot_token: "123:ABC"
      chat_id: "-100..."
```

For a multi-task invocation, the start notification is sent once. It shows the top-level task list and each recursively owned `call`, plugin/local action, and shell command.

## Built-in Handlers

| Handler                                                                           | Description                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------- |
| `ue/build`                                                                        | Build editor, program, or game target       |
| `ue/build_engine`                                                                 | Build the UE engine itself                  |
| `ue/build_program`                                                                | Build a standalone program target           |
| `ue/start`                                                                        | Launch UE editor or a built binary          |
| `ue/kill`                                                                         | Kill all running UE processes               |
| `ue/update_engine`                                                                | Update the engine repo (git/svn)            |
| `ue/update_project`                                                               | Update the project repo (git/svn)           |
| `ue/setup`                                                                        | Run the engine `Setup.bat`                  |
| `ue/svn_cleanup`                                                                  | Run SVN cleanup (TortoiseSVN-aware)         |
| `ue/svn_revert`                                                                   | Revert SVN changes                          |
| `ue/generate_project`                                                             | Regenerate project files                    |
| `ue/fillddc`                                                                      | Fill Derived Data Cache                     |
| `ue/fix_dll`                                                                      | Remove zero-byte DLLs causing linker errors |
| `ue/info`                                                                         | Print project and VCS info                  |
| `ue/ini_set`, `ue/ini_get`, `ue/ini_remove`, `ue/ini_override`, `ue/ini_read_all` | Edit UE `.ini` config                       |

## Plugins

Bolt is extensible. Add your own handlers for anything not covered by the built-ins — deploying builds, sending Slack messages, running custom tools.

### Create a plugin

```
bolt plugin new myplugin           # project-scope
bolt plugin new myplugin --user    # user-scope (~/.bolt/plugins/)
```

```
cd .bolt/plugins/myplugin
bolt types
```

```typescript
import type { BoltPlugin } from "boltstack";

const plugin: BoltPlugin = {
  namespace: "myplugin",
  handlers: {
    deploy: async (params, ctx) => {
      ctx.logger.info(`Deploying to ${params.env}...`);
    },
  },
};

export default plugin;
```

Use it in a task:

```yaml
tasks:
  deploy:
    - uses: myplugin/deploy
      with:
        env: staging
```

### Plugin scopes

| Scope            | Location                           | Priority |
| ---------------- | ---------------------------------- | -------- |
| Built-in         | Compiled into bolt                 | Lowest   |
| User             | `~/.bolt/plugins/<name>/`          | ↑        |
| Project auto     | `.bolt/plugins/<name>/`            | ↑        |
| Project explicit | Declared in `bolt.yaml` `plugins:` | Highest  |

Higher-priority plugins override lower ones for the same namespace, so you can override any built-in behaviour.

### Type definitions

`bolt types` writes `.bolt/types/boltstack.d.ts` from the bolt that is running, and a `tsconfig.json` that maps `boltstack` to that file. The types match that binary. Do not download a separate `bolt.d.ts`.

```bash
bolt types
```

## Library Usage

Bolt can also be used as a library for programmatic workflow automation. Both Bun and Node.js are supported.

### Installation

```bash
npm install boltstack
# or
bun add boltstack
```

### High-Level API

```typescript
import { run, createContext } from "boltstack";

// Run a named task; params apply to every step
await run("build", {
  configPath: "./bolt.yaml",
  params: { target: "client" },
  dryRun: false,
});

// Create context for direct plugin calls
const ctx = createContext({
  project: { name: "MyGame" },
  dryRun: false,
});
```

### Direct Plugin Access

```typescript
import { fs } from "boltstack/plugins";
import { createContext } from "boltstack";

const ctx = createContext({
  project: { name: "MyGame" },
});

await fs.handlers.copy({ src: "a.txt", dst: "b.txt" }, ctx);
```

### Core Internals

```typescript
import { Runner, Logger, createRuntime } from "boltstack/core";
import { loadConfig } from "boltstack";

const config = await loadConfig("./bolt.yaml", createRuntime());
const runner = new Runner(config, { logger: new Logger() });

await runner.runTask("build", {}); // run a task
await runner.runFlow("daily"); // run a flow
```

### Subpath Exports

- `boltstack` — High-level API (run, createContext, loadConfig, checkConfig)
- `boltstack/plugins` — Built-in plugins (git, svn, ue, fs, json)
- `boltstack/core` — Core internals (Runner, Logger, createRuntime)

### Runtime Compatibility

The library uses a runtime abstraction layer:

- **Bun**: Uses native APIs (Bun.spawn, Bun.YAML)
- **Node.js**: Uses child_process and yaml package

CLI remains Bun-only for optimal performance, but the library works everywhere.

## Documentation

Full documentation lives in `apps/docs` (Mintlify):

- **Guide**: Getting started, installation, first project
- **How It Works**: Architecture, plugin system, runtime
- **CLI Reference**: Every command documented
- **API Reference**: Plugin API, config schema, built-in handlers, library usage
- **Configuration**: bolt.yaml schema, interpolation, troubleshooting

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev          # run from source
bun test             # run tests
bun run build:types  # regenerate bolt.d.ts
# Release by tagging a commit on main: git tag vX.Y.Z && git push origin vX.Y.Z
# See docs/ops/release.md. This does not publish to npm.
```

## License

Apache-2.0
