# Plugin API

Complete reference for the Bolt plugin API.

## Plugin Structure

A Bolt plugin is a TypeScript/JavaScript module that exports a `BoltPlugin` object:

```typescript
import type { BoltPlugin } from "bolt";

const plugin: BoltPlugin = {
  namespace: "myplugin",
  handlers: {
    handler1: async (params, ctx) => {
      // Handler implementation
    },
    handler2: async (params, ctx) => {
      // Handler implementation
    },
  },
};

export default plugin;
```

## Types

### BoltPlugin

```typescript
interface BoltPlugin {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
}
```

### BoltPluginHandler

```typescript
type BoltPluginHandler = (
  params: Record<string, string>,
  ctx: BoltPluginContext
) => Promise<void>;
```

### BoltPluginContext

```typescript
interface BoltPluginContext {
  cfg: BoltConfig;      // Full bolt.yaml configuration
  dryRun: boolean;      // True if --dry-run flag is set
  logger: BoltLogger;   // Logger instance
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

### BoltConfig

```typescript
interface BoltConfig {
  project: {
    name: string;
    engine_root: string;
    project_root: string;
    project_name: string;
    engine_vcs?: "git" | "svn";
    project_vcs?: "git" | "svn";
    git_branch?: string;
    use_tortoise?: boolean;
  };
  
  targets: Record<string, Target>;
  ops: Record<string, OpVariantMap>;
  actions: Record<string, Action>;
  "go-pipeline": GoPipeline;
  plugins: PluginEntry[];
  timeout_hours?: number;
  notifications?: NotificationsConfig;
}
```

## Parameters

Handlers receive parameters from the `with` block in `bolt.yaml`:

```yaml
ops:
  deploy:
    default:
      - uses: myplugin/deploy
        with:
          env: production
          region: us-east-1
          notify: true
```

```typescript
handlers: {
  deploy: async (params, ctx) => {
    const env = params.env;           // "production"
    const region = params.region;     // "us-east-1"
    const notify = params.notify;     // "true" (string!)
    
    // Note: All params are strings, convert as needed
    const shouldNotify = notify === "true";
  }
}
```

## Context Usage

### Accessing Configuration

```typescript
handlers: {
  build: async (params, ctx) => {
    const projectRoot = ctx.cfg.project.project_root;
    const engineRoot = ctx.cfg.project.engine_root;
    const projectName = ctx.cfg.project.project_name;
    
    // Use configuration values
    const projectFile = path.join(projectRoot, `${projectName}.uproject`);
  }
}
```

### Logging

```typescript
handlers: {
  deploy: async (params, ctx) => {
    ctx.logger.info("Starting deployment...");
    ctx.logger.debug(`Deploying to ${params.env}`);
    ctx.logger.warn("This is a warning");
    ctx.logger.error("This is an error");
  }
}
```

### Dry Run Support

Always check `ctx.dryRun` before executing side effects:

```typescript
handlers: {
  deploy: async (params, ctx) => {
    ctx.logger.info(`Deploying to ${params.env}...`);
    
    if (ctx.dryRun) {
      ctx.logger.info("Dry run - skipping deployment");
      return;
    }
    
    // Actual deployment logic
    await performDeployment(params.env);
  }
}
```

## Error Handling

Throw errors to fail the operation:

```typescript
handlers: {
  deploy: async (params, ctx) => {
    if (!params.env) {
      throw new Error("Missing required parameter: env");
    }
    
    if (!params.region) {
      throw new Error("Missing required parameter: region");
    }
    
    // Continue with deployment
  }
}
```

## Examples

### Slack Notification

```typescript
import type { BoltPlugin } from "bolt";

const plugin: BoltPlugin = {
  namespace: "slack",
  handlers: {
    notify: async (params, ctx) => {
      const webhook = params.webhook;
      const message = params.message ?? "Build complete";
      
      if (!webhook) {
        throw new Error("Missing required parameter: webhook");
      }
      
      ctx.logger.info(`Posting to Slack: ${message}`);
      
      if (!ctx.dryRun) {
        const response = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        });
        
        if (!response.ok) {
          throw new Error(`Slack API error: ${response.statusText}`);
        }
      }
    },
  },
};

