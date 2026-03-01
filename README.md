# Bolt

Your daily Unreal Engine workflow, automated.

Bolt is a CLI tool that turns repetitive UE tasks — updating source control, rebuilding the editor, launching the game, filling DDC — into single commands you can chain, script, and share with your team.

```
bolt go update build start
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

## How It Works

Define your project once:

```yaml
# bolt.yaml
project:
  name: MyGame
  ue_path: C:/UnrealEngine
  project_path: C:/Projects/MyGame
  project_name: MyGame
  svn_root: C:/Projects/svn
```

Then run any combination of ops in one command:

```
bolt go kill update build start      # full reset and rebuild
bolt go build                        # just rebuild the editor
bolt go update:svn build --config=debug   # SVN update then debug build
bolt go build start --config=shipping    # shipping build and launch
```

Bolt runs them in the right order, stops on critical failures, and keeps going through non-critical ones.

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
  ue_path: C:/UnrealEngine
  project_path: C:/Projects/MyGame
  project_name: MyGame
  svn_root: C:/Projects/svn    # optional
  git_branch: main             # optional
  use_tortoise: true           # optional: true | false | auto-detect
```

### Targets

```yaml
targets:
  editor:
    kind: editor               # editor | program | game | client | server
    config: development        # development | debug | shipping | test
  client:
    kind: program
    name: MyClient
    config: shipping
```

### Ops

Ops are named, reusable steps invoked by `bolt go`. Each op can have named variants:

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

Select a variant at runtime:

```
bolt go build:program
bolt go --build=program
```

### Go Pipeline

Controls execution order and failure behaviour:

```yaml
go-pipeline:
  order:
    - kill
    - update
    - build
    - start
  fail_stops:
    - build      # stop the run if build fails; other ops continue on failure
```

`bolt go` always respects the pipeline order regardless of argument order:

```
bolt go start build    # executes build first, then start
```

### Actions

Named profiles for `bolt run` — composable, with dependency support:

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
bolt run daily_check    # runs full_reset first, then starts
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

### Timeout

```yaml
timeout_hours: 6
```

## Built-in Handlers

| Handler | Description |
|---------|-------------|
| `ue/build` | Build editor, program, or game target |
| `ue/build-engine` | Build the UE engine itself |
| `ue/build-program` | Build a standalone program target |
| `ue/start` | Launch UE editor or a built binary |
| `ue/kill` | Kill all running UE processes |
| `ue/update-git` | Pull latest from git |
| `ue/update-svn` | Update SVN working copy |
| `ue/svn-cleanup` | Run SVN cleanup (TortoiseSVN-aware) |
| `ue/svn-revert` | Revert SVN changes |
| `ue/generate-project` | Regenerate project files |
| `ue/fillddc` | Fill Derived Data Cache |
| `ue/fix-dll` | Remove zero-byte DLLs causing linker errors |
| `ue/info` | Print project and VCS info |
| `fs/copy`, `fs/move`, `fs/delete`, `fs/mkdir` | File system operations |
| `json/set`, `json/merge` | JSON file manipulation |

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

Use it in bolt.yaml:

```yaml
ops:
  deploy:
    default:
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

Plugin types are available via the `bolt-ue` npm package:

```
bun add -d bolt-ue
```

`import type { BoltPlugin, BoltPluginContext } from "bolt"` resolves correctly after install. The scaffold sets this up automatically.

## Documentation

- [Architecture](docs/architecture.md)
- [Configuration Reference](docs/config.md)
- [Commands](docs/commands.md)
- [Built-in Handlers](docs/handlers.md)
- [Plugin System](docs/plugins.md)
- [Runner Internals](docs/runner.md)
- [Release Process](docs/release.md)

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev          # run from source
bun test             # run tests (requires .env.local with UE_PATH)
bun run build:types  # regenerate bolt.d.ts
bun run release:dry  # preview the release process
```

## License

MIT
