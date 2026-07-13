-- =============================================================================
-- Migration 0005: Example tenant-scoped table (`notes`).
--
-- Purpose: demonstrate the RLS pattern end-to-end. Copy this template when
-- adding new tenant-scoped tables. Documented in docs/RLS.md.
--
-- Pattern summary:
--   1. Every row carries a workspace_id (the data isolation boundary).
--   2. RLS enabled from day one (no window where data leaks via publishable
--      key).
--   3. SELECT: scoped to current_workspace_id().
--   4. INSERT: scoped + author_id must equal auth.uid().
--   5. UPDATE: scoped + author_id must equal auth.uid() OR role is admin+.
--   6. DELETE: scoped + role is admin+.
-- =============================================================================

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '',
  author_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.notes is
  'Example tenant-scoped table. RLS keyed on workspace_id. Copy this pattern.';

create index if not exists idx_notes_workspace on public.notes(workspace_id);
create index if not exists idx_notes_author   on public.notes(author_id);

drop trigger if exists trg_notes_updated_at on public.notes;
create trigger trg_notes_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ---- RLS --------------------------------------------------------------------
alter table public.notes enable row level security;

-- SELECT: any member of the active workspace can read all notes in it.
drop policy if exists notes_select_active_workspace on public.notes;
create policy notes_select_active_workspace
  on public.notes
  for select
  to authenticated
  using (workspace_id = public.current_workspace_id());

-- INSERT: must be in the active workspace AND you must be the author.
drop policy if exists notes_insert_active_workspace on public.notes;
create policy notes_insert_active_workspace
  on public.notes
  for insert
  to authenticated
  with check (
    workspace_id = public.current_workspace_id()
    and author_id = auth.uid()
  );

-- UPDATE: must be in the active workspace AND (you're the author OR admin+).
-- We use `in` so the policy stays simple. Adjust the role set as needed.
drop policy if exists notes_update_author_or_admin on public.notes;
create policy notes_update_author_or_admin
  on public.notes
  for update
  to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and (
      author_id = auth.uid()
      or public.current_user_role() in ('owner', 'admin')
    )
  )
  with check (
    workspace_id = public.current_workspace_id()
    and (
      author_id = auth.uid()
      or public.current_user_role() in ('owner', 'admin')
    )
  );

-- DELETE: must be in the active workspace AND admin+. Members can edit their
-- own notes but cannot delete others'.
drop policy if exists notes_delete_admin_only on public.notes;
create policy notes_delete_admin_only
  on public.notes
  for delete
  to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_user_role() in ('owner', 'admin')
  );