export default plugin;
```

Usage:
```yaml
ops:
  notify:
    default:
      - uses: slack/notify
        with:
          webhook: https://hooks.slack.com/services/...
          message: "Build {{project.name}} complete!"
```

### AWS S3 Deployment

```typescript
import type { BoltPlugin } from "bolt";
import { $ } from "bun";

const plugin: BoltPlugin = {
  namespace: "deploy",
  handlers: {
    s3: async (params, ctx) => {
      const bucket = params.bucket;
      const buildPath = params.path;
      const region = params.region ?? "us-east-1";
      
      if (!bucket || !buildPath) {
        throw new Error("Missing required parameters: bucket, path");
      }
      
      ctx.logger.info(`Uploading ${buildPath} to s3://${bucket}`);
      
      if (!ctx.dryRun) {
        await $`aws s3 sync ${buildPath} s3://${bucket} --region ${region}`.quiet();
      }
    },
  },
};

export default plugin;
```

Usage:
```yaml
ops:
  deploy:
    production:
      - uses: deploy/s3
        with:
          bucket: my-game-builds
          path: Build/Shipping
          region: us-west-2
```

### Custom Build Step

```typescript
import type { BoltPlugin } from "bolt";
import { $ } from "bun";
import path from "path";

const plugin: BoltPlugin = {
  namespace: "custom",
  handlers: {
    compile: async (params, ctx) => {
      const projectRoot = ctx.cfg.project.project_root;
      const outputDir = params.output ?? "Binaries/Custom";
      const config = params.config ?? "Development";
      
      ctx.logger.info(`Compiling custom binaries (${config})...`);
      
      if (!ctx.dryRun) {
        const outputPath = path.join(projectRoot, outputDir);
        await $`mkdir -p ${outputPath}`.quiet();
        await $`my-compiler --config=${config} --output=${outputPath}`.quiet();
      }
    },
  },
};

export default plugin;
```

Usage:
```yaml
ops:
  build:
    with-custom:
      - uses: ue/build
        with:
          target: editor
      - uses: custom/compile
        with:
          output: Binaries/Custom
          config: Shipping
```

### File Processing

```typescript
import type { BoltPlugin } from "bolt";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const plugin: BoltPlugin = {
  namespace: "process",
  handlers: {
    replace: async (params, ctx) => {
      const file = params.file;
      const search = params.search;
      const replace = params.replace;
      
      if (!file || !search || !replace) {
        throw new Error("Missing required parameters: file, search, replace");
      }
      
      const filePath = path.join(ctx.cfg.project.project_root, file);
      
      ctx.logger.info(`Replacing in ${file}: ${search} → ${replace}`);
      
      if (!ctx.dryRun) {
        let content = readFileSync(filePath, "utf8");
        content = content.replace(new RegExp(search, "g"), replace);
        writeFileSync(filePath, content);
      }
    },
  },
};

export default plugin;
```

Usage:
```yaml
ops:
  patch:
    default:
      - uses: process/replace
        with:
          file: Config/DefaultEngine.ini
          search: "1.0.0"
          replace: "1.2.3"
```

## Best Practices

1. **Validate Parameters**: Check required parameters early
2. **Handle Dry Run**: Always respect `ctx.dryRun`
3. **Log Actions**: Use `ctx.logger` for feedback
4. **Throw Errors**: Fail fast with descriptive errors
5. **Use TypeScript**: Install `bolt-ue` for type safety
6. **Document Parameters**: Comment your handler signatures
7. **Test Thoroughly**: Test with `--dry-run` first

## Type Safety

Install type definitions:

```bash
cd .bolt/plugins/myplugin
bun add -d bolt-ue
```

This provides TypeScript types for the plugin API.

## Next Steps

- [Plugin Tutorial](/tutorial/plugins)
- [Handlers Reference](/api/handlers)
- [Configuration Reference](/api/config)
