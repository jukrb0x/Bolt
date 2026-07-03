---
title: "Commands"
---

## bolt go

Run one or more ops in pipeline order.

```
bolt go <op...> [--dry-run] [--<op>=<variant>] [--key=val]
```

Op tokens can be bare words or `--` flags — these are equivalent:

```
bolt go update build start
bolt go --update --build --start
```

### Variant selection

Each op can have named variants. Select one with `:` or `=`:

```
bolt go update:svn          # colon syntax
bolt go --update=svn        # flag syntax
```

If the variant name doesn't match any defined variant, the `default` variant is used with `with.target` overridden to that value in each step:

```
bolt go --build=client      # no "client" variant → uses "default" steps with target=client
```

### Inline params

Pass per-op params after the op token. These override `with:` values in YAML (CLI wins):

```
bolt go build --config=debug --platform=Win64
bolt go build start --config=shipping
```

**Shared params** (`config`, `platform`) propagate forward and backward across all ops:

```
bolt go update build start --config=debug
# config=debug applies to update, build, and start
```

**Config shortcuts:** `dev` → `development`, `dbg` → `debug`

### Pipeline order

`bolt go` always executes ops in the order defined in `go-pipeline.order`, regardless of the order they are typed:

```
bolt go start build    # executes build first, then start
```

Ops not in the pipeline order run last, preserving their relative order.

### Failure behaviour

- Ops in `go-pipeline.fail_stops` abort the entire run if they fail.
- All other ops log a warning and continue.

### Flags

| Flag | Description |
|---|---|
| `--dry-run` | Print what would run without executing |

---

## bolt run

Run a named action from bolt.yaml.

```
bolt run <action> [--dry-run] [--key=val]
```

Extra `--key=val` flags are forwarded as params to every step in the action (and its dependencies). CLI params win over `with:` values in YAML.

Action dependencies (declared under `depends:`) run first, depth-first, with cycle detection.

---

## bolt list

List all ops and actions defined in bolt.yaml.

```
bolt list
```

Shows each op with its non-default variants, and each action name.

---

## bolt info

Print project and VCS configuration summary.

```
bolt info
```

Shows: project fields, targets, ops (with variants), actions.

---

## bolt check

Validate bolt.yaml against the schema.

```
bolt check
```

Exits 0 if valid. Exits 1 and lists errors (`path → message`) if not.

---

## bolt version

Print the current bolt version.

```
bolt version
```

---

## bolt self-update

Download and replace the bolt binary with the latest GitHub release.

```
bolt self-update [--force]
```

| Flag | Description |
|---|---|
| `--force` | Re-download even if already up to date |

Only works in the compiled binary (not `bun run src/main.ts`). Replaces the binary in-place via atomic rename. The temp file is written to the same directory as the binary to avoid cross-device rename errors.

---

## bolt plugin list

List all active plugins and their handlers.

```
bolt plugin list
```

Shows namespace and handler names for all discovered plugins (built-in, user-scope, project-scope).

---

## bolt plugin new

Scaffold a new plugin.

```
bolt plugin new <name> [--user]
```

| Flag | Description |
|---|---|
| `--user` | Create in user scope (`~/.bolt/plugins/`) instead of project scope |

Name must match `/^[a-z0-9_-]+$/`.

Creates `index.ts`, `tsconfig.json`, and `package.json` in the plugin directory. Run `bun install` in the created directory to set up IDE type support.

See [plugins.md](./plugins.md) for the full plugin authoring guide.
