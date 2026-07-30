---
title: "Config Schema"
---

Complete reference for Bolt's configuration. Bolt v2 splits config into two files:

- **`bolt.yaml`** — the shared, committed contract (project identity, targets, tasks, flows). It contains **no machine paths**.
- **`bolt.local.yaml`** — per-machine paths (engine/project/uproject), **gitignored**.

At load time Bolt **merges** them into a single runtime config. Field names and defaults below mirror the Zod schema in `src/config.ts` (the source of truth).

## bolt.yaml (shared, committed)

Top-level keys:

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `project` | object | yes | — | Project identity (no paths) |
| `targets` | map | no | `{}` | Build targets |
| `tasks` | map | no | `{}` | Named lists of steps |
| `flows` | map | no | `{}` | Named, ordered sets of tasks |
| `vars` | map | no | `{}` | Shared string variables |
| `plugins` | array | no | `[]` | Project-scope plugin entries |
| `timeout_hours` | number | no | — | Abort the run if it exceeds this duration (positive) |
| `notifications` | object | no | — | Build-event notifications |

## project

Project **identity** only. Machine paths live in `bolt.local.yaml`.

```yaml
project:
  name: MyProject          # required
  engine:                  # required — repo identity (NO path)
    vcs: git               # git | svn (default: git)
    url: https://github.com/EpicGames/UnrealEngine.git  # optional
    branch: main           # optional
  project:                 # required — repo identity (NO path)
    vcs: svn               # git | svn (default: git)
    url: svn://svn.example.com/project/trunk            # optional
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Project display name |
| `engine` | RepoIdentity | yes | — | Engine repo identity |
| `project` | RepoIdentity | yes | — | Project repo identity |

Extra scalar (`string`/`boolean`) fields on `project` pass through and are available as `${{ project.<key> }}`.

### RepoIdentity

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `vcs` | string | no | `git` | `git` or `svn` |
| `url` | string | no | — | Remote repository URL |
| `branch` | string | no | — | Branch (git) |

There is **no `path`** here — the path is supplied per-machine by `bolt.local.yaml` and merged at load (see [Merged runtime shape](#merged-runtime-shape)).

## targets

Build targets referenced by `ue/build` via `--target=<name>`.

```yaml
targets:
  editor:
    kind: editor
    config: development
  client:
    kind: program
    name: MyClient
    config: shipping
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `kind` | string | yes | — | `editor` \| `program` \| `game` \| `client` \| `server` |
| `name` | string | no | — | Binary name (for program/game/server) |
| `config` | string | no | `development` | `development` \| `debug` \| `debuggame` \| `shipping` \| `test` |

## tasks

A **task** is a named list of steps — the only building block. Each step is one of:

```yaml
tasks:
  kill:   [{ uses: ue/kill }]
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build:  [{ uses: ue/build, with: { target: editor } }]
  start:  [{ uses: ue/start }]
  # reuse other tasks inline (cycle-detected):
  reset:  [{ call: kill }, { call: update }, { call: build }]
  # run a shell command:
  clean:  [{ run: "rm -rf ./Intermediate" }]
```

### Step Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uses` | string | one of `uses`/`call`/`run` | Plugin handler (`ns/handler`) or local action (`./path` or `../path`) |
| `call` | string | one of `uses`/`call`/`run` | Reusable task name (resolved recursively; cycle-detected) |
| `run` | string | one of `uses`/`call`/`run` | Shell command (`${{ }}` interpolated) |
| `with` | map (string→string) | no | Params forwarded to the handler (interpolated) |
| `continue-on-error` | boolean | no | Continue if this step fails (default: `false`) |

> Note the hyphen: steps use **`continue-on-error`**; flows use **`continue_on_fail`** (underscore).

## flows

A **flow** is a named, ordered set of tasks. **Fail-fast**: the first failing task aborts the flow unless it is listed in `continue_on_fail`.

```yaml
flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]   # update/build failures abort; start may fail
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `description` | string | no | — | Human-readable summary |
| `steps` | string[] | yes | — | Task names, run in listed order |
| `continue_on_fail` | string[] | no | `[]` | Tasks allowed to fail without aborting the flow |

## vars

Shared string variables, available as `${{ vars.<key> }}`. Per-machine `vars` in `bolt.local.yaml` shallow-override these.

```yaml
vars:
  region: us-east-1
