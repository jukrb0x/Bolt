---
title: "Architecture"
---

Understanding Bolt's internal architecture and execution flow.

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
├── init/
│   ├── index.tsx         # bolt init command (interactive setup)
│   ├── InitApp.tsx       # React-based init UI
│   └── generator.ts      # Config generation from answers
└── commands/
    ├── run.ts            # bolt run
    ├── list.ts           # bolt list
    ├── info.ts           # bolt info
    ├── go.ts             # bolt go
    ├── check.ts          # bolt check
    ├── version.ts        # bolt version
    ├── update.ts         # bolt self-update
    ├── help.tsx          # bolt help (interactive help)
    ├── config.ts         # bolt config
    ├── inspect.ts        # bolt inspect
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
├── init [location]
├── config
├── help [topic]
├── inspect <op|action>
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

### Params Merge Order
`opParams` (CLI) always wins over `yamlParams` (`with:` in YAML): `{ ...yamlParams, ...opParams }`. Consistent across all dispatch paths.

### Reserved Namespace
The `ops/` namespace is reserved. Handled inline in `dispatch()` before the plugin registry is consulted — cannot be overridden by a plugin.

### Per-Runner Registry
Each `Runner` lazily initializes its own registry on first `uses:` dispatch. Commands that only need it for display (e.g. `plugin list`) call `buildRegistry()` directly.

### Type Generation
`dts-bundle-generator` compiles `plugin-api.ts` into a clean, self-contained `bolt.d.ts`. The public API is minimal (BoltPlugin, BoltPluginContext, BoltLogger, Project, RepoConfig) — internal plugins use full types from `plugin.ts`.

### Notification Flags
`on_start`/`on_complete`/`on_failure` are parsed by the schema but currently unused — all events fire unconditionally. Reserved for future filtering.

## Configuration Loading

Bolt reads `bolt.yaml` by walking up the directory tree from `cwd`. The first file found is used.

```
/current/working/dir/bolt.yaml     # Found first, used
/current/working/bolt.yaml         # Not checked
/current/bolt.yaml                 # Not checked
```

This allows running Bolt from subdirectories while maintaining a single configuration file at the project root.

## Logging

All operations are logged to both console and a log file:

```
<project>/.bolt/logs/bolt_2024-01-15T10-30-00.log
```

Log files contain:
- Timestamp
- Bolt version
- Configuration path
- Ops/actions executed
- Step outputs
- Timing information
- Errors and warnings

## See Also
- [Plugin System](./plugin-system.md) - How plugins work
- [Runtime](./runtime.md) - Bun vs Node.js abstraction
