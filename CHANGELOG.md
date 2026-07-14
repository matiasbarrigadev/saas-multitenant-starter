# Changelog

> Machine-readable version history. AI agents can parse this file to
> understand what changed between versions and write upgrade scripts.

<!-- trigger deploy workflow for first-time CI registration -->

This file follows [Keep a Changelog](https://keepachangelog.com/) format
with the additional convention that each entry includes:

- `schema_migrations:` — comma-separated list of new SQL migrations.
- `breaking:` — true if the change requires user action.
- `affects:` — comma-separated list of file paths touched.

## [0.3.0] — 2026-07-13

### Added

- **Vercel CLI wrapper**: `scripts/vercel-cli.ts` orchestrates Vercel
  operations locally with the same credentials used in CI.
  Subcommands: `link`, `env` (`list`/`pull`/`push`), `domains`
  (`list`/`add`/`rm`), `deploy` (preview or `--prod`), `deployments
  list`, `inspect <id|latest>`. Dry-run by default; `--apply` to mutate.
- **GitHub Action deploy**: `.github/workflows/deploy.yml` runs CI
  (typecheck + build) on every push/PR and deploys to production on
  push to `main`. PR preview URLs are posted via
  `marocchino/sticky-pull-request-comment`. Replaces the Vercel GitHub
  App — same UX, full programmatic control.
- **New env vars**: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
  — required only by `vercel-cli` and the deploy workflow.
- **Skills**: `skills/vercel-cli.md`, `skills/deploy-ci.md` —
  vendor-neutral guides for agents extending each piece.
- **README**: new "Deploy to production" section with full setup
  sequence using the workflow + local CLI.
- **package.json**: + `vercel` devDep + 6 npm scripts (`vercel:link`,
  `vercel:env:pull`, `vercel:env:list`, `vercel:domains:list`,
  `vercel:deploy`, `vercel:deployments`).

### Notes for upgraders

- `schema_migrations: (none)`.
- `breaking: false`.
- `affects: scripts/vercel-cli.ts, .github/workflows/deploy.yml, package.json,
  skills/vercel-cli.md, skills/deploy-ci.md, .env.example, docs/ENV.md,
  README.md, llms.txt, llms-ctx.txt, CHANGELOG.md`.

[0.3.0]: #030--2026-07-13

## [0.2.0] — 2026-07-13

### Added

- **Setup script**: `scripts/setup-supabase.ts` orchestrates remote Supabase
  setup (link, push, hook verify, auth config sync, optional seed). Dry-run
  by default; `--apply` to mutate; `--check-only` for read-only inspection.
- **npm scripts**: `pnpm setup:supabase`, `pnpm setup:supabase:check`,
  `pnpm setup:supabase:apply`.
- **New env vars**: `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` —
  required only by the setup script.
- **Skill**: `skills/setup-supabase.md` — vendor-neutral guide for
  agents extending the setup script.
- **registry.json + llms.txt**: setup script listed for agent discovery.

### Notes for upgraders

- `schema_migrations: (none)`.
- `breaking: false`.
- `affects: scripts/setup-supabase.ts, package.json, skills/setup-supabase.md,
  .env.example, docs/ENV.md, README.md, llms.txt, llms-ctx.txt, CHANGELOG.md`.

## [0.1.0] — 2026-07-13

### Added

- **Auth**: Magic-link sign-in via Supabase Auth with custom_access_token_hook.
- **Tenancy**: Two-level (Company ↔ Workspace) with RLS keyed on `workspace_id`.
- **Tenant resolution**: `proxy.ts` with subdomain → company, path → workspace.
- **API helpers**: `ok` / `warn` / `err` shape; `withApi()` wrapper for Route Handlers.
- **Env validation**: Zod-validated env in `lib/env.ts`, fail-fast on boot.
- **Agent layer**:
  - `AGENTS.md` — universal, vendor-neutral rules for AI agents.
  - `llms.txt` + `llms-ctx.txt` — llmstxt.org-spec navigation.
  - `registry.json` + `components.json` — shadcn-compatible install.
  - `skills/` — 4 vendor-neutral skills (add-table, add-api-route,
    add-auth-flow, add-admin-action).
  - `docs/CONVENTIONS.md`, `docs/RECIPES.md`, `docs/RISKS.md`.
- **Demo app**: protected dashboard + workspace switcher + sign out.

### Notes for upgraders

- `schema_migrations: 0001, 0002, 0003, 0004, 0005`.
- `breaking: false`.
- `affects: AGENTS.md, llms.txt, llms-ctx.txt, registry.json, components.json,
  docs/CONVENTIONS.md, docs/RECIPES.md, docs/RISKS.md, skills/*`.

[0.2.0]: #020--2026-07-13
[0.1.0]: #010--2026-07-13