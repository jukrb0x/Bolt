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

**macOS (Apple Silicon)**
```bash
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
```

Installs `bolt` to `~/.bolt/bin/` and adds it to your PATH. To update:

```
bolt self-update
```

## Quick Start

After installing, scaffold config in your project:

```bash
cd /path/to/your/ue/project
bolt init
```

`bolt init` writes two files:

1. `bolt.yaml` — the shared, committed contract (project identity, tasks, flows). No machine paths.
2. `bolt.local.yaml` — per-machine paths (engine/project/uproject), gitignored. `bolt init` tries to auto-detect your `.uproject`.

Edit the paths in `bolt.local.yaml`, then run:

```bash
bolt run daily --dry-run     # preview
bolt run daily               # go
```

## How It Works

Bolt has two building blocks:

- A **task** is a named list of steps (the only building block).
- A **flow** is an ordered set of tasks. Flows are **fail-fast**: the first failing task aborts the flow, unless it is listed in `continue_on_fail`.

Everything runs through one verb, `bolt run`. Pass task names to run them in the order you type, or a single flow name to run a predefined goal. What you type is what runs — there is no hidden reordering.

```yaml
# bolt.yaml — shared contract, committed (no machine paths)
project:
  name: MyGame
  engine: { vcs: git, branch: main }
  project: { vcs: svn }

tasks:
  kill:    [{ uses: ue/kill }]
  update:  [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build:   [{ uses: ue/build, with: { target: editor } }]
  build_editor: [{ call: build }]
  start:   [{ uses: ue/start }]

flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]    # update/build failures abort; start may fail
```

```yaml
# bolt.local.yaml — per-machine paths, gitignored
engine_path:  C:/UnrealEngine
project_path: C:/Projects/MyGame
uproject:     C:/Projects/MyGame/MyGame.uproject
use_tortoise: true
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

| Command | Description |
|---------|-------------|
| `bolt run <names...>` | Run tasks in the typed order, or a single flow |
| `bolt list` | List all tasks and flows |
| `bolt inspect <names...>` | Show the resolved steps for a task or flow |
| `bolt info` | Show project and VCS status |
| `bolt check` | Validate `bolt.yaml` and `bolt.local.yaml` |
| `bolt init` | Scaffold `bolt.yaml` + `bolt.local.yaml` |
| `bolt config` | Open the current `bolt.yaml` in `$EDITOR` |
| `bolt ai` | Generate `.bolt/ai-context.md` for LLM agents |
| `bolt version` | Print version |
| `bolt self-update` | Update to the latest release |
| `bolt plugin list` | List active plugins and their handlers |
| `bolt plugin new <name>` | Scaffold a new plugin |

## Configuration

Config is split in two: a shared `bolt.yaml` you commit, and a per-machine `bolt.local.yaml` you gitignore. Bolt merges them at load, so plugin handlers see one unified project.

### bolt.yaml (shared, committed)

```yaml
project:
  name: MyGame
  engine:                    # repo identity only — path lives in bolt.local.yaml
    vcs: git                 # git | svn
    url: ""                  # optional: remote URL
    branch: main             # optional: for git repos
  project:
    vcs: svn                 # git | svn
    url: ""                  # optional: remote URL

targets:
  editor:
    kind: editor             # editor | program | game | client | server
    config: development      # development | debug | debuggame | shipping | test
  client:
    kind: program
    name: MyClient
    config: shipping

tasks:
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build:  [{ uses: ue/build, with: { target: editor } }]
  build_editor: [{ call: build }]
  start:  [{ uses: ue/start }]

flows:
  daily:
    steps: [update, build, start]
    continue_on_fail: [start]

timeout_hours: 6             # optional: abort a run that exceeds this
```

### bolt.local.yaml (per-machine, gitignored)

```yaml
engine_path:  C:/UnrealEngine                       # local UE root
project_path: C:/Projects/MyGame                    # local project working copy
uproject:     C:/Projects/MyGame/MyGame.uproject    # .uproject file
use_tortoise: true                                  # optional: TortoiseSVN/Proc for SVN
```

Relative paths in `bolt.local.yaml` resolve against the directory containing `bolt.yaml`.

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
      continue-on-error: true    # per-step: don't fail the run if this errors
    - call: update               # reuse another task inline
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
```

