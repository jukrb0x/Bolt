---
title: "Plugin System"
---

Bolt's handler system is fully extensible. A plugin is a TypeScript module that exports a `BoltPlugin` object — a namespace string and a map of async handler functions.

## Overview

Handlers are invoked by `uses:` steps in ops and actions:

```yaml
ops:
  deploy:
    default:
      - uses: myplugin/run
        with:
          env: staging
```

## Plugin Scopes

Plugins are discovered and registered in priority order. A later layer overwrites an earlier one for the same namespace.

| Priority | Scope | Location |
|---|---|---|
| 1 (lowest) | Built-in | Compiled into bolt binary |
| 2 | User | `~/.bolt/plugins/<namespace>/index.ts` |
| 3 | Project auto | `<project>/.bolt/plugins/<namespace>/index.ts` |
| 4 (highest) | Project explicit | Path declared in `bolt.yaml` under `plugins:` |

This lets you override any built-in handler by providing a plugin with the same namespace at a higher scope.

## Writing a Plugin

### 1. Scaffold

```bash
bolt plugin new myplugin           # project-scope
bolt plugin new myplugin --user    # user-scope
```

### 2. Install Types

```bash
cd .bolt/plugins/myplugin
bun install
```

This installs `boltstack` from npm, which provides `declare module "bolt"` so your editor resolves `import type { BoltPlugin } from "bolt"`.

### 3. Implement

```typescript
import type { BoltPlugin } from "bolt";

const plugin: BoltPlugin = {
  namespace: "myplugin",
  handlers: {
    deploy: async (params, ctx) => {
      const { env } = params;
      ctx.logger.info(`Deploying to ${env}...`);

      if (ctx.dryRun) {
        ctx.logger.info("[dry-run] skipping actual deploy");
        return;
      }

      const { project } = ctx.cfg;
      ctx.logger.info(`Project: ${project.name} at ${project.project_path}`);
    },
  },
};

export default plugin;
```

### 4. Register

**Project-scope auto-discovery**

If the plugin is at `.bolt/plugins/myplugin/index.ts`, it is discovered automatically — no `bolt.yaml` change needed.

**Explicit path**

For an explicit path (e.g. outside `.bolt/plugins/`):

```yaml
plugins:
  - namespace: myplugin
    path: ./tools/myplugin/index.ts
```

## Plugin API

### BoltPluginHandler

```typescript
type BoltPluginHandler = (
  params: Record<string, string>,
  ctx: BoltPluginContext,
) => Promise<void>;
```

`params` contains:
- Values from `with:` in the bolt.yaml step (after `${{ }}` interpolation)
- Overridden by any CLI-level params (`--key=val` passed to `bolt go` or `bolt run`)

### BoltPluginContext

```typescript
interface BoltPluginContext {
  cfg: BoltConfig;    // Full parsed bolt.yaml — project paths, targets, etc.
  dryRun: boolean;    // True if --dry-run was passed
  logger: BoltLogger; // Structured logger
}
```

### BoltLogger

```typescript
interface BoltLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}
```

## Built-in Plugins

See [Built-in Handlers](/api/built-in-handlers.md) for the full list of built-in `ue/`, `fs/`, and `json/` handlers.

## Type Package

Plugin types are published to npm as `boltstack`:

```bash
bun add -d boltstack
```

`boltstack` ships a single `bolt.d.ts` containing `declare module "bolt"`. The scaffolded `tsconfig.json` includes `"boltstack"` in `compilerOptions.types`, which activates the ambient declaration so `import type { BoltPlugin } from "bolt"` resolves correctly in any TS LSP.

## Overriding Built-ins

To override a built-in handler, create a plugin with the same namespace at a higher scope:

```typescript
// .bolt/plugins/ue/index.ts
import type { BoltPlugin } from "bolt";

const plugin: BoltPlugin = {
  namespace: "ue",
  handlers: {
    // Override the built-in build handler
    build: async (params, ctx) => {
      ctx.logger.info("Custom build logic...");
      // Your implementation
    },
  },
};

export default plugin;
```

Since project-scope plugins have higher priority than built-ins, your custom implementation will be used instead.

## See Also
- [Plugin API](/api/plugin-api.md) - API reference
- [Plugin Development Tutorial](/guides/plugin-development.md) - Step-by-step guide
- [Built-in Handlers](/api/built-in-handlers.md) - Existing handlers
