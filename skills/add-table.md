<!--
add-table.md — Vendor-neutral skill for adding a tenant-scoped table.

Format is intentionally abstract. Any AI agent that can read files and
produce code can follow this. The skill produces files; it does NOT
depend on a specific agent harness, plugin format, or tool name.

Each step has:
  - WHY: the rationale (so agents can generalize, not just copy)
  - WHAT: the file(s) to create/modify
  - HOW: a code template or procedure
  - VERIFY: how the agent should confirm the change works

Read order: AGENTS.md → docs/RLS.md → this file → existing notes migration
as a worked example.
-->

# Skill: Add a tenant-scoped table

## Pre-flight

1. Read `AGENTS.md` (non-negotiable rules).
2. Read `docs/CONVENTIONS.md` § SQL.
3. Read `docs/RLS.md` (full).
4. Read the existing `supabase/migrations/0005_notes_example.sql` end to
   end. It is the canonical worked example.
5. Confirm the new entity genuinely needs `workspace_id` (not just
   `company_id`). See `docs/TENANCY.md` if unsure.

## When NOT to use this skill

- The new table is **not** tenant-scoped (e.g. a static reference table).
  In that case, place it under a different schema or skip RLS entirely
  with a comment explaining why.
- You're modifying an existing table. Add a new migration instead of
  editing one (see `docs/CONVENTIONS.md` § 3.3).

## Output

The agent produces:

1. **One new migration file** at `supabase/migrations/NNNN_<snake_name>.sql`
   where `NNNN` is the next number in the sequence and `<snake_name>`
   matches the new table's purpose.
2. **Updated types** at `lib/supabase/types.ts` adding `Row`, `Insert`,
   `Update` for the new table.
3. (If client-side rendering is needed) **A typed Supabase client call**
   already types the row automatically once the types are updated.

## Step 1 — Plan the columns

Before writing code, list:
- Required columns (`not null`).
- Optional columns (`null` allowed).
- Foreign keys (with `on delete` semantics).
- Status fields (use a `check` constraint with a literal set).
- Timestamps (always `timestamptz`, always `not null default now()`).
- An `author_id`-style column if members create these rows (call it
  whatever matches your domain — `created_by`, `author_id`, etc.).

## Step 2 — Write the migration

### WHY

- One migration = one focused change. Easier to review, easier to roll
  back, easier to audit.
- RLS enabled the moment the table exists. No window of data leak via
  the publishable key.
- Indexes go on `(workspace_id, ...)` patterns; RLS reads `workspace_id`
  first, so an unindexed table will be slow on every query.

### WHAT

Create `supabase/migrations/NNNN_<snake_name>.sql`.

### HOW

Use this skeleton. Replace every `<placeholder>` with your domain.

```sql
-- =============================================================================
-- Migration NNNN: <one-line description>.
-- Follows the pattern from 0005_notes_example.sql.
-- =============================================================================

create table if not exists public.<table_name> (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- domain fields below
  <col_1> <type> not null,
  <col_2> <type>,
  <col_n> <type>,
  -- standard timestamps
  created_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.<table_name> is
  '<one-line description. See docs/RLS.md.>';

-- Indexes — pick the columns that will be queried with workspace_id.
create index idx_<table_name>_workspace on public.<table_name>(workspace_id);
-- Optional: secondary indexes for common filter patterns.
-- create index idx_<table_name>_status on public.<table_name>(workspace_id, status);

-- updated_at trigger (re-uses the function from 0001).
drop trigger if exists trg_<table_name>_updated_at on public.<table_name>;
create trigger trg_<table_name>_updated_at
  before update on public.<table_name>
  for each row execute function public.set_updated_at();

-- ⚠️ Enable RLS the moment the table is created.
alter table public.<table_name> enable row level security;

-- RLS policies — adapt the action names to your domain.
-- For most tables, follow notes' four-policy pattern:
create policy <table_name>_select_active_workspace on public.<table_name>
  for select to authenticated
  using (workspace_id = public.current_workspace_id());

create policy <table_name>_insert_active_workspace on public.<table_name>
  for insert to authenticated
  with check (
    workspace_id = public.current_workspace_id()
    and created_by = auth.uid()
  );

create policy <table_name>_update_author_or_admin on public.<table_name>
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

create policy <table_name>_delete_admin_only on public.<table_name>
  for delete to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_user_role() in ('owner', 'admin')
  );
```

## Step 3 — Update the typed Database

### WHY

The Supabase client returns `unknown` for any table not in
`lib/supabase/types.ts`. You want `supabase.from("<table_name>").select()`
to return a typed value, otherwise downstream code loses type safety.

### WHAT

Append to `Database.public.Tables` in `lib/supabase/types.ts`:

### HOW

```ts
<table_name>: {
  Row: <Row shape>;
  Insert: Omit<Row, "id" | "created_at" | "updated_at"> & {
    id?: string;
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<Row>;
};
```

If you regenerate types via `supabase gen types typescript`, simply keep
the file under the same name and re-import. No code change.

## Step 4 — Optional: create the API route

If the user wants a typed Route Handler for the new table, follow
`skills/add-api-route.md`.

## VERIFY

Before declaring done, the agent confirms:

- [ ] `npx supabase db diff` reports the migration applies cleanly with
      no diff against `supabase/migrations/NNNN_<name>.sql`.
- [ ] With a JWT in workspace `marketing`, running
      `select * from <table_name>` returns only Marketing rows (RLS works).
- [ ] Switching to workspace `sales` via `/settings` hides the Marketing
      rows.
- [ ] The new table appears in `lib/supabase/types.ts` so the typed
      client returns proper rows.
- [ ] `llms.txt` mentions the new resource if a new doc was added.
- [ ] If a UI page was added, the project builds (`pnpm build`).

## Rollback

To roll back:

1. Add a new migration `NNNNx_drop_<table_name>.sql` with
   `drop table public.<table_name> cascade;`. Never delete the original
   migration.
2. Remove the `Database.public.Tables.<table_name>` entry from
   `lib/supabase/types.ts`.
3. Remove any `app/(tenant)/api/<table_name>/route.ts` you added.
4. Update `llms.txt`.

The migration system treats every migration as forward-only. This keeps
production environments in sync.
