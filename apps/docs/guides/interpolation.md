---
title: "Interpolation"
description: "Use template syntax to dynamically insert values into steps."
---

Use `${{ expression }}` template syntax to inject values into your steps.

## Syntax

Interpolation is applied to two places in a step:

- `run:` — the shell command string
- `with:` — every value passed to a handler

```yaml
tasks:
  package:
    - uses: ue/build
      with:
        target: ${{ params.target }}
    - run: echo "Built ${{ project.name }} from ${{ project.engine_repo.path }}"
```

Values are resolved just before the step executes. An expression that can't be resolved is left **unchanged** (safe passthrough).

## Available context

Four namespaces are available in every step:

| Namespace | Resolves to | Source |
|-----------|-------------|--------|
| `${{ project.* }}` | The merged runtime `project` | `bolt.yaml` identity + `bolt.local.yaml` paths |
| `${{ vars.* }}` | Shared vars (local overrides applied) | `bolt.yaml` `vars` + `bolt.local.yaml` `vars` |
| `${{ env.* }}` | Environment variables | `process.env` |
| `${{ params.* }}` | Run parameters | `--key=value` on `bolt run` |

### project

`project` is the **merged** runtime shape (see [merged runtime shape](/api/config-schema.md#merged-runtime-shape)), so machine paths authored in `bolt.local.yaml` are available here:

| Expression | Resolves to |
|------------|-------------|
| `${{ project.name }}` | Project name |
| `${{ project.engine_repo.path }}` | Local engine path (from `engine_path`) |
| `${{ project.engine_repo.branch }}` | Engine branch |
| `${{ project.project_repo.path }}` | Local project path (from `project_path`) |
| `${{ project.uproject }}` | Absolute `.uproject` path |

Extra scalar fields on the `bolt.yaml` `project` block also pass through as `${{ project.<key> }}`.

### vars

```yaml
# bolt.yaml
vars:
  region: us-east-1
```

```yaml
tasks:
  deploy:
    - uses: myplugin/deploy
      with:
        region: ${{ vars.region }}
```

### env

```yaml
tasks:
  deploy:
    - run: ./deploy.sh ${{ env.BUILD_VERSION }}
```

```bash
export BUILD_VERSION="1.2.3"
bolt run deploy
```

### params (new in v2)

Pass parameters to the whole run with `--key=value`. Params **override** matching `with:` values on every step in the run.

```yaml
tasks:
  build:
    - uses: ue/build
      with:
        target: editor          # default; overridden if --target is passed
        config: ${{ params.config }}
```

```bash
bolt run build --target=client --config=debug
```

Here `--target=client` overrides the `with.target`, and `${{ params.config }}` resolves to `debug`.

## Combining expressions

Mix multiple expressions in one value:

```yaml
tasks:
  notify:
    - uses: myplugin/notify
      with:
        message: "Build ${{ project.name }} completed"
        chat_id: ${{ env.TELEGRAM_CHAT_ID }}
```

Result: `Build MyProject completed` (assuming `TELEGRAM_CHAT_ID` is set).

## Unresolved expressions

If a path doesn't resolve to a scalar value (missing key, or it points at an object), the original `${{ ... }}` text is left untouched. Nothing is thrown — check your output if a value looks wrong.

## See Also

- [bolt.yaml Guide](./bolt-yaml.md) — configuration walkthrough
- [Config Schema](/api/config-schema.md) — field reference and merged runtime shape
