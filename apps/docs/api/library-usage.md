---
title: "Library Usage"
---

Bolt can also be used as a library for programmatic workflow automation. Both Bun and Node.js are supported.

## Installation

```bash
npm install boltstack
# or
bun add boltstack
```

## High-Level API

The public entry point is `run(taskName, opts)`, which runs a named **task** (via `runTask`). Params are applied to every step and override the step's `with:` values.

```typescript
import { run, createContext } from "boltstack";

// Run a named task
await run("build", {
  configPath: "./bolt.yaml",
  dryRun: false,
});

// Run a task with params (override `with:` values, same as --key=value)
await run("build", {
  configPath: "./bolt.yaml",
  params: { target: "client", config: "shipping" },
});

// Create a context for direct plugin calls (see below)
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

> **v2 change:** `go()`, `Action`, and `GoPipeline` are removed. Use `run(taskName, { params })` for tasks. To run a flow, use the `Runner` (see [Core Internals](#core-internals)).

### `run(taskName, opts)`

| Option | Type | Description |
|--------|------|-------------|
| `config` | `BoltConfig` | Pre-loaded config (mutually exclusive with `configPath`) |
| `configPath` | `string` | Path to `bolt.yaml` |
| `cwd` | `string` | Working directory for config discovery |
| `dryRun` | `boolean` | Skip actual execution |
| `params` | `Record<string, string>` | Params applied to every step (override `with:`) |
| `logger` | `Logger` | Custom logger |
| `runtime` | `Runtime` | Custom runtime |

## Direct Plugin Access

```typescript
import { git, fs, ue } from "boltstack/plugins";
import { createContext } from "boltstack";

const ctx = createContext({
  project: {
    name: "MyGame",
    engine_repo: { path: "C:/UnrealEngine", vcs: "git" },
    project_repo: { path: "C:/Projects/MyGame", vcs: "svn" },
    uproject: "C:/Projects/MyGame/MyGame.uproject",
  },
});

// Call plugin handlers directly
await git.handlers.pull({ path: "C:/UnrealEngine" }, ctx);
await fs.handlers.copy({ src: "C:/src/file.txt", dst: "C:/dest/file.txt" }, ctx);
```

## Core Internals

The `Runner` exposes `runTask` (a task) and `runFlow` (a flow). `run(name, params?)` is a back-compat alias for `runTask`.

```typescript
import { Runner, Logger, createRuntime } from "boltstack/core";
import { loadConfig } from "boltstack";

const config = await loadConfig("./bolt.yaml");
const logger = new Logger();
const runtime = createRuntime(); // Auto-detects Bun vs Node.js

const runner = new Runner(config, { logger, runtime });

await runner.runTask("build", { target: "client" });  // a task, with params
await runner.runFlow("daily");                          // a flow (fail-fast)
```

> `loadConfig` reads `bolt.yaml` **and** merges the sibling `bolt.local.yaml`; a missing/invalid local file throws. Use `checkConfig` to validate both without throwing.

## Public Exports

From `boltstack`:

| Export | Kind | Description |
|--------|------|-------------|
| `run` | function | Run a task by name |
| `createContext` | function | Build a `BoltPluginContext` for direct handler calls |
| `loadConfig` | function | Load + merge `bolt.yaml` and `bolt.local.yaml` |
| `checkConfig` | function | Validate config, returning errors (never throws) |
| `PluginBase`, `handler` | class / decorator | Author class-based plugins |
| `RunOptions`, `CreateContextOptions` | type | Option shapes |
| `BoltConfig`, `Project`, `RepoConfig`, `Target`, `Flow`, `Step` | type | Config types |
| `BoltPlugin`, `BoltPluginHandler`, `BoltPluginContext`, `BoltLogger` | type | Plugin types |

## Subpath Exports

| Export | Description |
|--------|-------------|
| `boltstack` | High-level API + config + plugin types (`run`, `createContext`, `loadConfig`, `checkConfig`) |
| `boltstack/plugins` | Built-in plugins (`git`, `svn`, `ue`, `fs`, `json`) |
| `boltstack/core` | Core internals (`Runner`, `Logger`, `buildRegistry`, `createRuntime`) |

## Runtime Compatibility

The library uses a runtime abstraction layer:
- **Bun**: uses native APIs (`Bun.spawn`, `Bun.YAML`)
- **Node.js**: uses `child_process` and the `yaml` package

The CLI is Bun-only for optimal performance, but the library works everywhere.

## TypeScript Support

The library ships TypeScript definitions for all public APIs.

```typescript
import type { BoltPlugin, BoltPluginContext, BoltLogger } from "boltstack";
```

## See Also
- [Plugin API](./plugin-api.md) — creating custom handlers
- [Config Schema](./config-schema.md) — configuration types
