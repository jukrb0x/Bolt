# Configuration Reference

Bolt reads `bolt.yaml` by walking up the directory tree from `cwd`. The first file found is used.

## Full Schema

```yaml
# Optional: abort if the entire run exceeds this duration
timeout_hours: 6

project:
  name: MyGame                        # (required) display name
  ue_path: C:/UnrealEngine            # (required) UE engine root
  project_path: C:/Projects/MyGame   # (required) project root (.uproject dir)
  project_name: MyGame               # (required) .uproject filename without extension
  svn_root: C:/Projects/svn          # optional, SVN working copy root
  git_branch: main                   # optional, branch for ue/update-git
  use_tortoise: true                 # optional: true=require, false=disable, absent=auto-detect

targets:
  <name>:
    kind: editor | program | game | client | server   # (required)
    name: string                                       # optional, binary name (for program/game)
    config: development | debug | shipping | test      # default: development

ops:
  <opName>:
    <variant>:                        # "default" is conventional for unqualified invocation
      - uses: ns/handler              # plugin handler reference
        with:
          key: value                  # params forwarded to handler (interpolated)
        continue-on-error: true       # optional, default false
      - run: shell command            # shell command (${{ }} interpolation applied)
        continue-on-error: false

go-pipeline:
  order:                              # op execution order for `bolt go`
    - kill
    - update
    - build
    - start
  fail_stops:                         # ops that abort the entire run on failure
    - build

actions:
  <name>:
    depends:                          # optional, other action names to run first
      - other-action
    steps:
      - uses: ns/handler
        with:
          key: value
      - uses: ops/<opName>            # delegate to an op's default variant
      - uses: ops/<opName>:<variant>  # delegate to a specific variant
      - run: echo hello

plugins:                              # explicit project-scope plugins
  - namespace: myplugin
    path: ./bolt-plugins/myplugin/index.ts

notifications:
  on_start: true
  on_complete: true
  on_failure: true
  providers:
    - type: wecom
      webhook_url: https://qyapi.weixin.qq.com/...
      chat_id: optional-group-id
    - type: telegram
      bot_token: "123456:ABC-DEF"
      chat_id: "-1001234567890"
```

## Interpolation

Use `${{ namespace.field }}` in `step.run` strings and `with:` values:

| Expression | Resolves to |
|---|---|
| `${{ project.name }}` | `cfg.project.name` |
| `${{ project.ue_path }}` | `cfg.project.ue_path` |
| `${{ project.project_path }}` | `cfg.project.project_path` |
| `${{ project.project_name }}` | `cfg.project.project_name` |
| `${{ project.svn_root }}` | `cfg.project.svn_root` |
| `${{ env.MY_VAR }}` | `process.env.MY_VAR` |

Unresolved expressions are left unchanged (safe passthrough).

## Validation

```
bolt check
```

Reports each schema error as `path → message`. Checks file existence, YAML syntax, and full Zod schema.
