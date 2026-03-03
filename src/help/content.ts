import type { HelpTopic } from "./types";

export const topics: HelpTopic[] = [
  {
    id: "overview",
    title: "Overview",
    shortDesc: "What is Bolt, quick start",
    sections: [
      {
        id: "what-is-bolt",
        title: "What is Bolt?",
        content: `Bolt is a build and workflow automation tool for Unreal Engine projects.
It provides a unified CLI for common development tasks like version control,
building, cooking, and deployment.

Key features:
  - Declarative configuration via bolt.yaml
  - Composable operations (ops) with variants
  - Plugin system for extensibility
  - Built-in support for UE5 workflows`,
      },
      {
        id: "quick-start",
        title: "Quick Start",
        content: `1. Create a bolt.yaml in your project root
2. Define your targets, ops, and actions
3. Run 'bolt go <ops...>' to execute a pipeline

Example bolt.yaml:

  project:
    name: MyGame
    engine_root: C:/UE_5.3
    project_root: .

  targets:
    editor: { kind: editor, config: Development }
    game: { kind: game, config: Shipping }

  ops:
    build:
      default: [compile-editor]
      dev: [compile-editor, hot-reload]

Run: bolt go build
This executes the default variant of the 'build' op.`,
      },
      {
        id: "commands",
        title: "Available Commands",
        content: `bolt go <ops...>      Run ops in pipeline order
bolt run <action>     Execute a named action
bolt list             List available ops and actions
bolt info             Print project config summary
bolt check            Validate bolt.yaml
bolt config           Manage configuration
bolt plugin           Manage plugins
bolt inspect          Debug op steps
bolt version          Print version
bolt self-update      Update bolt itself`,
      },
    ],
  },
  {
    id: "go",
    title: "bolt go",
    shortDesc: "Run ops in pipeline order",
    sections: [
      {
        id: "usage",
        title: "Usage",
        content: `bolt go <op1> <op2> ... [options]

The 'go' command runs one or more ops in sequence. Each op expands
into a series of steps that are executed in order.

Options:
  --dry-run    Print steps without executing

Examples:
  bolt go update:svn build start
  bolt go build --dry-run
  bolt go sync:git compile-editor`,
      },
      {
        id: "op-variants",
        title: "Op Variants",
        content: `Ops can have multiple variants selected with a colon:

  bolt go build:dev     # Uses 'dev' variant
  bolt go build:ci      # Uses 'ci' variant
  bolt go build         # Uses 'default' variant

In bolt.yaml:

  ops:
    build:
      default: [compile-editor]
      dev: [compile-editor, hot-reload]
      ci: [compile-editor, run-tests, package]`,
      },
      {
        id: "op-params",
        title: "Op Parameters",
        content: `Pass parameters to ops using key=value syntax:

  bolt go deploy env=staging region=us-east

Parameters are available in op steps via template interpolation:

  ops:
    deploy:
      default:
        - exec: ./deploy.sh --env {{params.env}} --region {{params.region}}`,
      },
      {
        id: "pipeline",
        title: "Pipeline Mode",
        content: `When running multiple ops, they form a pipeline:

  bolt go update build start

This runs:
  1. All steps from 'update' op
  2. All steps from 'build' op
  3. All steps from 'start' op

The go-pipeline setting in bolt.yaml can configure behavior:

  go-pipeline:
    parallel: false     # Run ops sequentially
    fail-fast: true     # Stop on first error`,
      },
    ],
  },
  {
    id: "run",
    title: "bolt run",
    shortDesc: "Execute named actions",
    sections: [
      {
        id: "usage-run",
        title: "Usage",
        content: `bolt run <action> [options]

The 'run' command executes a named action from bolt.yaml.
Actions are single-purpose, unlike ops which compose.

Options:
  --dry-run    Print steps without executing

Examples:
  bolt run package-game
  bolt run deploy-server --dry-run`,
      },
      {
        id: "defining-actions",
        title: "Defining Actions",
        content: `Actions are defined in bolt.yaml under the 'actions' key:

  actions:
    package-game:
      - ue: package-game
        target: game
        output: ./Builds

    deploy-server:
      - exec: ./scripts/deploy.sh
        env:
          SERVER_HOST: {{env.DEPLOY_HOST}}

    clean:
      - fs: rm
        path: ./Builds
      - fs: rm
        path: ./Saved`,
      },
    ],
  },
  {
    id: "ops",
    title: "Ops System",
    shortDesc: "Composable operations with variants",
    sections: [
      {
        id: "op-basics",
        title: "Op Basics",
        content: `Ops are reusable, composable sequences of steps.
They support variants and parameters for flexibility.

Structure:

  ops:
    <name>:
      default: [step1, step2, ...]
      <variant>: [step1, step2, ...]

Example:

  ops:
    sync:
      default: [update:svn]
      git: [update:git]
      full: [update:svn, update:git]`,
      },
      {
        id: "step-types",
        title: "Step Types",
        content: `Steps are the atomic units of execution:

  - ue: <action>       Unreal Engine operations
  - exec: <command>    Shell command execution
  - fs: <action>       Filesystem operations
  - git: <action>      Git operations
  - svn: <action>      SVN operations
  - json: <action>     JSON file operations
  - plugin: <action>   Custom plugin operations

Each step type has its own parameters and options.`,
      },
      {
        id: "ue-steps",
        title: "UE Steps",
        content: `Unreal Engine step types:

  ue: generate-project-files
    Generate IDE project files

  ue: compile-editor
    Compile the editor target

  ue: compile-game
    Compile the game target

  ue: cook-content
    Cook content for the specified target

  ue: package-game
    Package the game for distribution

  ue: run-automation
    Run automation tests

Parameters:
  target: <name>       Target from bolt.yaml
  config: <config>     Build configuration
  output: <path>       Output directory (package-game)`,
      },
      {
        id: "exec-steps",
        title: "Exec Steps",
        content: `Execute shell commands:

  - exec: <command>
    cwd: <directory>        # Working directory
    env:                    # Environment variables
      VAR: value
    timeout: 300000         # Timeout in ms
    silent: false           # Suppress output

Examples:

  - exec: npm run build
    cwd: ./Frontend

  - exec: ./scripts/deploy.sh
    env:
      ENV: production
      DEBUG: "0"`,
      },
      {
        id: "fs-steps",
        title: "FS Steps",
        content: `Filesystem operations:

  fs: copy
    src: <path>
    dest: <path>

  fs: rm
    path: <path>

  fs: mkdir
    path: <path>

  fs: write
    path: <path>
    content: <string>

  fs: read
    path: <path>

Examples:

  - fs: mkdir
    path: ./Builds

  - fs: copy
    src: ./Dist
    dest: ./Builds/v1.0`,
      },
    ],
  },
  {
    id: "config",
    title: "bolt.yaml",
    shortDesc: "Configuration schema",
    sections: [
      {
        id: "project-section",
        title: "Project Section",
        content: `The project section defines basic project info:

  project:
    name: MyGame              # Project name
    engine_root: C:/UE_5.3    # Path to UE
    project_root: .           # Project directory
    engine_vcs: git           # VCS for engine (git/svn)
    project_vcs: svn          # VCS for project (git/svn)
    git_branch: main          # Default git branch`,
      },
      {
        id: "targets-section",
        title: "Targets Section",
        content: `Define build targets:

  targets:
    editor:
      kind: editor
      config: Development

    game-dev:
      kind: game
      config: Development
      name: MyGame

    game:
      kind: game
      config: Shipping
      name: MyGame

Target properties:
  kind: editor | game | server | program
  config: Development | Debug | Shipping | Test
  name: Target name (for game/server targets)`,
      },
      {
        id: "ops-section",
        title: "Ops Section",
        content: `Define composable operations:

  ops:
    update:
      default: [update:svn]
      full: [update:svn, update:git]

    build:
      default: [generate-project-files, compile-editor]

    start:
      default: [run-editor]

    go-to:
      default: [update, build, start]
      dev: [update:full, build, start]`,
      },
      {
        id: "actions-section",
        title: "Actions Section",
        content: `Define single-purpose actions:

  actions:
    clean:
      - fs: rm
        path: ./Saved
      - fs: rm
        path: ./Intermediate

    package:
      - ue: package-game
        target: game
        output: ./Builds/{{env.BUILD_NUMBER}}`,
      },
      {
        id: "notifications",
        title: "Notifications",
        content: `Configure notifications for long-running ops:

  notifications:
    on_success: true
    on_failure: true
    slack:
      webhook_url: {{env.SLACK_WEBHOOK}}
    discord:
      webhook_url: {{env.DISCORD_WEBHOOK}}

Notifications are sent when ops complete.`,
      },
      {
        id: "interpolation",
        title: "Template Interpolation",
        content: `Use {{...}} syntax for dynamic values:

  {{env.VAR}}           Environment variable
  {{params.name}}       Op parameter
  {{project.name}}      Project config value
  {{target.name}}       Current target name

Examples:

  - exec: ./deploy.sh
    env:
      VERSION: {{env.BUILD_VERSION}}

  - fs: mkdir
    path: ./Builds/{{params.branch}}`,
      },
    ],
  },
];

export function getTopic(id: string): HelpTopic | undefined {
  return topics.find((t) => t.id === id);
}

export function getTopicIndex(id: string): number {
  return topics.findIndex((t) => t.id === id);
}
