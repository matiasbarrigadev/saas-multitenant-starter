<!--
AGENTS.md — Universal, vendor-neutral instructions for any AI agent
(Claude Code, Cursor, Windsurf, Copilot, open-source agents, etc.).

Design notes:
- Uses XML tags (<background_information>, <instructions>, ...) plus Markdown
  H2 sections. Anthropic's context-engineering guidance (Sep 2025) recommends
  this hybrid for agent prompts because it lets any model cleanly separate
  concerns without depending on a specific tool's conventions.
- Plain markdown so any file-reading agent can ingest it without translation.
- Sections are deliberately abstract — they constrain WHAT the agent produces
  without prescribing WHICH tool the agent uses.
- Every rule has a "why" link to a doc so the agent can deep-read instead of
  guessing.
-->

<background_information>
This repository is a **multitenant SaaS starter template** built on
Next.js (App Router) + Supabase + Vercel. It implements two-level tenancy
(Company ↔ Workspace) with magic-link auth, Postgres Row Level Security,
subdomain-based company resolution, and path-based workspace resolution.

The codebase is a **starting point**, not an application. Agents that
extend it produce new code that lives inside this structure, using the
existing helpers and the conventions listed below.

Before writing code, agents MUST read in order:
1. `llms.txt` — repository navigation
2. This file (`AGENTS.md`) — non-negotiable rules
3. `docs/CONVENTIONS.md` — naming, file structure, antipatterns
4. `docs/RECIPES.md` — canonical examples for common extensions
5. `docs/ARCHITECTURE.md` — why the template is shaped this way
</background_information>

<scope>
This file constrains **how** agents modify this codebase. It does NOT
describe how to use any specific AI tool (Claude Code, Cursor, etc.).
Tool-specific adapter rules (if used) live alongside this file under
`./agents-rules/` as plain markdown — agents that recognize a given file
format can load it; agents that don't, ignore it.
</scope>

# AGENTS.md — Multitenant Template Agent Instructions

> Universal, vendor-neutral. Applies to any AI coding agent modifying this codebase.

## 1. Core principles (always)

<critical_rules>

### 1.1 Tenancy boundary

- **The data isolation boundary is `workspace_id`**, not `company_id`. Every
  new tenant-scoped table MUST have a `workspace_id uuid not null references
  public.workspaces(id) on delete cascade` column, an index on it, and RLS
  policies keyed on `public.current_workspace_id()`.
  Reference: `docs/RLS.md`.

- **Never add a tenant-scoped column without RLS.** RLS must be enabled the
  moment the table is created (`alter table ... enable row level security`),
  not in a later migration. The window between table creation and RLS is a
  data-leak window.

### 1.2 Auth rules

- **Use `supabase.auth.getClaims()` on the server, never `getSession()` and
  never `getUser()`.** `getClaims` validates the JWT signature every call.
  Reference: `docs/AUTH.md`.

- **The `service_role` client (`lib/supabase/service.ts`) bypasses RLS.**
  It is allowed ONLY in:
  - `app/(tenant)/api/me/switch-workspace/route.ts` (admin user metadata update)
  - Server Actions / Route Handlers that explicitly justify the bypass in a
    code comment.
  Never import `service.ts` from a Client Component. Never import it from a
  Server Component for routine reads/writes.

### 1.3 Cache safety

- **Every authenticated HTTP response MUST include `Cache-Control: no-store`.**
  This is enforced by `lib/api/handler.ts` for all Route Handlers wrapped in
  `withApi()`, and by `proxy.ts` for the rest. Do not bypass it. Cross-tenant
  session leakage via shared CDN edges is the #1 documented production failure
  mode for this template's stack.

### 1.4 Runtime choice

- **Default to Node.js runtime.** Edge runtime has hard limits (no
  `node:fs`, no native node_modules, no ISR) and is reserved for cases that
  genuinely need global, DB-free latency. Do not switch a route to Edge
  "to be modern". If you think a route needs Edge, write a one-paragraph
  justification in the route's top-level comment.

</critical_rules>

## 2. File layout (predictable, agent-discoverable)