### Flows

A flow is a named, ordered goal composed of tasks. Flows are fail-fast — the first failing task aborts the run — unless a task is listed in `continue_on_fail`:

```yaml
flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]    # update/build abort; start may fail
  reset:
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]     # kill may fail (nothing running) without aborting
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

| Handler | Description |
|---------|-------------|
| `ue/build` | Build editor, program, or game target |
| `ue/build_engine` | Build the UE engine itself |
| `ue/build_program` | Build a standalone program target |
| `ue/start` | Launch UE editor or a built binary |
| `ue/kill` | Kill all running UE processes |
| `ue/update_engine` | Update the engine repo (git/svn) |
| `ue/update_project` | Update the project repo (git/svn) |
| `ue/setup` | Run the engine `Setup.bat` |
| `ue/svn_cleanup` | Run SVN cleanup (TortoiseSVN-aware) |
| `ue/svn_revert` | Revert SVN changes |
| `ue/generate_project` | Regenerate project files |
| `ue/fillddc` | Fill Derived Data Cache |
| `ue/fix_dll` | Remove zero-byte DLLs causing linker errors |
| `ue/info` | Print project and VCS info |
| `ue/ini_set`, `ue/ini_get`, `ue/ini_remove`, `ue/ini_override`, `ue/ini_read_all` | Edit UE `.ini` config |

## Plugins

Bolt is extensible. Add your own handlers for anything not covered by the built-ins — deploying builds, sending Slack messages, running custom tools.

### Create a plugin

```
bolt plugin new myplugin           # project-scope
bolt plugin new myplugin --user    # user-scope (~/.bolt/plugins/)
```

```
cd .bolt/plugins/myplugin
bun install    # sets up IDE type support
```

```typescript
import type { BoltPlugin } from "bolt";

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

| Scope | Location | Priority |
|-------|----------|----------|
| Built-in | Compiled into bolt | Lowest |
| User | `~/.bolt/plugins/<name>/` | ↑ |
| Project auto | `.bolt/plugins/<name>/` | ↑ |
| Project explicit | Declared in `bolt.yaml` `plugins:` | Highest |

Higher-priority plugins override lower ones for the same namespace, so you can override any built-in behaviour.

### Type definitions

Plugin types are available via the `boltstack` npm package:

```
bun add -d boltstack
```

`import type { BoltPlugin, BoltPluginContext } from "bolt"` resolves correctly after install. The scaffold sets this up automatically.

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
  project: {
    name: "MyGame",
    engine_repo: { path: "C:/UnrealEngine", vcs: "git" },
    project_repo: { path: "C:/Projects/MyGame", vcs: "svn" },
    uproject: "C:/Projects/MyGame/MyGame.uproject",
  },
  dryRun: false,
});
```

### Direct Plugin Access

```typescript
import { ue, fs } from "boltstack/plugins";
import { createContext } from "boltstack";

const ctx = createContext({
  project: {
    name: "MyGame",
    engine_repo: { path: "C:/UnrealEngine", vcs: "git" },
    project_repo: { path: "C:/Projects/MyGame", vcs: "svn" },
    uproject: "C:/Projects/MyGame/MyGame.uproject",
  },
});

await ue.handlers.build({ target: "editor" }, ctx);
```

### Core Internals

```typescript
import { Runner, Logger, createRuntime } from "boltstack/core";
import { loadConfig } from "boltstack";

const config = await loadConfig("./bolt.yaml", createRuntime());
const runner = new Runner(config, { logger: new Logger() });

await runner.runTask("build", {});   // run a task
await runner.runFlow("daily");        // run a flow
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
bun test             # run tests (requires bolt.local.yaml with local paths)
bun run build:types  # regenerate bolt.d.ts
bun run release:dry  # preview the release process
```

## License

Apache-2.0
