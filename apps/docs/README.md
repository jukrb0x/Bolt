# Bolt docs

The Bolt documentation site, built with [Mintlify](https://mintlify.com/docs). Configuration lives in
`docs.json`; pages are `.mdx` files with `title` and `description` frontmatter.

## Commands

Run these from the repository root:

| Command              | What it does                                                                    |
| -------------------- | ------------------------------------------------------------------------------- |
| `bun run docs:dev`   | Local preview at http://localhost:3000 (`mint dev`).                            |
| `bun run docs:gen`   | Regenerate the pages under `reference/`.                                        |
| `bun run docs:check` | Fail on generated-docs drift, then run `mint validate` and `mint broken-links`. |

## Layout

| Path                               | Source                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `index.mdx`, `why-bolt.mdx`, `ai/` | Hand-written. Placeholders are marked `TODO(content)`.                                                                  |
| `guides/`, `cli/`, `api/`          | Hand-written pages.                                                                                                     |
| `reference/config/`                | Generated from `schema/v1/*.schema.json`.                                                                               |
| `reference/plugins/`               | Generated from the built-in plugin manifests (`src/plugins`): namespace, handlers, descriptions, `ai` flag, zod params. |
| `reference/cli/`                   | Generated from the citty command definitions in `src/commands`.                                                         |
| `scripts/generate.ts`              | The generator.                                                                                                          |

Do not edit files under `reference/` by hand. Change the source, run `bun run docs:gen`, and commit
the result. CI (`docs` job in `.github/workflows/ci.yml`) fails when the committed output differs
from a fresh run. A new generated page must also be added to `docs.json` navigation, or the
generator exits with an error.

Find placeholder pages with `rg "TODO\(content"`.

## Hosting (not set up yet)

Deployment needs a Mintlify account, so this repository does not deploy the site. To connect it:

1. Sign in at https://dashboard.mintlify.com and create a project.
2. Install the Mintlify GitHub App on `jukrb0x/Bolt`.
3. In the dashboard's Git settings, select the repository, branch `main`, and set the docs
   directory to `apps/docs` (the folder that contains `docs.json`). Enable the monorepo option if
   the dashboard asks.
4. Pushes to `main` then deploy automatically, and pull requests get preview deployments.
5. Optional: add a custom domain (for example `docs.<domain>`) under the dashboard's domain
   settings and create the CNAME record it shows.