```

## plugins

Explicitly register project-scope plugins by path. (Plugins are also auto-discovered from `.bolt/plugins/<namespace>/index.ts`.)

```yaml
plugins:
  - namespace: myplugin
    path: ./bolt-plugins/myplugin/index.ts
    config: { key: value }   # optional
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `namespace` | string | yes | Plugin namespace used in `uses:` |
| `path` | string | yes | Path to the plugin entry file |
| `config` | object | no | Arbitrary plugin config |

## timeout_hours

```yaml
timeout_hours: 6
```

Optional positive number. When set, a flow aborts if elapsed time reaches this many hours before the next task starts.

## notifications

```yaml
notifications:
  on_start: true
  on_op_complete: true
  on_failure: true
  on_complete: true
  providers:
    - type: wecom
      webhook_url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY
      chat_id: optional-group-id
    - type: telegram
      bot_token: "123456:ABC-DEF"
      chat_id: "-1001234567890"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `on_start` | boolean | `true` | Notify when a run starts |
| `on_op_complete` | boolean | `true` | Notify when each task completes |
| `on_failure` | boolean | `true` | Notify on task failure |
| `on_complete` | boolean | `true` | Notify when the whole run completes |
| `providers` | array | `[]` | Notification providers |

A run emits one start notification. Multi-task runs show the top-level task list and the recursively owned `call`, plugin/local action, and shell nodes.

### Provider Types

| Type | Required Fields | Optional |
|------|-----------------|----------|
| `wecom` | `webhook_url` | `chat_id` |
| `telegram` | `bot_token`, `chat_id` | — |

## bolt.local.yaml (per-machine, gitignored)

Holds machine-specific paths. Copy `bolt.local.example.yaml` → `bolt.local.yaml` (or run `bolt init`). Relative paths resolve against the directory containing `bolt.yaml`. A missing or invalid `bolt.local.yaml` is a **loud error**.

```yaml
engine_path:  D:/UE                                  # required — local UE root
project_path: D:/Games/MyProject                     # required — local project working copy
uproject:     D:/Games/MyProject/MyProject.uproject  # required — .uproject file
use_tortoise: true                                   # optional — use TortoiseSVN/Proc for SVN
vars:                                                # optional — shallow-merged over bolt.yaml vars
  some_key: some_local_value
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `engine_path` | string | yes | Local Unreal Engine root |
| `project_path` | string | yes | Local project working copy |
| `uproject` | string | yes | Path to the `.uproject` file |
| `use_tortoise` | boolean | no | Use TortoiseSVN/Proc for SVN operations |
| `vars` | map (string→string) | no | Per-machine variable overrides |

## Merged runtime shape

At load, Bolt reconstructs a single runtime `project` that handlers read. It combines the shared identity with the local paths:

```typescript
project: {
  name: string;
  engine_repo:  { path: string; vcs: "git" | "svn"; url?: string; branch?: string };
  project_repo: { path: string; vcs: "git" | "svn"; url?: string; branch?: string };
  uproject: string;        // resolved to an absolute path
  use_tortoise?: boolean;
  // extra scalar fields from bolt.yaml `project` pass through
}
```

- `engine_repo` = `engine` identity (from `bolt.yaml`) + `engine_path` (from `bolt.local.yaml`).
- `project_repo` = `project` identity + `project_path`.
- `uproject`, `use_tortoise` come from `bolt.local.yaml`.
- `vars` = `bolt.yaml` vars shallow-merged with `bolt.local.yaml` vars (local wins).

These merged fields are what plugin handlers and interpolation see — e.g. `${{ project.engine_repo.path }}`, `${{ project.project_repo.path }}`, `${{ project.uproject }}`.

## Migration from v1

`ops`, `variants`, `go-pipeline`, `actions`, and `depends` are removed. Model everything with `tasks` and `flows`; reuse a task with `call: <name>`. The legacy `uses: task/name` form is rejected; replace it with `call: name`. `bolt go`/`bolt help` are gone — use `bolt run`.

## See Also
- [bolt.yaml Guide](/guides/bolt-yaml.md) — annotated walkthrough and the config split
- [Interpolation](/guides/interpolation.md) — template syntax and context
