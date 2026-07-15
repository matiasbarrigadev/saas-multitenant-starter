# Changelog

> Machine-readable version history. AI agents can parse this file to
> understand what changed between versions and write upgrade scripts.

<!-- trigger deploy workflow for first-time CI registration -->

This file follows [Keep a Changelog](https://keepachangelog.com/) format
with the additional convention that each entry includes:

- `schema_migrations:` — comma-separated list of new SQL migrations.
- `breaking:` — true if the change requires user action.
- `affects:` — comma-separated list of file paths touched.

## [0.4.0] — 2026-07-15

### Added

- **3-tier RBAC**: super_admin / owner / team_member. super_admin is a
  separate JWT claim (NOT in `public.role`), stored in
  `auth.users.raw_app_meta_data.platform_role` and stamped into the JWT
  by `custom_access_token_hook`.
- **Audit log**: `public.audit_events` table + uniform
  `recordAuditEvent()` helper. Every admin mutation emits an event.
- **Platform admin panel** (`/admin`): list companies, view company
  detail, suspend/reactivate companies, promote/demote super_admins,
  view global audit log.
- **Company admin panel** (`/w/<slug>/admin`): members, workspaces,
  settings. Owner-only settings (e.g. company name change).
- **Migration of JWT-driven layout**: `/admin` lives outside the
  `(tenant)` group because super_admin doesn't need a workspace context.
- **shadcn/ui initialization**: `app/globals.css`, `tailwind.config.ts`,
  `postcss.config.mjs`, `lib/utils.ts` (cn helper), and 4 components
  (Button, Badge, Card, Table). Declared in `components.json` since
  v0 but never initialized.
- **6 new error codes**: `SUPER_ADMIN_REQUIRED`, `COMPANY_ADMIN_REQUIRED`,
  `CANNOT_DEMOTE_SELF`, `ALREADY_MEMBER`, `LAST_OWNER`, `ARCHIVED_WORKSPACE`.
- **4 new skills**: `add-super-admin-action`, `add-audit-event`,
  `add-workspace`, `add-member`.
- **2 new docs**: `docs/RBAC.md` (permission matrix) and
  `docs/ADMIN.md` (UI tour).

### Notes for upgraders

- `schema_migrations: 0006, 0007, 0008`.
- `breaking: false` (existing endpoints unchanged; new behavior is additive).
- `affects: supabase/migrations/0006_admin_panel.sql,
  supabase/migrations/0007_rls_admin.sql,
  supabase/migrations/0008_hook_platform_role.sql, lib/admin/guards.ts,
  lib/admin/audit.ts, lib/supabase/types.ts, lib/tenant/context.ts,
  lib/api/errors.ts, app/admin/, app/(tenant)/admin/,
  app/(tenant)/api/admin/, components/ui/, lib/utils.ts,
  app/globals.css, tailwind.config.ts, postcss.config.mjs,
  skills/add-super-admin-action.md, skills/add-audit-event.md,
  skills/add-workspace.md, skills/add-member.md, docs/RBAC.md,
  docs/ADMIN.md, registry.json, llms.txt, llms-ctx.txt,
  package.json, pnpm-lock.yaml`.

[0.4.0]: #040--2026-07-15

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