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
```typescript
import { run, go, createContext } from "boltstack";

// Run a named action
await run("build", {
  configPath: "./bolt.yaml",
  dryRun: false
});

// Run ops through the pipeline
await go(["update", "build", "start"], {
  configPath: "./bolt.yaml"
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
await fs.handlers.copy({
  src: "C:/src/file.txt",
  dst: "C:/dest/file.txt"
}, ctx);
```

## Core Internals
```typescript
import { Runner, Logger, createRuntime } from "boltstack/core";
import { loadConfig } from "boltstack";

const config = await loadConfig("./bolt.yaml");
const logger = new Logger();
const runtime = createRuntime(); // Auto-detects Bun vs Node.js

const runner = new Runner(config, { logger, runtime });
await runner.run("build");
```

## Subpath Exports
| Export | Description |
|-------|-------------|
| `boltstack` | High-level API (run, go, createContext, loadConfig) |
| `boltstack/plugins` | Built-in plugins (git, svn, ue, fs, json) |
| `boltstack/core` | Core internals (Runner, Logger, createRuntime) |

## Runtime Compatibility
The library uses a runtime abstraction layer:
- **Bun**: Uses native APIs (Bun.spawn, Bun.YAML)
- **Node.js**: Uses child_process and yaml package

The CLI remains Bun-only for optimal performance, but the library works everywhere.

## TypeScript Support
The library includes TypeScript definitions for all public APIs.

```typescript
import type { BoltPlugin, BoltPluginContext, BoltLogger } from "boltstack";
```

## See Also
- [Getting Started](/guides/getting-started.md) - Introduction to Bolt
- [Plugin API](./plugin-api.md) - Creating custom handlers
