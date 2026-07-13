# Multitenant Starter Template

> Production-grade starter for SaaS with **Company → Workspace** tenancy,
> built on **Next.js 15+ App Router + Supabase + Vercel**. Agent-first
> packaging so AI coding tools can extend it predictably.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15%2B-black)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-RLS-green)](https://supabase.com/docs/guides/database/postgres/row-level-security)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## Using this template

Three ways to start:

### Option A — Use it as a GitHub template (recommended)

1. Click **"Use this template"** on the GitHub repo page (the green button).
2. Pick a name for your new repo. Don't include "template" or "starter" in
   it — this is now YOUR product.
3. Clone your new repo locally:
   ```bash
   git clone https://github.com/<you>/<your-new-repo>.git
   cd <your-new-repo>
   pnpm install
   ```
4. Replace the placeholder values (see [§ Placeholders to change](#placeholders-to-change)):
   - `package.json` — name, description, version
   - `README.md` — title, intro, your product name
   - `registry.json` — `homepage` (your repo URL)
   - `LICENSE` — copyright line
5. Follow the [Quickstart (local)](#quickstart-local) below.

### Option B — Use it as a shadcn registry

Don't want the whole template — just some pieces? Pull individual items
into an existing Next.js project:

```bash
# Pull only the Supabase migrations.
pnpm dlx shadcn@latest add your-org/multitenant-template/supabase-migrations

# Pull only the lib/tenant resolution layer.
pnpm dlx shadcn@latest add your-org/multitenant-template/lib-tenant-resolution

# Pull AGENTS.md into any project so AI tools get the universal rules.
pnpm dlx shadcn@latest add your-org/multitenant-template/agents-instructions
```

The full item list is in [`registry.json`](registry.json).

### Option C — Clone directly

```bash
git clone https://github.com/your-org/multitenant-template.git my-app
cd my-app
rm -rf .git                # start fresh history
pnpm install
# Then follow the Quickstart below.
```

## Placeholders to change

After cloning (Option A or C), search-and-replace these placeholders so
the repo doesn't claim to be the template anymore:

| File | Replace |
|---|---|
| `package.json` | `name`, `description`, `version`, `author` |
| `README.md` | Title, intro paragraph, "Use this template" section, deployment links |
| `registry.json` | `homepage`, `name` |
| `LICENSE` | Copyright line (`Copyright (c) 2026 Multitenant Template Authors`) |
| `AGENTS.md` | (Optional) Project name in `<background_information>` block |
| `docs/ARCHITECTURE.md` | (Optional) Update the "What is this" wording if it sounds wrong for your product |
| `.github/ISSUE_TEMPLATE/*.yml` | Remove or replace `your-org` URLs in any "contact links" |

The template intentionally leaves these placeholders explicit so you
don't forget them. They are **not** filled with fictional values to
trick search engines.

## What's in the box

- ✅ **Magic-link auth** with `@supabase/ssr`, server-side session handling
- ✅ **Two-level tenancy**: Company (by subdomain) + Workspace (by path)
- ✅ **Postgres RLS** enforced via `custom_access_token_hook`
- ✅ **Tenant resolution** in `proxy.ts` (Next.js 16's renamed middleware.ts)
- ✅ **Uniform API responses** (`ok`/`warn`/`err`) with typed error codes
- ✅ **Cache-Control: no-store** baked in — no cross-tenant leaks on CDN
- ✅ **Workspace switcher** with live JWT refresh
- ✅ **Zod-validated env vars** — fails fast on bad config
- ✅ **Agent-first packaging** — `AGENTS.md`, `llms.txt`, `skills/`, shadcn
      registry entries. See [§ Using with AI agents](#using-with-ai-agents).
- ✅ **Documented in `docs/`** — every decision justified, every trade-off called out

## What's deliberately NOT in the box

- ❌ UI design system / admin shell — copy the minimal layout and style
- ❌ Stripe billing — out of scope; the auth hook is the pattern
- ❌ Onboarding flow — placeholder, documented in [AUTH.md](docs/AUTH.md)
- ❌ Test suite — manual checklist in [VERIFICATION](#verification)
- ❌ Audit log — pattern documented in [RLS.md](docs/RLS.md)

## Architecture in one diagram

```
Browser ─cookie→ Next.js (proxy.ts) ─validate JWT→ Supabase
                  │                                   │
                  │ inject x-company-id, x-workspace-id
                  ▼                                   │
             RSC / API routes                          ▼
                  │                              Postgres (RLS)
                  ▼                              ───────────────
             Supabase server client              companies
                  │                              workspaces
                  │ (RLS via JWT)                memberships
                  ▼                              notes (etc.)
             Query result with company_memberships
             stamped by custom_access_token_hook
```

## Using with AI agents

This template is designed so AI coding agents (Claude Code, Cursor,
Windsurf, GitHub Copilot, open-source agents) can extend it
**predictably and safely** without improvising against the architecture.

The agent-facing layer is **vendor-neutral**. There are no `.cursorrules`,
no Copilot-specific config — just markdown that any agent can read.

### Files agents consume (in reading order)

1. **`AGENTS.md`** — non-negotiable rules, in plain markdown.
2. **`llms.txt`** — repository navigation map (llmstxt.org spec).
3. **`docs/CONVENTIONS.md`** — naming, file layout, antipatterns.
4. **`docs/RECIPES.md`** — canonical copy-pasteable examples.
5. **`docs/ARCHITECTURE.md`** — the design decisions and *why*.

### Files agents *produce* against (per task)

| Agent task | Read this skill |
|---|---|
| Add a tenant-scoped table | `skills/add-table.md` |
| Add a typed API route | `skills/add-api-route.md` |
| Add a new auth provider | `skills/add-auth-flow.md` |
| Add an admin operation (service role) | `skills/add-admin-action.md` |

Each skill is a self-contained recipe: pre-flight checklist, the file to
create, a code template, a verify section, and a rollback procedure.

### Distribution

The repo also ships a [shadcn-compatible registry](registry.json), so
other projects can pull individual pieces (not the whole template)
without forking:

```bash
# Pull the Supabase migrations into an existing Next.js project.
pnpm dlx shadcn@latest add your-org/multitenant-template/supabase-migrations

# Or just the lib/tenant resolution layer.
pnpm dlx shadcn@latest add your-org/multitenant-template/lib-tenant-resolution

# Or just AGENTS.md (the universal agent rules) into any project.
pnpm dlx shadcn@latest add your-org/multitenant-template/agents-instructions
```

This works because the repo has `registry.json` at its root and is
publicly accessible — no build server, no JSON publishing, just GitHub.

### Why no `.cursorrules` / Copilot-specific config?

- Those are vendor-specific and quickly rot.
- The same `AGENTS.md` works in Claude Code, Cursor, Windsurf, Copilot,
  open-source agents, and any future tool that respects a
  "machine-readable instructions" convention.
- We can swap vendors without touching the rules.
- See `docs/CONVENTIONS.md` § "Why this layout" for the full rationale.

## Quickstart (local)

### 1. Install dependencies

```bash
pnpm install
# or npm install / yarn install
```

### 2. Start Supabase locally

```bash
npx supabase start
```

This spins up Postgres + GoTrue + PostgREST in Docker. Wait for the
output that prints anon key, service role key, and API URL.

### 3. Configure env vars

```bash
cp .env.example .env.local
```

Fill in the values from `supabase status`. Example:

```
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<printed value>"
SUPABASE_SERVICE_ROLE_KEY="<printed value>"
NEXT_PUBLIC_ROOT_DOMAIN="tuapp.local"
NEXT_PUBLIC_APP_SCHEME="http"
```

### 4. Apply migrations and seed

```bash
npx supabase db reset
```

This runs all 5 migrations in `supabase/migrations/` and seeds the demo
company `acme` with two workspaces (`marketing` and `sales`).

### 5. Add a hosts entry

`/etc/hosts` (Linux/macOS) or `C:\Windows\System32\drivers\etc\hosts` (Windows):

```
127.0.0.1 acme.tuapp.local
```

### 6. Create your user

Option A: Use the Inbucket web UI to see the magic-link email without
setting up SMTP locally. Open `http://127.0.0.1:54324` and check incoming
emails to `demo@acme.tuapp.local` after you request a link.

Option B: Pre-create the demo user via the Supabase Studio Users panel
(`http://127.0.0.1:54323`), then re-run `npx supabase db reset` to
attach it to the seeded workspaces.

### 7. Run the dev server

```bash
pnpm dev
```

Open `http://acme.tuapp.local:3000/login` and request a magic link. After
clicking the email link, you'll land on `http://acme.tuapp.local:3000/w/marketing/dashboard`.

## Setting up a remote Supabase project (production / staging)

For non-local environments, use the setup script. It orchestrates the
five things that need to happen together:

1. Link the repo to a Supabase project.
2. Push migrations to that project.
3. Verify the `custom_access_token_hook` is enabled.
4. Sync auth config (site_url, additional_redirect_urls).
5. (Opt-in) Apply `supabase/seed.sql`.

The script is **dry-run by default** — it prints what it would do, then
exits. Re-run with `--apply` to actually mutate.

```bash
# First-time setup: print a plan.
pnpm setup:supabase

# Inspect current state of a remote project (no changes).
pnpm setup:supabase:check

# Apply all phases, with interactive prompts.
pnpm setup:supabase

# Apply all phases non-interactively (for CI).
pnpm setup:supabase:apply

# Apply only one phase.
pnpm tsx scripts/setup-supabase.ts --apply --phase=hook
```

Before running, add these to `.env.local` (or set them in your shell):

```
SUPABASE_PROJECT_REF="<your-project-ref>"
SUPABASE_ACCESS_TOKEN="<a PAT from supabase.com/dashboard/account/tokens>"
```

See `docs/ENV.md` for details on these vars. See `skills/setup-supabase.md`
if you're an AI agent extending the script.

## Verification

After the quickstart, run through this checklist:

- [ ] `http://acme.tuapp.local:3000` → renders the public landing page.
- [ ] `/login` accepts an email and shows "Check your inbox".
- [ ] Clicking the link in Inbucket redirects to
      `http://acme.tuapp.local:3000/w/marketing/dashboard`.
- [ ] `GET /api/me` (after signing in) returns `{ user, company, workspace, role, memberships }`.
- [ ] `POST /api/notes` with a valid body creates a note visible in the dashboard.
- [ ] Switching to workspace `sales` via `/settings` hides `marketing` notes (RLS).
- [ ] Visiting `http://globex.tuapp.local:3000` (no membership) → redirected to apex.
- [ ] `curl -I http://acme.tuapp.local:3000/w/marketing/dashboard` shows `Cache-Control: no-store`.
- [ ] Sign out clears the cookie and redirects to `/login`.

## Deploy to production

The template ships its own CI/CD in `.github/workflows/deploy.yml`. It
uses the Vercel CLI directly instead of the Vercel GitHub App — same
behaviour, but with full programmatic control (env vars, domains, logs)
that the integration hides.

### Required GitHub secrets

In Settings → Secrets and variables → Actions → Repository secrets:

```
VERCEL_TOKEN         Personal Access Token (https://vercel.com/account/tokens)
VERCEL_ORG_ID        org ID (team_xxx); required for teams, optional for personal
VERCEL_PROJECT_ID    project ID or slug; optional but recommended
```

Plus the same Next.js / Supabase env vars your project needs
(`NEXT_PUBLIC_SUPABASE_URL`, etc.) — these get read from Vercel's
project env (`vercel env pull` writes them locally).

For Supabase, run `pnpm setup:supabase:apply` against your remote
project. See [§ Setting up a remote Supabase project](#setting-up-a-remote-supabase-project-production--staging)
above.

For domain / wildcard SSL setup, see [docs/DEPLOY.md](docs/DEPLOY.md).

### What deploy.yml does

On every push to `main`:

1. CI: typecheck + build (10-min timeout, fast-fail).
2. CD: link to the Vercel project, pull env, run `vercel deploy --prod`.
3. On PRs: same CI step + a preview deploy that comments the URL on the PR.

You can also run it manually from the Actions tab → "Run workflow" →
choose `preview` or `production`.

### Local CLI (same credentials)

Use `scripts/vercel-cli.ts` for the same operations locally:

```bash
# Link the repo to your Vercel project.
pnpm vercel:link                          # dry-run
pnpm tsx scripts/vercel-cli.ts link --apply   # actually link

# Pull env vars into .env.local (matches what CI does).
pnpm vercel:env:pull

# Add the wildcard subdomain (do this once per project).
pnpm tsx scripts/vercel-cli.ts domains add '*.yourdomain.com' --apply

# Trigger a preview or production deploy manually.
pnpm tsx scripts/vercel-cli.ts deploy              # preview
pnpm tsx scripts/vercel-cli.ts deploy --prod --apply   # production

# List and inspect recent deploys.
pnpm vercel:deployments
pnpm tsx scripts/vercel-cli.ts inspect latest
```

For a fresh project, the typical sequence is:

```bash
pnpm tsx scripts/vercel-cli.ts link --apply
pnpm vercel:env:pull                 # create .env.local from project env
pnpm tsx scripts/vercel-cli.ts domains add '*.yourdomain.com' --apply
# (then delegate NS to Vercel as per docs/DEPLOY.md)
git push                              # CI handles the deploy
```

AI agents read `skills/vercel-cli.md` to extend the script, and
`skills/deploy-ci.md` to modify the workflow.

## Documentation

- [AGENTS.md](AGENTS.md) — universal rules for any AI agent (vendor-neutral).
- [llms.txt](llms.txt) — llmstxt.org repository navigation map.
- [registry.json](registry.json) — shadcn-compatible distribution.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design decisions and trade-offs.
- [docs/AUTH.md](docs/AUTH.md) — full magic-link flow with sequence diagram.
- [docs/RLS.md](docs/RLS.md) — recipe for adding a new tenant-scoped table.
- [docs/TENANCY.md](docs/TENANCY.md) — when to use Company vs Workspace.
- [docs/DEPLOY.md](docs/DEPLOY.md) — production deployment on Vercel.
- [docs/ENV.md](docs/ENV.md) — every environment variable explained.
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — naming, layout, antipatterns (for agents AND humans).
- [docs/RECIPES.md](docs/RECIPES.md) — copy-pasteable canonical extensions.
- [docs/RISKS.md](docs/RISKS.md) — known risks, mitigations, service_role audit.

## Skills (agent-facing)

- [skills/add-table.md](skills/add-table.md) — add a tenant-scoped table.
- [skills/add-api-route.md](skills/add-api-route.md) — add a typed Route Handler.
- [skills/add-auth-flow.md](skills/add-auth-flow.md) — add a new auth provider.
- [skills/add-admin-action.md](skills/add-admin-action.md) — add a service-role admin action.

## Repo layout

```
.
├── AGENTS.md                  # Universal, vendor-neutral agent rules
├── llms.txt                   # llmstxt.org navigation map
├── llms-ctx.txt               # Same map without the "Optional" section (tight contexts)
├── registry.json              # shadcn registry entries
├── components.json            # shadcn project aliases config
├── README.md                  # This file
├── CHANGELOG.md               # Machine-readable version history
├── CONTRIBUTING.md            # How to file issues / submit PRs
├── LICENSE                    # MIT
├── SECURITY.md                # Vulnerability disclosure + hardening checklist
├── package.json
├── tsconfig.json              # Path aliases
├── next.config.ts
├── proxy.ts                   # Tenant resolution + auth refresh + cache headers
│
├── .github/
│   ├── ISSUE_TEMPLATE/        # bug, feature, docs question
│   └── PULL_REQUEST_TEMPLATE.md
│
├── app/                       # Next.js App Router
│   ├── (auth)/login/
│   ├── (tenant)/              # Protected, tenant-scoped routes
│   ├── auth/callback/         # Magic-link exchange
│   └── api/auth/              # request-link endpoint
│
├── lib/
│   ├── api/                   # ok/err/warn, withApi, error codes
│   ├── supabase/              # server, browser, service, types
│   └── tenant/                # host parsing, company/workspace resolution, context
│
├── supabase/
│   ├── config.toml
│   ├── migrations/            # 0001-0005 SQL
│   └── seed.sql
│
├── docs/                      # ARCHITECTURE, AUTH, RLS, TENANCY, DEPLOY, ENV,
│                              # CONVENTIONS, RECIPES, RISKS
├── skills/                    # add-table, add-api-route, add-auth-flow, add-admin-action,
│                              # setup-supabase
└── examples/
    └── end-to-end-flow.md     # Annotated trace of a request from login to data fetch
```

## License

This template is released under the MIT license. Use it for any project,
commercial or otherwise.