```
.
├── AGENTS.md                  ← this file (read first)
├── llms.txt                   ← navigation map for agents
├── llms-ctx.txt               ← same map without the Optional section
├── registry.json              ← shadcn registry entries (installable)
├── components.json            ← shadcn project config (aliases)
├── README.md                  ← human quickstart
├── package.json
├── tsconfig.json              ← path aliases (see §2.1)
├── next.config.ts
├── proxy.ts                   ← tenant resolution + auth refresh
│
├── app/                       ← Next.js App Router
│   ├── (auth)/login/
│   ├── (tenant)/              ← protected, tenant-scoped routes
│   │   ├── api/               ← Route Handlers, ALWAYS wrapped in withApi()
│   │   ├── layout.tsx         ← protected layout (auth + workspace check)
│   │   └── */page.tsx
│   ├── auth/callback/         ← magic-link exchange
│   └── api/auth/              ← public auth endpoints
│
├── lib/
│   ├── api/                   ← ok/err/warn, withApi, error codes
│   ├── supabase/              ← server, browser, service, types
│   └── tenant/                ← host, company/workspace resolution, context
│
├── components/
│   └── ui/                    ← shadcn convention (added by registry)
│
├── supabase/
│   ├── config.toml
│   ├── migrations/            ← NUMBERED SQL files only (0001_xxx.sql)
│   └── seed.sql
│
├── docs/                      ← human + agent docs
│   ├── ARCHITECTURE.md
│   ├── AUTH.md
│   ├── RLS.md
│   ├── TENANCY.md
│   ├── DEPLOY.md
│   ├── ENV.md
│   ├── CONVENTIONS.md         ← mandatory reading for agents
│   └── RECIPES.md             ← canonical, copy-pasteable examples
│
└── skills/                    ← abstract agent-facing recipes (this template)
    ├── add-table.md
    ├── add-api-route.md
    ├── add-auth-flow.md
    └── add-admin-action.md
```

### 2.1 Path aliases (tsconfig)

These aliases are committed and must NOT be renamed by agents:

| Alias | Maps to |
|---|---|
| `@/*` | repo root |
| `@/app/*` | `app/*` |
| `@/lib/*` | `lib/*` |
| `@/components/*` | `components/*` |
| `@/supabase/*` | `supabase/*` |
| `@/docs/*` | `docs/*` |
| `@/skills/*` | `skills/*` |

Agents MUST use these aliases — never invent new ones, never invent
relative paths like `../../lib/api`.

## 3. Naming conventions (mandatory)

<conventions>

### 3.1 SQL

- Tables: `snake_case`, plural nouns (`notes`, `memberships`, `companies`).
- Columns: `snake_case`.
- Primary keys: `id uuid primary key default gen_random_uuid()` — explicit
  `default gen_random_uuid()` is required even though Postgres infers it.
- Foreign keys: `created_at`, `updated_at`, `archived_at` — three timestamps
  where applicable. Always `timestamptz not null default now()`.
- RLS policies: `tablename_action_description` (e.g.
  `notes_select_active_workspace`, `memberships_insert_admin_only`).
- Migrations: numbered `NNNN_description.sql` starting at the next number in
  the existing sequence (`0001_init_tenants.sql` ... `0005_notes_example.sql`).
  Never edit a committed migration. Add a new one.

### 3.2 TypeScript

- Files: `kebab-case.ts` or `kebab-case.tsx`.
- React components: `PascalCase` exports.
- Functions / variables: `camelCase`.
- Types / interfaces: `PascalCase`.
- Booleans: `is*`, `has*`, `should*`, `can*` prefixes.
- Errors: `class FooError extends Error` with a stable `code` property when
  related to API responses.

### 3.3 File headers

Every TypeScript file MUST start with a top-level JSDoc comment that
includes:

1. A one-line purpose statement.
2. (If relevant) the runtime (Node / Edge / Browser).
3. (If relevant) any "danger" markers for service role, RLS bypass, etc.
4. (If relevant) cross-references to docs that explain *why*.

Reference examples throughout this codebase (do not just copy — adapt the
shape).

</conventions>

## 4. Extending the codebase (recipe prompts)

When you need to add a new feature, **do not freestyle**. Find the matching
recipe in `skills/` or `docs/RECIPES.md` first. The recipes are:

