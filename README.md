# Bolt

Unreal Engine build automation CLI. Define your project's ops and pipelines in `bolt.yaml`, then run them from anywhere.

```
bolt go update build start
```

## Install

**Windows**
```powershell
irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
```

**macOS (Apple Silicon)**
```bash
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
```

Installs `bolt` to `~/.bolt/bin/` and adds it to your PATH.

To update an existing installation:
```
bolt self-update
```

## Quick Start

Copy `bolt.template.yaml` to your project root as `bolt.yaml` and fill in the paths:

```yaml
project:
  name: MyGame
  ue_path: C:/UnrealEngine
  project_path: C:/Projects/MyGame
  project_name: MyGame
```

Then run operations:

```
bolt go build          # build editor
bolt go kill build     # kill editor, then build
bolt go update build start   # full pipeline
```

## Commands

| Command | Description |
|---------|-------------|
| `bolt go <ops...>` | Run one or more ops in pipeline order |
| `bolt run <action>` | Run a named action from bolt.yaml |
| `bolt list` | List all available ops and actions |
| `bolt info` | Show project and VCS status |
| `bolt check` | Validate bolt.yaml |
| `bolt version` | Print version |
| `bolt self-update` | Update to the latest release |
| `bolt plugin list` | List active plugins and their handlers |
| `bolt plugin new <name>` | Scaffold a new plugin |

## bolt.yaml

### Project

```yaml
project:
  name: MyGame
  ue_path: C:/UnrealEngine        # UE engine root
  project_path: C:/Projects/MyGame
  project_name: MyGame
  svn_root: C:/Projects/svn       # optional, for SVN workflows
  git_branch: main                # optional
```

### Targets

Targets define build configurations referenced by ops:

```yaml
targets:
  editor:
    kind: editor       # editor | program | game | client | server
    config: development  # development | debug | shipping | test
  client:
    kind: program
    name: MyClient
    config: shipping
```

### Ops

Ops are named, reusable steps. Each op can have multiple variants selected at runtime with `--<op>=<variant>`:

```yaml
ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
    editor:
      - uses: ue/build
        with:
          target: editor
    program:
      - uses: ue/build
        with:
          target: client
```

Run a specific variant:
```
bolt go build --build=program
```

### Go Pipeline

Controls execution order and failure behaviour for `bolt go`:

```yaml
go-pipeline:
  order:
    - kill
    - update
    - build
    - start
  fail_stops:
    - build   # stop entire run if build fails; other ops continue on failure
```

`bolt go` accepts any subset of ops from the pipeline — order is always respected regardless of the order you type them:

```
bolt go start build   # runs build first, then start
```

### Actions

Named profiles that compose multiple steps, runnable with `bolt run`:

```yaml
actions:
  full_reset:
    steps:
      - uses: ops/kill
        continue-on-error: true
      - uses: ops/update
      - uses: ops/build

  daily_check:
    depends:
      - full_reset
    steps:
      - uses: ops/start
```

```
bolt run full_reset
```

### Notifications

Optional build status notifications via WeCom or Telegram:

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

### Timeout

```yaml
timeout_hours: 6   # abort entire run after 6 hours
```

## Built-in Handlers

Bolt ships with built-in handlers for common UE tasks:

| Handler | Description |
|---------|-------------|
| `ue/build` | Build editor, program, or game target |
| `ue/build-engine` | Build the UE engine itself |
| `ue/build-program` | Build a standalone program target |
| `ue/start` | Launch UE editor |
| `ue/kill` | Kill all running UE processes |
| `ue/update-git` | Pull latest from git |
| `ue/update-svn` | Update SVN working copy |
| `ue/svn-cleanup` | Run SVN cleanup |
| `ue/svn-revert` | Revert SVN changes |
| `ue/generate-project` | Regenerate project files |
| `ue/fillddc` | Fill Derived Data Cache |
| `ue/fix-dll` | Fix DLL registration issues |
| `ue/info` | Print project and VCS info |
| `fs/copy`, `fs/delete`, `fs/mkdir` | File system operations |
| `json/set`, `json/delete` | JSON file manipulation |

## Plugins

Bolt's handler system is extensible via plugins.

### Plugin Scopes

Plugins are loaded in priority order (highest wins):

1. **Project-explicit** — declared in `bolt.yaml` under `plugins:`
2. **Project-auto** — discovered from `.bolt/plugins/<namespace>/index.ts`
3. **User-scope** — `~/.bolt/plugins/<namespace>/index.ts`
4. **Built-in** — shipped with bolt

### Writing a Plugin

Scaffold a new plugin:

```
bolt plugin new myplugin           # project-scope
bolt plugin new myplugin --user    # user-scope (~/.bolt/plugins/)
```

Then install dependencies for IDE type support:

```
cd .bolt/plugins/myplugin
bun install
```

The scaffolded plugin looks like:

```typescript
import type { BoltPlugin } from "bolt";

const plugin: BoltPlugin = {
  namespace: "myplugin",
  handlers: {
    run: async (params, ctx) => {
      ctx.logger.info("myplugin/run called");
    },
  },
};

export default plugin;
```

Use it in `bolt.yaml`:

```yaml
ops:
  deploy:
    default:
      - uses: myplugin/run
        with:
          env: staging
```

### Type Definitions

Plugin types are available via the `bolt-ue` npm package:

```
bun add -d bolt-ue
```

`import type { BoltPlugin, BoltPluginContext } from "bolt"` will resolve correctly after install. The scaffolding sets this up automatically.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev          # run from source
bun test             # run tests (requires .env.local with UE_PATH)
bun run build:types  # regenerate bolt.d.ts
```

## License

MIT
