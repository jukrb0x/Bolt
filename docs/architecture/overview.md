---
title: "Architecture"
---

Code architecture of Bolt (`boltstack`). For the docs/AI-context system, see
`content-system.md`.

## Repository Layout

```
src/
├── main.ts               # CLI entry — citty command tree
├── index.ts              # Library public API (run, go, createContext, loadConfig)
├── api.ts                # High-level run()/go() implementations
├── config.ts             # Zod schema, types, loadConfig, checkConfig
├── discover.ts           # Upward bolt.yaml search
├── runner.ts             # Core execution engine (run action / go pipeline)
├── go.ts                 # parseGoArgs, resolveOps, sortByPipeline
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
├── commands/             # citty subcommands (see Command Tree)
├── init/                 # `bolt init` — Ink/React Q&A wizard + template engine
├── help/                 # `bolt help` — Ink/React man-style TUI (content.ts)
└── tests/                # Bun test suite (co-located)
```

## Command Tree

```
bolt
├── go <ops...>            # run ops in pipeline order
├── run <action>           # run a named action
├── list                   # list ops and actions
├── info                   # project + VCS summary
├── check                  # validate bolt.yaml
├── config                 # open bolt.yaml in $EDITOR
├── init                   # interactive bolt.yaml setup (Ink/React)
├── inspect <go|run> <n>   # show resolved steps without executing
├── plugin
│   ├── list               # active plugins + handlers
│   └── new <name>         # scaffold a plugin
├── ai                     # generate .bolt/ai-context.md
├── self-update            # update to latest release
├── help                   # interactive help TUI (Ink/React)
└── version                # print version
```

Commands are registered in `main.ts` via citty's `subCommands`. citty handles
`--help`, `--version`, and argument routing. `init` and `help` are `.tsx`
(Ink/React); the rest are plain terminal output.

## Execution Flow

```
CLI args
  └── citty routes to command
        └── discover(cwd)          # walk up to find bolt.yaml
              └── loadConfig()      # parse YAML + Zod validate
                    └── Runner
                          ├── run(action)     # named action
                          └── runOps(ops)     # go pipeline
                                └── execStep()
                                      ├── shell()         # step.run
                                      └── dispatch()      # step.uses
                                            ├── ops/<op>  # recursive, reserved
                                            ├── ./path    # local file
                                            └── ns/handler → PluginRegistry
```

## Plugin scopes (resolution priority)

Later scopes override earlier ones for the same namespace:

1. Built-in (compiled into bolt) — lowest
2. User — `~/.bolt/plugins/<name>/`
3. Project auto — `.bolt/plugins/<name>/`
4. Project explicit — declared in `bolt.yaml` `plugins:` — highest

## Key Design Decisions

**Params merge order:** CLI `opParams` always wins over YAML `with:` params:
`{ ...yamlParams, ...opParams }`. Consistent across all dispatch paths.

**`ops/` namespace is reserved:** handled inline in `dispatch()` before the
plugin registry — cannot be overridden by a plugin.

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
