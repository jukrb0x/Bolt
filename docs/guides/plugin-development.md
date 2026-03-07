---
title: "Plugin Development"
---

Build a custom Bolt plugin from scratch.

## Prerequisites
- Bolt installed (`bolt plugin new` command available)
- Basic TypeScript knowledge
- Understanding of Bolt's plugin system

## Step 1: Create Plugin

Use the `bolt plugin new` command to scaffold a new plugin:

```bash
bolt plugin new myplugin
```

This creates a directory at `.bolt/plugins/myplugin/` with:
- `index.ts` - Plugin entry point
- `package.json` - Dependencies
- `tsconfig.json` - TypeScript configuration

```

## Step 2: Install Dependencies

```bash
cd .bolt/plugins/myplugin
bun install
```

This installs the `bolt-ue` package, which provides TypeScript definitions for the plugin API.

## Step 3: Implement Plugin
Edit `index.ts`:

```typescript
import type { BoltPlugin } from "bolt";

const plugin: BoltPlugin = {
  namespace: "myplugin",
  handlers: {
    // Handler: runs a custom command
    run: async (params, ctx) => {
      const { command, args } = params;
      ctx.logger.info(`Running: ${command} ${args?.join(" ")}`);

      if (ctx.dryRun) {
        ctx.logger.info("[dry-run] skipping execution");
        return;
      }

      // Execute the command
      const { execa } = require("child_process");
      return new Promise((resolve, reject) => {
        const proc = execa(command, args.split(" "), {
          cwd: ctx.cfg.project.project_path,
          stdio: "inherit",
        });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Command failed with code ${code}`));
        });
      });
    },

    // Handler: sends a notification
    notify: async (params, ctx) => {
      const { message, webhook_url } = params;
      ctx.logger.info(`Sending notification: ${message}`);

      if (ctx.dryRun) {
        ctx.logger.info("[dry-run] skipping notification");
        return;
      }

      // Send notification via webhook
      // Implementation depends on your notification service
    },
  },
};

export default plugin;
```

## Step 4: Use in bolt.yaml
Add to your project's `ops` section:

```yaml
ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
    ci:
      - uses: ue/build
        with:
          target: editor
      - uses: myplugin/run
        with:
          command: npm test
      - uses: myplugin/notify
        with:
          message: "CI build complete"
          webhook_url: ${{env.SLACK_WEBHOOK}}
```

## Step 5: Test the Plugin
```bash
bolt go build:ci --dry-run
```

Expected output:
```
[dry-run] ue/build target=editor
[dry-run] myplugin/run command=npm test
[dry-run] myplugin/notify message=CI build complete
```

Run without `--dry-run` to execute for real:

 ```bash
bolt go build:ci
```

## Complete Plugin Example
Here's a more comprehensive example with error handling:

```typescript
import type { BoltPlugin } from "bolt";

const plugin: BoltPlugin = {
  namespace: "deploy",
  handlers: {
    "to-s3": async (params, ctx) => {
      const { bucket, region = params;

      ctx.logger.info(`Deploying to S3`);
      ctx.logger.info(`Bucket: ${bucket}`);
      ctx.logger.info(`Region: ${region}`);

      if (ctx.dryRun) {
        ctx.logger.info("[dry-run] skipping deployment");
        return;
      }

      const { project } = ctx.cfg;
      const buildPath = `./Builds/${project.name}`;

      // Upload to S3
      const { S3Client } = require("@aws-sdk/client-s3");
      const client = new S3Client({ region });

      const files = await fs.promises.readdir(buildPath);
      for (const file of files) {
        ctx.logger.info(`Uploading ${file}`);
        await client.putObject({
          Bucket: bucket,
          Key: `${project.name}/${file}`,
          Body: await fs.promises.readFile(`${buildPath}/${file}`),
        });
      }

      ctx.logger.info("Deployment complete");
    },

    notify: async (params, ctx) => {
      const { message, channel } = params;

      ctx.logger.info(`Sending notification: ${message}`);

      if (ctx.dryRun) {
        return;
      }

      // Send Slack notification
      const { WebClient } = require("@slack/web-api");
      const client = new WebClient(process.env.SLACK_TOKEN);

      await client.chat.postMessage({
        channel,
        text: message,
      });
    },
  },
};

export default plugin;
```

## Testing Loc Plugin
```bash
# Install dependencies
cd .bolt/plugins/deploy
bun install @aws-sdk/client-s3 @slack/web-api

# Test the plugin
bolt go deploy --bucket=my-bucket --region=us-east-1 --dry-run
```

## See Also
- [Plugin API](/api/plugin-api.md) - API reference
- [Plugin System](/guides/plugin-system.md) - How plugins work
