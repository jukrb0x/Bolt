# Custom Ops

Create reusable operations for your workflow.

## What are Ops?

Ops are named, reusable steps that you can chain together with `bolt go`. Each op can have multiple variants for different use cases.

## Basic Ops

Define simple ops in `bolt.yaml`:

```yaml
ops:
  update:
    default:
      - uses: ue/update
  
  build:
    default:
      - uses: ue/build
        with:
          target: editor
  
  start:
    default:
      - uses: ue/start
```

Run them:

```bash
bolt go update build start
```

## Op Variants

Create multiple variants of the same op:

```yaml
ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
    
    debug:
      - uses: ue/build
        with:
          target: editor
          config: debug
    
    shipping:
      - uses: ue/build
        with:
          target: game-client
          config: shipping
```

Select variants at runtime:

```bash
bolt go build:debug
bolt go build:shipping
```

## Multi-Step Ops

Ops can chain multiple steps:

```yaml
ops:
  clean-rebuild:
    default:
      - uses: ue/kill
        continue-on-error: true
      - uses: ue/update
      - uses: ue/build
        with:
          target: editor
      - uses: ue/start
```

Run with a single command:

```bash
bolt go clean-rebuild
```

## Parameter Passing

Ops can receive inline parameters:

```yaml
ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
```

Override at runtime:

```bash
bolt go build --config=debug
bolt go build --target=game-client --config=shipping
```

Parameters are automatically shared across ops in the same command:

```bash
# Both build and start get config=shipping
bolt go build start --config=shipping
```

## Conditional Execution

Use `continue-on-error` to keep the pipeline running:

```yaml
ops:
  safe-kill:
    default:
      - uses: ue/kill
        continue-on-error: true  # Don't fail if no processes to kill
      - uses: ue/build
```

## Built-in Handlers

Bolt provides many built-in handlers:

| Handler | Description |
|---------|-------------|
| `ue/build` | Build editor or game target |
| `ue/start` | Launch UE editor or binary |
| `ue/kill` | Kill running UE processes |
| `ue/update` | Update source control |
| `ue/update-git` | Git pull |
| `ue/update-svn` | SVN update |
| `ue/svn-cleanup` | SVN cleanup |
| `ue/svn-revert` | Revert SVN changes |
| `ue/generate-project` | Regenerate project files |
| `ue/fillddc` | Fill Derived Data Cache |
| `ue/fix-dll` | Remove zero-byte DLLs |
| `fs/copy` | Copy files |
| `fs/move` | Move files |
| `fs/delete` | Delete files |
| `fs/mkdir` | Create directories |
| `json/set` | Modify JSON files |
| `json/merge` | Merge JSON files |

See the [Handlers Reference](/api/handlers) for complete documentation.

## Example: Complete Workflow

Here's a complete example with multiple ops and variants:

```yaml
ops:
  update:
    default:
      - uses: ue/update
    svn-only:
      - uses: ue/update-svn
    git-only:
      - uses: ue/update-git
  
  build:
    editor:
      - uses: ue/build
        with:
          target: editor
    client:
      - uses: ue/build
        with:
          target: game-client
    server:
      - uses: ue/build
        with:
          target: dedicated-server
  
  start:
    editor:
      - uses: ue/start
        with:
          target: editor
    game:
      - uses: ue/start
        with:
          target: game-client
  
  daily:
    default:
      - uses: ue/kill
        continue-on-error: true
      - uses: ue/update
      - uses: ue/build
        with:
          target: editor
      - uses: ue/start
```

Usage:

```bash
bolt go daily                    # Full daily workflow
bolt go build:client --config=shipping  # Build shipping client
bolt go update:svn-only build:editor     # Update SVN then build editor
```

## Next Steps

- [Learn about plugins](/tutorial/plugins)
- [Explore actions](/api/config#actions)
- [See all handlers](/api/handlers)
