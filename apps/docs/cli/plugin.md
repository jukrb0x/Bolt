---
title: "bolt plugin"
---

Manage Bolt plugins.

## Usage

```bash
bolt plugin <command>
```

## Subcommands

| Command      | Description                            |
| ------------ | -------------------------------------- |
| `list`       | List loaded plugins and their handlers |
| `new <name>` | Scaffold a plugin                      |

## bolt plugin list

```bash
bolt plugin list
```

Prints the namespace and handler names for:

- Built-in plugins
- User plugins (`~/.bolt/plugins/`)
- Project plugins (`.bolt/plugins/`, then paths declared in `bolt.yaml`)

## bolt plugin new

```bash
bolt plugin new <name> [--user]
```

| Flag     | Description                                                         |
| -------- | ------------------------------------------------------------------- |
| `--user` | Create `~/.bolt/plugins/<name>/` instead of `.bolt/plugins/<name>/` |

The name must match `/^[a-z0-9_-]+$/`. Without `--user`, Bolt must find a `bolt.yaml` by walking up from the current directory.

The command writes two files:

- `index.ts` — `definePlugin` / `defineHandler` scaffold
- `package.json` — `zod` in `dependencies`, `boltstack` in `devDependencies`

It does not write `tsconfig.json` or a manifest file. The manifest is built in memory when the plugin loads. See [Plugin Development](/guides/plugin-development).

The command prints a `bun install` hint. You do not need a `bun` binary, and loading the plugin does not run that hint. While compiling `index.ts`, if `dependencies` is non-empty and `node_modules` is missing, the host runs this executable as `install` with `BUN_BE_BUN=1`. A prebuilt `index.js` is loaded without that install. Editor types come from the release asset `bolt.d.ts` (`declare module "boltstack"`).

## Examples

```bash
bolt plugin new myplugin
bolt plugin new myplugin --user
bolt plugin list
```

## See Also

- [Plugin Development](/guides/plugin-development) - Tutorial
- [Plugin System](/guides/plugin-system) - Discovery and host modules
- [Plugin API](/api/plugin-api) - API reference
