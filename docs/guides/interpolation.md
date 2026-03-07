---
title: "Interpolation"
description: "Use template syntax to dynamically insert values in your configuration."
---

Use template syntax to dynamically insert values in your configuration.

## Syntax

Bolt uses `${{ expression }}` interpolation in YAML values:

```yaml
output: ./Builds/${{ project.name }}
```

## Available Expressions

| Expression | Resolves to |
|------------|-------------|
| `${{ project.name }}` | `cfg.project.name` |
| `${{ project.ue_path }}` | `cfg.project.ue_path` |
| `${{ project.project_path }}` | `cfg.project.project_path` |
| `${{ project.project_name }}` | `cfg.project.project_name` |
| `${{ project.svn_root }}` | `cfg.project.svn_root` |
| `${{ env.MY_VAR }}` | `process.env.MY_VAR` |

Unresolved expressions are left unchanged (safe passthrough).

## Usage Examples

### Environment Variables

```yaml
ops:
  deploy:
    default:2
      - run: ./deploy.sh
        env:
          VERSION: ${{ env.BUILD_VERSION }}
          ENVIRONMENT: ${{ env.DEPLOY_ENV }}
```

```bash
export BUILD_VERSION="1.2.3"
export DEPLOY_ENV="production"
bolt go deploy
```

### Project Configuration

```yaml
ops:
  package:
    default:
      - uses: ue/package-game
        with:
          target: game
          output: ./Builds/${{ project.name }}
```

Result: `./Builds/MyGame`

### Custom Parameters

Pass custom parameters from CLI.

```yaml
ops:
  deploy:
    default:
      - uses: myplugin/deploy
        with:
          env: ${{ params.env }}
          region: ${{ params.region }}
```

```bash
bolt go deploy env=staging region=us-east-1
```

The `${{ params.env }}` resolves to `staging` and `${{ params.region }}` resolves to `us-east-1`.

## Combining Expressions

Mix multiple expressions in a single value.

```yaml
ops:
  notify:
    default:
      - uses: telegram/notify
        with:
          message: "Build ${{ project.name }} completed"
          chat_id: ${{ env.TELEGRAM_CHAT_ID }}
```

Result: `Build MyGame completed` (assuming `TELEGRAM_CHAT_ID` is set)

## Escaping

Use `\${{ }}` to include literal `${{ }}` in output.

```yaml
ops:
  script:
    default:
      - run: |
          echo "Project: ${{ project.name }}"
          echo "Template syntax: \${{ project.name }}"
```

Result:
```bash
Project: MyGame
Template syntax: ${{ project.name }}
```

## See Also

- [bolt.yaml Reference](./bolt-yaml.md) - Configuration schema
- [Ops](/api/config-schema.md) - Ops configuration
