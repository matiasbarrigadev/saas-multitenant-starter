# Row Level Security

How to add a tenant-scoped table that obeys the multi-tenant rules. The
example uses the `notes` table from `supabase/migrations/0005_notes_example.sql`.

## The pattern

Every tenant-scoped table:

1. Has a `workspace_id uuid not null references public.workspaces(id)` column.
2. Has a foreign key index.
3. Has RLS enabled (`alter table ... enable row level security`).
4. Has 4 policies — one for each operation:
   - `select`: visible if `workspace_id = public.current_workspace_id()`.
   - `insert`: writable if `workspace_id = public.current_workspace_id()` AND author identity matches.
   - `update`: as insert, plus role-based for sensitive changes.
   - `delete`: usually admin-only.

## Why `current_workspace_id()` and not `auth.uid()` directly?

Because `workspace_id` is in the JWT (set by the switch-workspace endpoint
→ re-stamped by the custom_access_token_hook). Evaluating it is a single
JSON lookup, no table join. RLS policies that join `memberships` to filter
data would be O(rows × memberships) per query.

## Helper functions

The functions in `0004_helper_functions.sql` are the only things RLS
policies should reference:

- `public.current_workspace_id()` → `uuid` — the active workspace.
- `public.current_company_id()` → `uuid` — the active company.
- `public.current_user_role()` → `role` — the user's role in the active workspace.
- `public.user_can_access_workspace(uuid)` → `boolean` — checks a specific workspace.

If you find yourself writing raw `auth.jwt() -> ...` in a policy, extract
it to a helper. It keeps policies readable.

## Recipe: adding a `projects` table

```sql
-- 1. Schema (in a new migration, e.g. 0006_projects.sql)
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text default '',
  created_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_projects_workspace on public.projects(workspace_id);

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

-- 2. Policies
create policy projects_select_active_workspace on public.projects
  for select to authenticated
  using (workspace_id = public.current_workspace_id());

create policy projects_insert_active_workspace on public.projects
  for insert to authenticated
  with check (
    workspace_id = public.current_workspace_id()
    and created_by = auth.uid()
  );

create policy projects_update_active_workspace on public.projects
  for update to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and (
      created_by = auth.uid()
      or public.current_user_role() in ('owner', 'admin')
    )
  )
  with check (
    workspace_id = public.current_workspace_id()
    and (
      created_by = auth.uid()
      or public.current_user_role() in ('owner', 'admin')
    )
  );

create policy projects_delete_admin_only on public.projects
  for delete to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_user_role() in ('owner', 'admin')
  );
```

## When you need company-scoped data

Some tables naturally live at company level (e.g. the list of workspaces
themselves, or aggregate billing data). Use `current_company_id()`:

```sql
create policy workspaces_select_via_company on public.workspaces
  for select to authenticated
  using (company_id = public.current_company_id());
```

This is the pattern used by `0002_rls_policies.sql` for the workspaces
table itself.

## Pitfalls

- **Forgetting to enable RLS on a new table.** Until you add policies, the
  table is invisible to anon/publishable-key clients, but admins (service role)
  still see everything. Set `alter table ... enable row level security`
  the moment you create the table.
- **Forgetting to grant to `authenticated`.** RLS policies default to
  denying everything. If you write `for select using (...)` but forget
  `to authenticated`, no one can read.
- **Writing `auth.uid() = x` instead of `(select auth.uid()) = x`.** The
  difference is one-time initPlan vs. per-row evaluation. For simple
  columns the perf difference is negligible, but for queries with joins
  the wrapping is a free speedup.
- **Caching issues.** A user changes workspace via the API; their next
  request still shows the old active workspace because of a stale token.
  Make sure `switch-workspace` calls `refreshSession()` (it does in this
  template) so the cookie reflects the new state immediately.

## Testing RLS

The recommended way to test policies in isolation:

```sql
-- In psql or Supabase SQL editor:
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object(
    'sub', '<user-uuid>',
    'app_metadata', json_build_object(
      'active_workspace_id', '<workspace-uuid>',
      'active_company_id', '<company-uuid>',
      'active_role', 'member'
    )
  )::text,
  true
);

-- Now run your queries. They should return only data for the
-- workspace you set.
```

Or use the Supabase SQL Editor's "Run as authenticated" feature.