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
- `package.json` - Dependencies (`zod` and `boltstack`)

Bolt builds a manifest from this file when the plugin loads. Do not add a JSON or YAML manifest.

## Step 2: Install Dependencies

```bash
cd .bolt/plugins/myplugin
bun install
```

This installs `boltstack` and `zod`.

## Step 3: Implement Plugin

`bolt plugin new` writes `index.ts` in this shape. `definePlugin` returns the plugin object:

```typescript
import { defineHandler, definePlugin } from "boltstack";
import type { BoltPluginContext } from "boltstack";
import { z } from "zod";

export default definePlugin({
  namespace: "myplugin",
  version: "0.1.0",
  description: "TODO: describe your plugin",
  handlers: {
    run: defineHandler(
      {
        description: "Run ${input}",
        params: z.object({
          input: z.string().describe("Input value to process"),
        }),
      },
      async (params, ctx: BoltPluginContext) => {
        ctx.logger.info(`myplugin/run called with: ${JSON.stringify(params)}`);
      },
    ),
  },
});
```

`description` is the task-line template (`${input}` is replaced with the step's `with:` value). `ai` defaults to `false`. Set `true` to list the handler for agents, or `"confirm"` to mark it as something the user runs themselves. `"confirm"` is metadata only; `bolt run` does not prompt. Params are a flat zod object: `z.string()`, `z.enum()`, `z.coerce.number()`, `z.coerce.boolean()`, plus `.optional()`, `.default()`, and `.describe()`. Bolt checks them before the handler runs.

Class plugins still work. Keep `@handler("...")`, or use `@handler({ description, ai, params, alias })`. Plugin-level fields go through `PluginBase.withDescriptor({ namespace, version, description, metadata })`, not through `definePlugin`. `onInit`, `onBeforeStep`, and `onAfterStep` stay on the instance.

## Step 4: Use in bolt.yaml

Add a task that uses your handler and reuses the built-in `build` task with `call`:

```yaml
tasks:
  build: [{ uses: ue/build, with: { target: editor } }]
  ci:
    - call: build
    - uses: myplugin/run
      with:
        input: npm test
```

## Step 5: Test the Plugin

```bash
bolt run ci --dry-run
```

Expected output:

```
[dry-run] ue/build target=editor
[dry-run] myplugin/run input=npm test
```

Run without `--dry-run` to execute for real:

```bash
bolt run ci
```

## Complete Plugin Example

A second handler can set `ai` and coerce a number. The manifest still comes from this code:

```typescript
import { defineHandler, definePlugin } from "boltstack";
import type { BoltPluginContext } from "boltstack";
import { z } from "zod";

export default definePlugin({
  namespace: "deploy",
  version: "0.1.0",
  description: "Ship a build",
  handlers: {
    run: defineHandler(
      {
        description: "Deploy ${bucket}",
        ai: "confirm",
        params: z.object({
          bucket: z.string().describe("Destination bucket"),
          retries: z.coerce.number().default(1),
        }),
      },
      async (params, ctx: BoltPluginContext) => {
        ctx.logger.info(`Deploying to ${params.bucket} (${params.retries} retries)`);
        if (ctx.dryRun) return;
      },
    ),
  },
});
```

## Testing the Plugin

```bash
cd .bolt/plugins/deploy
bun install
```

Add a task that calls the handler, then run it. Params passed on the command line override the step's `with:` values:

```yaml
tasks:
  ship: [{ uses: deploy/run, with: { bucket: my-bucket } }]
```

```bash
bolt run ship --bucket=my-bucket --dry-run
```

## See Also

- [Plugin API](/api/plugin-api.md) - API reference
- [Plugin System](/guides/plugin-system.md) - How plugins work
