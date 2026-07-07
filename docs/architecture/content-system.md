---
title: "Documentation & AI Context System"
---

How Bolt organizes documentation and AI context. There are **two separate
"AI context" concerns** that are easy to conflate — this doc keeps them apart.

## Project purpose (context for any reader)

**Bolt** (`boltstack` on npm) is a CLI tool and library for **Unreal Engine
workflow automation**. It turns repetitive UE tasks — updating source control
(git/svn), rebuilding the editor, launching the game, filling DDC — into single,
chainable commands driven by a per-project `bolt.yaml`:

```
bolt go update build start
```

- **CLI**: Bun-only, for speed.
- **Library** (`boltstack`): Bun + Node.js, for programmatic automation.
- **Extensible**: built-in plugins (`ue`, `git`, `svn`, `fs`, `json`) plus
  user/project plugins.

See `overview.md` for the code architecture.

## The two AI layers

| Layer | Audience | Lives in | Purpose |
|---|---|---|---|
| **A. Repo harness** | Agents developing *Bolt itself* | `AGENTS.md`, `docs/`, `docs/superpowers/` | Give agents the project's knowledge + working memory |
| **B. Product feature** | Agents using Bolt in an *end-user's* project | `bolt ai` → `.bolt/ai-context.md`, `skills/boltstack/`, `.claude-plugin/` | Let LLMs safely drive Bolt in any UE project |

These are independent. Layer A is about maintaining this repo. Layer B is a
shipped feature of the product. Do not mix them.

---

## Layer A — Repo AI harness (developing Bolt)

The context base that both humans and coding agents read/write while working on
this repository.

### Surfaces

| Surface | Committed? | Role |
|---|---|---|
| `AGENTS.md` (repo root) | yes | Entry point. Agent protocol, guardrails, and the **Context Map** pointing here. `CLAUDE.md` symlinks it. |
| `docs/` | yes | Shared knowledge base (this folder). |
| `docs/superpowers/` | **no (gitignored)** | Local-first agent working memory. |
| `apps/docs/` | yes | The **product documentation website** (Mintlify). Not agent context — it's the user-facing docs. |

### `docs/` context base

| Path | Holds |
|---|---|
| `README.md` | Index of the context base |
| `ROADMAP.md` | Direction and priorities (seeded from the old `TODO.md`) |
| `RFCs/` | Proposals for non-trivial changes (`0000-template.md`) |
| `architecture/` | How the system is built (this file, `overview.md`) |
| `ops/` | Operational runbooks (`release.md`) |
| `decisions/` | Lightweight ADRs, one decision per file |
| `archive/` | Superseded/stale docs kept for reference |
| `superpowers/` | Local-first working memory (below) |

### `docs/superpowers/` (local-first)

Gitignored working memory — never committed, delete freely:

- `specs/` — design specs from brainstorming
- `plans/` — implementation plans
- `brainstorms/` — exploration notes
- `scratch/` — ephemeral notes

Rationale: keeps in-flight, personal, or noisy agent artifacts out of version
control while still living beside the code. See ADR
`decisions/0001-ai-harness-context-reorg.md`.

### Reading order for an agent

1. `AGENTS.md` → protocol + Context Map.
2. `docs/README.md` → what's where.
3. `docs/ROADMAP.md` + relevant `architecture/` / `decisions/` for the task.
4. Write working notes to `docs/superpowers/`.

---

## Layer B — Product AI feature (`bolt ai`)

Bolt ships an LLM integration so agents can operate Bolt inside *any* UE project
it manages.

### `bolt ai` → `.bolt/ai-context.md`

`src/ai-context.ts` (`generateAiContext`) renders a per-project command
reference from the project's `bolt.yaml`:

- Header includes a **content hash** of `bolt.yaml` (line 2:
  `<!-- bolt.yaml hash: … -->`) for staleness detection.
- A quick-reference table + detailed sections for **ops** (`bolt go <op>[:var]`),
  **actions** (`bolt run <action>`), **targets**, pipeline order/fail-stops,
  flags, and introspection commands.
- Written to `.bolt/ai-context.md` (the `.bolt/` dir is gitignored in end-user
  projects).

### `skills/boltstack/SKILL.md`

An agent skill (shipped via `.claude-plugin/plugin.json`) that instructs LLMs to:

1. Locate `bolt.yaml` (Bolt walks upward from cwd).
2. Read `.bolt/ai-context.md`; if missing or the hash is stale, run `bolt ai`
   and re-read.
3. Use **only** commands present in the context — never guess.
4. Follow safety rules (`--dry-run` first, confirm `bolt go kill`, respect
   `fail_stops`, don't edit `bolt.yaml` unprompted).

### `.claude-plugin/plugin.json`

Registers the `boltstack` skill for Claude/agent plugin hosts. Note: its
`version` (1.3.0) lags the root package version — bump on skill changes.

---

## Where a doc belongs (quick guide)

| You are writing… | Put it in… |
|---|---|
| Product/user docs (guides, CLI, API) | `apps/docs/` (Mintlify site) |
| How Bolt is built / a design overview | `docs/architecture/` |
| A decision + rationale | `docs/decisions/NNNN-*.md` |
| A proposal to discuss before building | `docs/RFCs/` |
| A runbook (release, maintenance) | `docs/ops/` |
| In-flight spec / plan / scratch | `docs/superpowers/` (local) |
