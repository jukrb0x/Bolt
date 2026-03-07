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
  - Built-in support for UE5 workflows

Full docs: https://bolt-ue.vercel.app`,
      },
      {
        id: "quick-start",
        title: "Quick Start",
        content: `1. Initialize: bolt init
2. Run workflow: bolt go update build start

Example:
  bolt init
  bolt go update build start

Full guide: https://bolt-ue.vercel.app/guides/first-project`,
      },
      {
        id: "commands",
        title: "Commands",
        content: `bolt go <ops...>      Run ops in pipeline
bolt run <action>     Execute a named action
bolt list             List ops and actions
bolt info             Show project config
bolt check            Validate bolt.yaml
bolt init            Interactive setup
bolt plugin           Manage plugins
bolt inspect          Debug op steps
bolt --version        Print version
bolt self-update      Update bolt

Full reference: https://bolt-ue.vercel.app/cli/`,
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
        content: `bolt go <op1> <op2> ... [--dry-run]

Options:
  --dry-run    Print steps without executing

Examples:
  bolt go update build start
  bolt go build --dry-run

Full docs: https://bolt-ue.vercel.app/cli/go`,
      },
      {
        id: "variants",
        title: "Variants",
        content: `Select op variants with a colon:

  bolt go build:dev     # 'dev' variant
  bolt go build:ci      # 'ci' variant
  bolt go build         # 'default' variant

Pass inline params:
  bolt go build --config=debug --platform=Win64`,
      },
      {
        id: "pipeline",
        title: "Pipeline",
        content: `Ops run in go-pipeline.order regardless of argument order:

  bolt go start build    # runs build first, then start

Configure in bolt.yaml:
  go-pipeline:
    order: [kill, update, build, start]
    fail_stops: [build]`,
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
        content: `bolt run <action> [--dry-run]

Options:
  --dry-run    Print steps without executing

Examples:
  bolt run package-game
  bolt run deploy --dry-run

Full docs: https://bolt-ue.vercel.app/cli/run`,
      },
      {
        id: "dependencies",
        title: "Dependencies",
        content: `Actions can depend on other actions:

  actions:
    build-game:
      steps: [...]
    deploy:
      depends: [build-game]
      steps: [...]

bolt run deploy    # runs build-game first`,
      },
    ],
  },
  {
    id: "config",
    title: "bolt.yaml",
    shortDesc: "Configuration schema",
    sections: [
      {
        id: "project",
        title: "Project Section",
        content: `project:
  name: MyGame
  engine_repo:
    path: ./engine
    vcs: git
    branch: main
  project_repo:
    path: ./project
    vcs: svn
  uproject: ./project/MyGame.uproject

Full docs: https://bolt-ue.vercel.app/reference/bolt-yaml`,
      },
      {
        id: "targets",
        title: "Targets",
        content: `targets:
  editor: { kind: editor, config: Development }
  game: { kind: game, config: Shipping, name: MyGame }

Full docs: https://bolt-ue.vercel.app/reference/bolt-yaml#targets`,
      },
      {
        id: "ops",
        title: "Ops",
        content: `ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
    ci:
      - uses: ue/build
      - run: npm test

Full docs: https://bolt-ue.vercel.app/reference/bolt-yaml#ops`,
      },
      {
        id: "interpolation",
        title: "Interpolation",
        content: `Use \${{ }} for dynamic values:

  \${{ env.VAR }}         Environment variable
  \${{ project.name }}   Project config value

Full docs: https://bolt-ue.vercel.app/reference/interpolation`,
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
