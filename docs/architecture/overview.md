---
title: "Architecture"
---

Code architecture of Bolt (`boltstack`). For the docs/AI-context system, see
`content-system.md`.

## Repository Layout

```
src/
├── main.ts               # CLI entry — citty command tree
├── index.ts              # Library public API (run, createContext, loadConfig)
├── api.ts                # High-level run() implementation
├── config.ts             # Zod schema, types, loadConfig (+ bolt.local.yaml merge), checkConfig
├── discover.ts           # Upward bolt.yaml search
├── runner.ts             # Core execution engine (runTask / runFlow)
├── interpolate.ts        # ${{ }} template engine
├── logger.ts             # Logger (console + optional file sink)
├── notify.ts             # Notifier: WeCom, Telegram providers
├── plugin.ts             # BoltPlugin / BoltPluginContext + @param metadata
├── plugin-api.ts         # Public re-export surface → bolt.d.ts entry
├── plugin-registry.ts    # PluginRegistry, buildRegistry() (scope resolution)
├── ai-context.ts         # generateAiContext() → .bolt/ai-context.md
├── inspect-utils.ts      # Step resolution for `bolt inspect`
├── version.ts            # VERSION constant (stamped at release time)
├── virtual-module.ts     # In-memory module loading for plugins
├── core/index.ts         # Library barrel: Runner, Logger, createRuntime
├── runtime/              # Bun vs Node abstraction (bun.ts, node.ts, index.ts, types.ts)
├── plugins/              # Built-ins: ue, ue-ini, git, svn, fs, json, path-guard (+ helpers)
├── commands/             # citty subcommands (see Command Tree); init.ts scaffolds config
└── tests/                # Bun test suite (co-located)
```

## Command Tree

```
bolt
├── run <name...>          # run tasks (typed order) or a single flow
├── list                   # list tasks and flows
├── info                   # project + VCS summary
├── check                  # validate bolt.yaml (+ bolt.local.yaml)
├── config                 # open bolt.yaml in $EDITOR
├── init                   # scaffold bolt.yaml + bolt.local.yaml
├── inspect <name...>      # show resolved steps without executing
├── plugin
│   ├── list               # active plugins + handlers
│   └── new <name>         # scaffold a plugin
├── ai                     # generate .bolt/ai-context.md
├── self-update            # update to latest release
└── version                # print version
```

Commands are registered in `main.ts` via citty's `subCommands`. citty handles
`--help`, `--version`, and argument routing. All commands are plain terminal
output (the Ink/React `help` TUI and interactive `init` wizard were removed in v2).

## Execution Flow

```
CLI args
  └── citty routes to command
        └── discover(cwd)          # walk up to find bolt.yaml
              └── loadConfig()      # parse bolt.yaml + merge bolt.local.yaml + Zod
                    └── Runner
                          ├── runTask(name)   # one task (steps in order)
                          └── runFlow(name)   # ordered tasks, fail-fast (+ continue_on_fail)
                                └── execStep()
                                      ├── shell()          # step.run
                                      └── dispatch()       # step.uses
                                            ├── task/<name> # recursive composition
                                            ├── ./path      # local file
                                            └── ns/handler → PluginRegistry
```

## Plugin scopes (resolution priority)

Later scopes override earlier ones for the same namespace:

1. Built-in (compiled into bolt) — lowest
2. User — `~/.bolt/plugins/<name>/`
3. Project auto — `.bolt/plugins/<name>/`
4. Project explicit — declared in `bolt.yaml` `plugins:` — highest

## Key Design Decisions

**Params merge order:** CLI run `params` always win over YAML `with:` params:
`{ ...yamlParams, ...params }`. Consistent across all dispatch paths, and params
are also exposed as `${{ params.x }}` in interpolation.

**`task/` composition:** `uses: task/<name>` runs another task inline, sharing the
cycle-detection set; handled in `dispatch()` before the plugin registry.

**Config split:** `bolt.yaml` is the committed shared contract (identity, tasks,
flows, targets); `bolt.local.yaml` holds per-machine paths (gitignored). `loadConfig`
merges them into the runtime `project.engine_repo`/`project_repo`/`uproject` shape.

**Registry is per-Runner:** each `Runner` lazily builds its own registry on first
`uses:` dispatch. Display-only paths (e.g. `plugin list`) call `buildRegistry()`
directly.

**Runtime abstraction:** `runtime/` selects Bun (native `Bun.spawn`) or Node
(`child_process`) so the library runs on both; the CLI stays Bun-only.

**`bolt.d.ts` generation:** `dts-bundle-generator` compiles `src/plugin-api.ts`
into a flat declaration file, then `scripts/wrap-dts.ts` wraps it in a
`declare module` block. Published with the `boltstack` npm package. See
`../ops/release.md`.

**AI context:** `ai-context.ts` renders a per-project command reference from
`bolt.yaml` (with a content hash for staleness). See `content-system.md`.
