# Conventions

> Companion to `AGENTS.md`. This file is the human-readable version of the
> same rules, with examples. AGENTS.md is canonical for machine reading;
> this file wins for clarity and rationale.

## At a glance

| Domain | Convention |
|---|---|
| SQL tables | `snake_case`, plural |
| SQL columns | `snake_case` |
| SQL migrations | `NNNN_description.sql` |
| TS files | `kebab-case.ts` / `kebab-case.tsx` |
| TS components | `PascalCase` exports |
| TS variables | `camelCase` |
| TS booleans | `is*` / `has*` / `should*` / `can*` |
| TS errors | `class FooError extends Error` with stable `code` |
| Path aliases | `@/lib`, `@/app`, `@/components`, `@/supabase`, `@/docs`, `@/skills` |

## Naming, with examples

### SQL

```sql
-- ✅ Table: plural, snake_case.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- ...

  -- ✅ Columns: snake_case.
  amount_cents integer not null,
  status text not null default 'draft',
  issued_at timestamptz,
  paid_at timestamptz,

  -- ✅ Timestamps: timestamptz + default now().
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ✅ Constraints: snake_case, descriptive.
alter table public.invoices
  add constraint invoices_amount_positive check (amount_cents > 0);

-- ❌ Bad: camelCase, missing timestamptz, ambiguous name.
-- create table Invoices ( id uuid pk, WorkspaceId uuid, createdAt timestamp );
```

### RLS policies

```sql
-- ✅ Pattern: tablename_action_description.
create policy notes_select_active_workspace on public.notes
  for select to authenticated
  using (workspace_id = public.current_workspace_id());

create policy notes_insert_active_workspace on public.notes
  for insert to authenticated
  with check (workspace_id = public.current_workspace_id());

create policy notes_update_author_or_admin on public.notes
  for update to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and (author_id = auth.uid() or public.current_user_role() in ('owner', 'admin'))
  )
  with check (
    workspace_id = public.current_workspace_id()
    and (author_id = auth.uid() or public.current_user_role() in ('owner', 'admin'))
  );

create policy notes_delete_admin_only on public.notes
  for delete to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_user_role() in ('owner', 'admin')
  );
```

### Migrations

```
supabase/migrations/
├── 0001_init_tenants.sql
├── 0002_rls_policies.sql
├── 0003_auth_hook.sql
├── 0004_helper_functions.sql
├── 0005_notes_example.sql
└── 0006_invoices.sql   ← next agent adds here
```

- **Never edit a committed migration.** If a change is needed, write a new
  migration that supersedes the prior one (e.g. `0007_invoices_add_tax_field.sql`).
- Migrations are ordered numerically. If two migrations are created in
  parallel, the one with the higher number wins in the conflict.
- One migration = one focused change. Don't bundle unrelated changes.

### TypeScript files

```
lib/
├── api/
│   ├── handler.ts          ← kebab-case ✓
│   ├── response.ts
│   └── errors.ts
├── supabase/
│   ├── server.ts
│   └── service.ts
└── tenant/
    ├── host.ts             ← single-word, no need for separator
    ├── resolve-company.ts  ← multi-word, kebab-case
    └── resolve-workspace.ts
```

### React components

```tsx
// ✅ PascalCase export, kebab-case file name.
// File: app/(tenant)/dashboard/page.tsx
export default function DashboardPage() { /* ... */ }

// ❌ default function dashboardPage() — camelCase export.
// ❌ file app/(tenant)/dashboard/dashboardPage.tsx — name doesn't match file.
```

### Functions and variables

```ts
// ✅ camelCase.
const currentCompanySlug = parseHost(req.headers.get("host"));
function buildLoginUrl(host: ParsedHost, nextPath: string) { /* ... */ }

// ✅ Boolean prefixes.
const isAuthenticated = !!claims;
const hasWorkspaceAccess = memberships.length > 0;
const shouldRefreshSession = claims.expiresAt - now < 60_000;
const canDeleteNote = role in ["owner", "admin"];
```

### Error classes

```ts
// ✅ Class name ends in Error, has a stable code property.
export class TenantContextError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "AUTH_REQUIRED"
      | "COMPANY_MISMATCH"
      | "WORKSPACE_REQUIRED"
      | "WORKSPACE_FORBIDDEN"
  ) {
    super(message);
    this.name = "TenantContextError";
  }
}

// ❌ throw new Error("no active workspace") — no machine-readable code.
```

## Path aliases

All aliases live in `tsconfig.json` and `components.json`. They match
each other.

| Alias | Use |
|---|---|
| `@/app/...` | Pages, layouts, route handlers |
| `@/lib/api/...` | API helpers (`ok`, `err`, `withApi`, error codes) |
| `@/lib/supabase/...` | Supabase clients |
| `@/lib/tenant/...` | Tenant resolution + context |
| `@/components/...` | UI components (shadcn convention) |
| `@/supabase/...` | SQL migrations, config.toml |
| `@/docs/...` | Documentation |
| `@/skills/...` | Agent-facing recipes |
| `@/*` | Anything (last resort, prefer specific aliases) |

**Never** use relative paths like `../../lib/api/handler`. **Never**
introduce new aliases — add to the list above if a new pattern emerges.

## File headers

Every TypeScript file MUST have a JSDoc header at the top. Minimum:

```ts
/**
 * One-line purpose.
 *
 * (Optional: runtime note — Node / Edge / Browser)
 * (Optional: danger markers — RLS-bypass, env mutation, etc.)
 * (Optional: cross-references to docs that explain *why*.)
 */
```

Reference examples throughout the codebase (see `lib/supabase/server.ts`,
`proxy.ts`, `lib/api/handler.ts`). Don't copy verbatim — adapt the shape.

## API response shape

Every Route Handler returns one of three shapes from `lib/api/response.ts`:

```ts
// Success.
{ ok: true,  data: T,         meta?: {...} }

// Success with a soft warning (e.g. notification failed but data saved).
{ ok: true,  data: T, warning: { code, message } }

// Failure (always includes a requestId for log correlation).
{
  ok: false,
  error: { code: ApiErrorCode, message: string, details?: unknown },
  requestId: string
}
```

- `code` MUST come from `ApiErrorCode` (see `lib/api/errors.ts`). Don't
  invent string codes ad-hoc.
- `message` MUST be safe to show to the end user. Internal details go in
  `details` or in server logs only.
- Add new codes to the catalog; don't define them inline.

## When in doubt

- New SQL table → `docs/RLS.md` recipe + `skills/add-table.md`.
- New Route Handler → `skills/add-api-route.md`.
- New admin operation → `skills/add-admin-action.md`.
- Naming dispute → this file wins.
- Multiple valid approaches → read `docs/ARCHITECTURE.md` (the "why")
  first, then pick the one that best matches the existing precedent.

## Antipatterns (never do)

- ❌ Inline SQL in a Server Component. Always use the Supabase client.
- ❌ `useEffect` for fetching tenant data on a Server Component. They run
  on the server; just await.
- ❌ Hardcoding a tenant ID, company slug, or workspace slug as a string.
  Read from context (`@/lib/tenant/context.ts`) or fail loudly.
- ❌ Hand-rolling auth. Use `@/lib/supabase/server.ts`.
- ❌ Returning raw Supabase errors to the API client. Map them through
  `ApiErrorCode`.
- ❌ Adding a new table without `enable row level security`.
- ❌ Modifying a committed migration.
- ❌ Creating a `.env` file (use `.env.example`).
- ❌ Side-effect imports in route handlers.
- ❌ Creating a `seed.ts` next to `seed.sql`. SQL seed only.