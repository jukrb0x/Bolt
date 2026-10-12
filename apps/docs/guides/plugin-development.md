---
title: "Plugin Development"
---

A plugin is a TypeScript module. Bolt builds its manifest in memory from `defineHandler` or `@handler`. There is no manifest file to write.

## Prerequisites

- Bolt installed (`bolt plugin new` is on the binary)
- A project `bolt.yaml` when you want a project-scope plugin
- The release `bolt.d.ts` if you want editor completion (`declare module "boltstack"`)

You do not install Bun. The `bolt` binary compiles plugin TypeScript itself.

## Step 1: Create the plugin

```bash
bolt plugin new myplugin
```

That creates `.bolt/plugins/myplugin/` with `index.ts` and `package.json`. It does not write `tsconfig.json`.

`package.json` lists `zod` under `dependencies` and `boltstack` under `devDependencies`:

```json
{
  "name": "myplugin",
  "type": "module",
  "dependencies": {
    "zod": "^3"
  },
  "devDependencies": {
    "boltstack": "latest"
  }
}
```

`boltstack` stays a devDependency so the plugin does not ship its own runtime copy. User scope is `bolt plugin new myplugin --user`, which writes `~/.bolt/plugins/myplugin/`. The name must match `/^[a-z0-9_-]+$/`. Project scope requires a `bolt.yaml` above the current directory.

## Step 2: Dependencies and types

`bolt plugin new` prints a `bun install` hint for editor packages. Do not install a `bun` binary to follow it. When a plugin directory has `dependencies` and no `node_modules`, Bolt runs its own executable as `install` with `BUN_BE_BUN=1` before compiling.

At load time the host publishes one `boltstack` module and one `zod` module. Plugin imports of those names resolve to those instances. The compiler marks both as external, so a copy under the plugin's `node_modules` is not bundled in.

For editor types, download `bolt.d.ts` from the same [GitHub release](https://github.com/jukrb0x/Bolt/releases) as your binary and place it where TypeScript can see `declare module "boltstack"`. The scaffold tells you to put that file at the project root.

## Step 3: Implement

`bolt plugin new` writes this `index.ts`. `definePlugin` returns the plugin:

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

`definePlugin` stamps `Symbol.for("boltstack.plugin")` and `apiVersion` `1`. Omit `apiVersion` and the host still stamps `1`. Any other number is rejected. The manifest is the object built from each `defineHandler`: description template, `ai` (default `false`), and the flat zod params. `"confirm"` is metadata only. `bolt run` does not prompt.

Params are a flat `z.object` of `z.string()`, `z.enum()`, `z.coerce.number()`, and `z.coerce.boolean()`, plus `.optional()`, `.default()`, and `.describe()`. Bolt checks them before the handler runs. `${input}` in `description` is replaced with the step's `with:` value.

Class plugins still work. Decorate methods with `@handler("...")` or `@handler({ description, ai, params, alias })`. Pass plugin fields to `PluginBase.withDescriptor({ namespace, version, description, metadata })`. `onInit`, `onBeforeStep`, and `onAfterStep` stay on the instance and are not part of the manifest. The host compiles those files with legacy decorators (`experimentalDecorators`, `useDefineForClassFields: false`). It does not read a project `tsconfig` for that.

## Step 4: Call it from bolt.yaml

Core `bolt.yaml` is generic `version: 1`. `project` is a name. Do not put `targets` at the root. Unreal metadata, including `targets`, lives only on the `ue` plugin. A plugin under `.bolt/plugins/myplugin/` is loaded without a `plugins:` entry. An explicit path looks like this:

```yaml
version: 1

project:
  name: MyProject

plugins:
  - namespace: ue
    config:
      engine:
        path: D:/UE
        vcs: git
      project:
        path: D:/Games/MyProject
        vcs: svn
      uproject: D:/Games/MyProject/MyProject.uproject
      targets:
        editor:
          kind: editor
          config: development

tasks:
  build: [{ uses: ue/build, with: { target: editor } }]
  ci:
    - call: build
    - uses: myplugin/run
      with:
        input: npm test
```

## Step 5: Run it

```bash
bolt run ci --dry-run
```

The runner prints the task and each resolved step. Params are `key=value`, separated by two spaces:

```text
Tasks: ci (dry-run)
>> ci
   · ue/build  target=editor
   · myplugin/run  input=npm test
<< ci: SUCCESS
```

The handler still runs. The scaffold logs `[INFO] myplugin/run called with: {"input":"npm test"}`. `ue/build` logs the command it would run and does not launch it while `--dry-run` is set.

```bash
bolt run ci
```

## A second handler

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

```yaml
tasks:
  ship: [{ uses: deploy/run, with: { bucket: my-bucket } }]
```

```bash
bolt run ship --bucket=my-bucket --dry-run
```

CLI params override the step's `with:` values.

## See Also

- [Plugin API](/api/plugin-api) - `definePlugin`, brand, and context
- [Plugin System](./plugin-system.md) - Load order and the host modules
- [bolt plugin](/cli/plugin) - `list` and `new`
