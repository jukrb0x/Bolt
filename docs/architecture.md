# Architecture

## Repository Layout

```
src/
├── main.ts               # CLI entry point, command registration
├── version.ts            # VERSION constant (stamped at release time)
├── config.ts             # Zod schema, types, loadConfig, checkConfig
├── discover.ts           # Upward bolt.yaml search
├── runner.ts             # Core execution engine
├── go.ts                 # parseGoArgs, resolveOps, sortByPipeline
├── interpolate.ts        # ${{ }} template engine
├── logger.ts             # Logger (console + optional file sink)
├── notify.ts             # Notifier, WeCom, Telegram providers
├── plugin.ts             # BoltPlugin / BoltPluginContext interfaces
├── plugin-api.ts         # Re-export surface → bolt.d.ts generation entry
├── plugin-registry.ts    # PluginRegistry class, buildRegistry()
├── plugins/
│   ├── ue.ts             # Built-in "ue" plugin (14 handlers)
│   ├── fs.ts             # Built-in "fs" plugin (4 handlers)
│   └── json.ts           # Built-in "json" plugin (2 handlers)
└── commands/
    ├── run.ts            # bolt run
    ├── list.ts           # bolt list
    ├── info.ts           # bolt info
    ├── go.ts             # bolt go
    ├── check.ts          # bolt check
    ├── version.ts        # bolt version
    ├── update.ts         # bolt self-update
    ├── plugin.ts         # bolt plugin (parent)
    ├── plugin-list.ts    # bolt plugin list
    └── plugin-new.ts     # bolt plugin new
```

## Command Tree

```
bolt
├── run <action>
├── list
├── info
├── go <ops...>
├── check
├── version
├── self-update
└── plugin
    ├── list
    └── new <name>
```

Commands are registered in `main.ts` using citty's `subCommands` map. `citty` handles `--help`, `--version`, and argument routing.

## Execution Flow

```
CLI args
  └── citty routes to command
        └── findConfig(cwd)       # walk up to find bolt.yaml
              └── loadConfig()    # parse YAML + Zod validate
                    └── Runner
                          ├── run(action)     # named action
                          └── runOps(ops)     # go pipeline
                                └── execStep()
                                      ├── shell()         # step.run
                                      └── dispatch()      # step.uses
                                            ├── ops/<op>  # recursive
                                            ├── ./path    # local file
                                            └── ns/handler → PluginRegistry
```

## Key Design Decisions

**Params merge order:** `opParams` (CLI) always wins over `yamlParams` (`with:` in YAML): `{ ...yamlParams, ...opParams }`. Consistent across all dispatch paths.

**`ops/` namespace is reserved:** Handled inline in `dispatch()` before the plugin registry is consulted — cannot be overridden by a plugin.

**Registry is per-Runner:** Each `Runner` lazily initializes its own registry on first `uses:` dispatch. Commands that only need it for display (e.g. `plugin list`) call `buildRegistry()` directly.

**`bolt.d.ts` generation:** `dts-bundle-generator` compiles `plugin-api.ts` into a clean, self-contained `bolt.d.ts`. The public API is minimal (BoltPlugin, BoltPluginContext, BoltLogger, Project, RepoConfig) — internal plugins use full types from `plugin.ts`.

**Notification flags `on_start`/`on_complete`/`on_failure`** are parsed by the schema but currently unused — all events fire unconditionally. Reserved for future filtering.
