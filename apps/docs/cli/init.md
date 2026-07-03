---
title: "bolt init"
---

Initialize a new bolt.yaml with interactive Q&A.

## Usage

```bash
bolt init [location] [options]
```

## Description

Creates a new `bolt.yaml` configuration file through an interactive question-and-answer process. The command asks about your project structure (UE path, project path, version control) and generates a config with sensible defaults.

## Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `[location]` | Current directory | `.` for CWD, or folder name to create |

## Options

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--template <path>` | `-t` | Built-in template | Path to template YAML file |
| `--remote <url>` | `-r` | - | URL to remote template |
| `--yes` | `-y` | `false` | Skip Q&A, use defaults |

## Examples

```bash
# Interactive setup in current directory
bolt init

# Interactive setup in current directory (explicit)
bolt init .

# Create a new project folder and initialize
bolt init MyGame

# Use a custom template
bolt init --template ./templates/team-bolt.yaml

# Use a remote template
bolt init --remote https://example.com/bolt-template.yaml

# Non-interactive mode with defaults
bolt init --yes
bolt init MyGame -y
```

## Template System

Templates can include an `_init` section to define custom questions:

```yaml
_init:
  project_name:
    prompt: "Project name"
    default: "my-project"

  engine_vcs:
    prompt: "Engine VCS"
    type: select
    options: [git, svn]
    default: git

  engine_branch:
    prompt: "Engine branch"
    default: main
    condition: "engine_vcs == 'git'"
```

Question properties:
- `prompt`: Question text shown to user
- `type`: `text` | `select` | `confirm`
- `default`: Default value
- `options`: Array of options (for select type)
- `required`: Whether answer is required
- `condition`: Expression to show conditionally

Reference answers in your template using the `_init` prefix. For a question named `project_name`, use `${{ _init.project_name }}` in your YAML.

Example template:
```yaml
# Use interpolation with _init prefix
project:
  name: "${{ _init.project_name }}"

_init:
  project_name:
    prompt: "Project name"
    default: "my-project"
```

After running `bolt init` and answering "MyGame":
```yaml
project:
  name: "MyGame"
```

## See Also

- [Getting Started](/guides/getting-started) - Quick start guide
- [First Project](/guides/first-project) - Detailed walkthrough
- [bolt.yaml Reference](/guides/bolt-yaml) - Configuration schema
