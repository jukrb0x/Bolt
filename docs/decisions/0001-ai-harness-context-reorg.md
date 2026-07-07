# 0001: AI-harness context reorganization

- Status: accepted
- Date: 2026-07-03

## Context

Before this change, `docs/` was overloaded: it held the **Mintlify
documentation website** (`bolt-docs`) *and* was the only obvious place for
project knowledge. The repo had:

- No home for shared project knowledge (ROADMAP, RFCs, architecture, ops,
  decisions) — planning lived in a flat root `TODO.md`.
- No place for local-first agent working memory (specs, plans, brainstorms).
- Scattered AI context (`AGENTS.md`, `TODO.md`, `skills/boltstack/`) with no map
  telling an agent where to look.
- Legacy orphan markdown files in `docs/` not linked from the Mintlify nav.

As we invest in agent-assisted development, agents need a predictable context
layout to read from and write to.

## Decision

Adopt a **minimal Bun-native monorepo** and repurpose `docs/`:

1. **Move the Mintlify site** to `apps/docs` (package name unchanged:
   `bolt-docs`). Root stays the published `boltstack` CLI/library.
2. **Bun workspaces** glob switched from `["docs"]` to `["apps/*"]`. No pnpm,
   no extra tooling.
3. **Repurpose `docs/`** as the shared, committed context base:
   `README.md`, `ROADMAP.md`, `RFCs/`, `architecture/`, `ops/`, `decisions/`,
   `archive/`.
4. **Add `docs/superpowers/`** — gitignored, local-first agent working memory
   (`specs/`, `plans/`, `brainstorms/`, `scratch/`).
5. **Wire agents**: add a Context Map block to `AGENTS.md`; seed `ROADMAP.md`
   from `TODO.md` and reduce `TODO.md` to a pointer.
6. **Handle legacy orphans**: `architecture.md` → `architecture/overview.md`,
   `release.md` → `ops/release.md`; stale duplicates of published guides moved
   to `archive/` (deletion deferred, pending confirmation).

Alternatives rejected:

- **Full monorepo** (extract CLI into `packages/bolt`): more churn to
  exports/build/install/release for little near-term gain.
- **Different context root** (`context/`, `.ai/`): reusing `docs/` keeps one
  obvious knowledge location.

## Consequences

- Clear separation: `apps/docs` = product website; `docs/` = human+AI knowledge;
  `docs/superpowers/` = local scratch.
- Publishing/building `boltstack` from the repo root is unchanged (site move is
  pure `git mv` renames; `src/` untouched; 227/227 tests pass).
- Agents have a single entry (`AGENTS.md` Context Map) → predictable reads/writes.
- Design spec for this change lives (local, uncommitted) at
  `docs/superpowers/specs/2026-07-03-ai-harness-reorg-design.md`.

See `architecture/content-system.md` for the resulting layout.