| To add... | Read |
|---|---|
| A new tenant-scoped table | `skills/add-table.md` |
| A new API route | `skills/add-api-route.md` |
| A new auth provider / sign-in method | `skills/add-auth-flow.md` |
| An admin operation (e.g. invites) | `skills/add-admin-action.md` |
| A new UI page in the protected area | `docs/RECIPES.md` § UI |
| A new migration with RLS | `docs/RECIPES.md` § Migrations |

These recipes are **canonical, minimal, complete**. Use them as templates —
do not invent your own structure.

## 5. Pre-commit checklist (mandatory)

Before declaring any change "done", the agent MUST have:

- [ ] **Verified typecheck** (`tsc --noEmit` or equivalent) — exits 0.
- [ ] **Verified build** (`next build`) — exits 0.
- [ ] **Verified RLS** — every new tenant-scoped table has RLS enabled AND
      a policy for each of `select`, `insert`, `update`, `delete`.
- [ ] **Verified `lib/env.ts`** — any new env var added is declared in
      `.env.example` AND validated in the Zod schema.
- [ ] **Verified `llms.txt`** — if any new documentation file was added,
      it's listed in `llms.txt` under the appropriate H2 section.
- [ ] **Verified paths** — used aliases from §2.1, not invented paths.
- [ ] **Verified conventions** — followed §3 naming + headers.
- [ ] **Verified `withApi` usage** — every new Route Handler wraps its
      handler in `withApi()` so cache headers + error mapping apply.
- [ ] **No new `service_role` use** without an explicit justification
      comment in the file, plus an entry in `docs/RISKS.md` if one exists.

## 6. Forbidden actions (never)

<forbidden>

- ❌ Never commit a `.env` or `.env.local` file.
- ❌ Never add `getSession()` / `getUser()` server-side. Use `getClaims()`.
- ❌ Never edit a committed SQL migration. Add a new one.
- ❌ Never bypass `proxy.ts` (e.g. by reading auth in middleware you wrote
      inline) — `proxy.ts` is the single source of truth for tenant resolution.
- ❌ Never import `lib/supabase/service.ts` from a Client Component, or from
      a Server Component for reads/writes that RLS could handle.
- ❌ Never write `const x: any` to silence TypeScript. Use a precise type.
- ❌ Never rename path aliases from §2.1.
- ❌ Never create a file at the project root that isn't listed in
      `llms.txt`. If you create one, update `llms.txt` in the same change.
- ❌ Never hardcode a tenant ID, company slug, or workspace slug. Read it
      from context (`@/lib/tenant/context.ts`).

</forbidden>

## 7. How to recognize "you're off-track"

<diagnostics>

If you're about to:
- Write a `.env` file → stop, update `.env.example` and `lib/env.ts` instead.
- Add a `seed.ts` next to `seed.sql` → stop, the project uses SQL seed only.
- Open a database connection from `app/**/page.tsx` → stop, use a Server
  Component or Route Handler with `@/lib/supabase/server`.
- Use `fetch('https://...supabase.co/...')` directly → stop, use the
  Supabase client. Direct REST is fine only for migrations / admin scripts.
- Create a Client Component that calls `@/lib/supabase/server` → stop,
  that's the wrong client. Use `@/lib/supabase/browser`.

When in doubt: read `docs/ARCHITECTURE.md` (the why) before reading any
specific file (the what).

</diagnostics>

## 8. Optional reading (for context-trimming)

If the calling agent's context budget is tight, this document's rules 1–7
are the MUST-know. The following are secondary, droppable:

- §2 (file layout) can be skipped if the agent has access to `ls` or
  `list_dir`.
- §3 (naming) can be relaxed if the project has already drifted; pick
  consistency over the rule.
- §8 (this section) is informational only.

For a budget-tight loop: read §1 (principles) + §6 (forbidden) + the
single relevant `skills/*.md`. That is sufficient to make safe, idiomatic
changes.

---

## Cross-references

- `llms.txt` — repository navigation map.
- `docs/CONVENTIONS.md` — what this file says, in prose, with examples.
- `docs/RECIPES.md` — copy-pasteable canonical extensions.
- `docs/ARCHITECTURE.md` — the design decisions behind these rules.
- `docs/AUTH.md`, `docs/RLS.md`, `docs/TENANCY.md`, `docs/DEPLOY.md`,
  `docs/ENV.md` — vertical docs as needed.

When this file and any of those conflict, this file wins for *rules*;
the docs win for *rationale*.
