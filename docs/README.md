# Bolt Context Base

Shared knowledge for humans and AI agents. This is NOT the docs website
(that lives in `apps/docs`, served by Mintlify).

## Layout

| Path | Purpose | Committed? |
|---|---|---|
| `ROADMAP.md` | Direction, priorities, near-term goals | yes |
| `RFCs/` | Proposals for non-trivial changes (`0000-template.md`) | yes |
| `architecture/` | How the system is built (design overviews) | yes |
| `ops/` | Operational runbooks (release, maintenance) | yes |
| `decisions/` | Lightweight ADRs (one decision per file) | yes |
| `archive/` | Superseded/stale docs kept for reference | yes |
| `superpowers/` | Local-first agent working memory | **no (gitignored)** |

## superpowers/ (local-first)

`docs/superpowers/` is gitignored working memory:

- `specs/` — design specs from brainstorming
- `plans/` — implementation plans
- `brainstorms/` — exploration notes
- `scratch/` — ephemeral agent notes

Never committed. Delete freely.

## For agents

Read `AGENTS.md` (repo root) first — it has the Context Map. Read from
`docs/` for shared knowledge; write working memory to `docs/superpowers/`.
