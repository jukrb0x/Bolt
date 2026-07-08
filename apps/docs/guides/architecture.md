---
title: "Architecture"
---

A concise, user-facing tour of how Bolt is put together and how a command flows through it. For the full engineering reference, see the internal architecture doc.

## Repository Layout

```
src/
├── main.ts               # CLI entry — citty command tree
├── index.ts              # Library public API (run, createContext, loadConfig)
├── api.ts                # High-level run() implementation
├── config.ts             # Zod schema, loadConfig (+ bolt.local.yaml merge), checkConfig
├── discover.ts           # Upward bolt.yaml search
├── runner.ts             # Core execution engine (runTask / runFlow)
├── interpolate.ts        # ${{ }} template engine
├── logger.ts             # Logger (console + optional file sink)
├── notify.ts             # Notifier: WeCom, Telegram providers
├── plugin.ts             # BoltPlugin / BoltPluginContext + @param metadata
├── plugin-registry.ts    # PluginRegistry, buildRegistry() (scope resolution)
├── ai-context.ts         # generateAiContext() → .bolt/ai-context.md
├── plugins/              # Built-ins: ue, ue-ini, git, svn, fs, json, path-guard
├── commands/             # citty subcommands; init.ts scaffolds config
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

Commands are registered in `main.ts` via citty's `subCommands`. citty handles `--help`, `--version`, and argument routing. All commands produce plain terminal output — the interactive `help` TUI and `init` wizard were removed in v2.

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

`bolt run a b c` calls `runTask` for each name in the typed order. `bolt run <flow>` calls `runFlow`, which iterates the flow's tasks fail-fast, honoring `continue_on_fail`.

## Config Split Loader

`loadConfig` reads two files and merges them:

- `bolt.yaml` — the committed shared contract: project identity, `targets`, `tasks`, `flows`. No machine paths.
- `bolt.local.yaml` — per-machine paths (`engine_path`, `project_path`, `uproject`, `use_tortoise`), gitignored.

The loader merges them into the runtime `project.engine_repo` / `project_repo` / `uproject` shape. A missing or invalid `bolt.local.yaml` is a loud error, not a silent fallback.

## Plugin Scopes (resolution priority)

Later scopes override earlier ones for the same namespace:

1. Built-in (compiled into bolt) — lowest
2. User — `~/.bolt/plugins/<name>/`
3. Project auto — `.bolt/plugins/<name>/`
4. Project explicit — declared in `bolt.yaml` `plugins:` — highest

## Key Design Decisions

**Params merge order:** CLI run params always win over YAML `with:` params (`{ ...yamlParams, ...params }`), consistent across all dispatch paths, and exposed as `${{ params.x }}` in interpolation.

**`task/` composition:** `uses: task/<name>` runs another task inline, sharing the cycle-detection set; handled in `dispatch()` before the plugin registry.

**Registry is per-Runner:** each `Runner` lazily builds its own registry on first `uses:` dispatch. Display-only paths (e.g. `plugin list`) call `buildRegistry()` directly.

**Runtime abstraction:** `runtime/` selects Bun (native `Bun.spawn`) or Node (`child_process`) so the library runs on both; the CLI stays Bun-only.

## Logging

Every run is logged to both the console and a file under `.bolt/logs/`:

```
<project>/.bolt/logs/bolt_2024-01-15T10-30-00.log
```

Logs capture the timestamp, Bolt version, config path, tasks/flows executed, step output, timing, and any errors.

## See Also
- [Plugin System](./plugin-system.md) - How plugins work
- [Runtime](./runtime.md) - Bun vs Node.js abstraction
