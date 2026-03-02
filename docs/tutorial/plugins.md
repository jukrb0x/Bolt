# Plugins

Extend Bolt with custom functionality.

## What are Plugins?

Plugins let you add custom handlers that work just like built-in ones. You can:

- Add new operations (e.g., deploy builds, send notifications)
- Override built-in behavior
- Share functionality across projects

## Plugin Scopes

Bolt loads plugins from multiple locations in priority order:

| Scope | Location | Priority |
|-------|----------|----------|
| Built-in | Compiled into bolt | Lowest |
| User | `~/.bolt/plugins/<name>/` | ↑ |
| Project auto | `.bolt/plugins/<name>/` | ↑ |
| Project explicit | Declared in `bolt.yaml` | Highest |

Higher-priority plugins override lower ones for the same namespace.

## Creating a Plugin

### Step 1: Scaffold

Create a new plugin:

```bash
cd your-project-root
bolt plugin new myplugin
```

This creates `.bolt/plugins/myplugin/` with:

```
.bolt/plugins/myplugin/
├── index.ts
├── package.json
└── tsconfig.json
```

### Step 2: Implement

Edit `.bolt/plugins/myplugin/index.ts`:

```typescript
import type { BoltPlugin } from "bolt";

const plugin: BoltPlugin = {
  namespace: "myplugin",
  handlers: {
    deploy: async (params, ctx) => {
      const env = params.env ?? "staging";
      ctx.logger.info(`Deploying to ${env}...`);
      
      if (!ctx.dryRun) {
        // Your deployment logic here
        // await runDeployScript(env);
      }
    },
    
    notify: async (params, ctx) => {
      const message = params.message ?? "Build complete";
      ctx.logger.info(`Sending notification: ${message}`);
      
      if (!ctx.dryRun) {
        // Send notification (Slack, Discord, etc.)
        // await sendSlackMessage(message);
      }
    },
  },
};

export default plugin;
```

### Step 3: Use It

Add to `bolt.yaml`:

```yaml
ops:
  deploy:
    default:
      - uses: myplugin/deploy
        with:
          env: production
```

Run:

```bash
bolt go build deploy
```

## Plugin Context

Handlers receive a context object:

```typescript
interface BoltPluginContext {
  cfg: BoltConfig;      // Full bolt.yaml config
  dryRun: boolean;      // True if --dry-run
  logger: BoltLogger;   // Logger instance
}

interface BoltLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}
```

## Parameters

Handlers receive parameters from the `with` block:

```yaml
ops:
  deploy:
    default:
      - uses: myplugin/deploy
        with:
          env: staging
          region: us-east-1
          notify: true
```

```typescript
handlers: {
  deploy: async (params, ctx) => {
    const env = params.env;           // "staging"
    const region = params.region;     // "us-east-1"
    const notify = params.notify;     // true (parsed as boolean)
    
    // ...
  }
}
```

## Type Safety

Install type definitions:

```bash
cd .bolt/plugins/myplugin
bun add -d bolt-ue
```

This provides TypeScript types for the plugin API.

## User-Scope Plugins

Create plugins available to all projects:

```bash
bolt plugin new myplugin --user
```

This creates `~/.bolt/plugins/myplugin/`.

## Explicit Plugin Declaration

Load plugins from custom locations:

```yaml
plugins:
  - namespace: custom
    path: ./custom-plugins/my-plugin
```

## Example: Slack Notifications

```typescript
import type { BoltPlugin } from "bolt";

const plugin: BoltPlugin = {
  namespace: "slack",
  handlers: {
    notify: async (params, ctx) => {
      const webhook = params.webhook;
      const message = params.message ?? "Build complete";
      
      ctx.logger.info(`Posting to Slack: ${message}`);
      
      if (!ctx.dryRun) {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        });
      }
    },
  },
};

export default plugin;
```

Usage:

```yaml
ops:
  notify-team:
    default:
      - uses: slack/notify
        with:
          webhook: https://hooks.slack.com/services/...
          message: "Build {{project.name}} complete!"
```

## Example: Build Deployment

```typescript
import type { BoltPlugin } from "bolt";
import { $ } from "bun";

const plugin: BoltPlugin = {
  namespace: "deploy",
  handlers: {
    s3: async (params, ctx) => {
      const bucket = params.bucket;
      const buildPath = params.path;
      
      ctx.logger.info(`Uploading ${buildPath} to s3://${bucket}`);
      
      if (!ctx.dryRun) {
        await $`aws s3 sync ${buildPath} s3://${bucket}`.quiet();
      }
    },
  },
};

export default plugin;
```

## Best Practices

1. **Handle dry-run**: Always check `ctx.dryRun` before executing
2. **Log actions**: Use `ctx.logger` to provide feedback
3. **Validate params**: Check required parameters early
4. **Error handling**: Throw descriptive errors
5. **Type safety**: Use TypeScript and install `bolt-ue` types

## Next Steps

- [Explore the plugin API](/api/plugin-api)
- [See built-in handlers](/api/handlers)
- [Learn about configuration](/api/config)
