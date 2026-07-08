---
title: "Plugin API"
---

Bolt's plugin system allows you to extend functionality with custom handlers.

## BoltPlugin Interface

```typescript
interface BoltPlugin {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
}
```

### namespace
The unique identifier for your plugin. Used in `uses:` steps as `myplugin/handler-name`.

```typescript
namespace: "myplugin"
```

### handlers
A map of handler names to handler functions.

```typescript
handlers: {
  deploy: async (params, ctx) => { /* ... */ },
  notify: async (params, ctx) => { /* ... */ },
}
```

## BoltPluginHandler Type
```typescript
type BoltPluginHandler = (
  params: Record<string, string>,
  ctx: BoltPluginContext
) => Promise<void>;
```

### params
Values from `with:` in the bolt.yaml step (after `${{ }}` interpolation), overridden by CLI-level params.

```yaml
- uses: myplugin/deploy
  with:
    env: staging
    region: us-east
```

### ctx
The BoltPluginContext provides access to configuration, logging, and execution state.

## BoltPluginContext Interface
```typescript
interface BoltPluginContext {
  cfg: BoltConfig;
  configDir: string;
  dryRun: boolean;
  logger: BoltLogger;
  runtime: Runtime;
}
```

### cfg
The merged runtime configuration (`bolt.yaml` + `bolt.local.yaml`).

```typescript
cfg: {
  project: {
    name: "MyGame";
    engine_repo:  { path: "C:/UnrealEngine", vcs: "git" };
    project_repo: { path: "C:/Projects/MyGame", vcs: "svn" };
    uproject: "C:/Projects/MyGame/MyGame.uproject";
    // ... other merged project fields
  };
  targets: { /* ... */ };
  tasks: { /* ... */ };
  flows: { /* ... */ };
}
```

### configDir
Directory containing `bolt.yaml`. Use it to resolve relative paths.

### runtime
Runtime abstraction (`spawn`/`spawnSync`/`shell`/`parseYaml`) that works on both Bun and Node.js.

### dryRun
True if `--dry-run` was passed. Use to skip actual execution.

```typescript
if (ctx.dryRun) {
  ctx.logger.info("[dry-run] skipping actual deploy");
  return;
}
```

### logger
Structured logger for output.

## BoltLogger Interface
```typescript
interface BoltLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  cmd(msg: string): void;
}
```

## Complete Example
```typescript
import type { BoltPlugin } from "boltstack";

const plugin: BoltPlugin = {
  namespace: "deploy",
  handlers: {
    to_s3: async (params, ctx) => {
      const { bucket, region } = params;

      ctx.logger.info(`Deploying to S3 bucket: ${bucket}`);
      ctx.logger.info(`Region: ${region}`);

      if (ctx.dryRun) {
        ctx.logger.info("[dry-run] skipping upload");
        return;
      }

      const { project } = ctx.cfg;
      ctx.logger.info(`Project: ${project.name}`);

      // Upload to S3...
    },

    notify: async (params, ctx) => {
      const { message } = params;

      ctx.logger.info(`Sending notification: ${message}`);

      // Send notification...
    },
  },
};

export default plugin;
```

## Using in bolt.yaml
```yaml
tasks:
  deploy:
    - uses: deploy/to_s3
      with:
        bucket: my-game-builds
        region: us-east-1
    - uses: deploy/notify
      with:
        message: "Deploy complete!"
```

## Type Package

Plugin types are available via the `boltstack` npm package:

```bash
bun add -d boltstack
```

This provides the type declarations for `boltstack` and `boltstack/plugins` for editor autocompletion.

## See Also
- [Plugin System](/guides/plugin-system.md) - How plugins work
- [Built-in Handlers](./built-in-handlers.md) - Reference for existing handlers
- [Plugin Development Tutorial](/guides/plugin-development.md) - Step-by-step guide
