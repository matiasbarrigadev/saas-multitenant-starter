-- =============================================================================
-- Migration 0004: Helper functions used by RLS policies and the BFF.
--
-- These read from `auth.jwt() -> 'app_metadata'`. The values are set by:
--   1. The custom_access_token_hook (migration 0003) for company_memberships.
--   2. The /api/me/switch-workspace endpoint for active_* values (it calls
--      supabase.auth.admin.updateUserById to write app_metadata).
--
-- All functions are STABLE so the query planner can call them once per
-- statement (cheaper than VOLATILE).
-- =============================================================================

-- ---- current_workspace_id() -------------------------------------------------
-- Returns the workspace_id the user is currently working in. Set via
-- /api/me/switch-workspace.
create or replace function public.current_workspace_id()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claim.app_metadata.active_workspace_id', true),
    ''
  )::uuid;
$$;

comment on function public.current_workspace_id() is
  'Active workspace_id from JWT app_metadata. NULL until /api/me/switch-workspace is called.';

-- ---- current_company_id() ---------------------------------------------------
-- Returns the company_id of the active workspace. Derived from the active
-- workspace, so it stays consistent.
create or replace function public.current_company_id()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claim.app_metadata.active_company_id', true),
    ''
  )::uuid;
$$;

comment on function public.current_company_id() is
  'Active company_id from JWT app_metadata. NULL until /api/me/switch-workspace is called.';

-- ---- current_user_role() ----------------------------------------------------
-- Role of the current user in their active workspace.
create or replace function public.current_user_role()
returns public.role
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claim.app_metadata.active_role', true),
    ''
  )::public.role;
$$;

comment on function public.current_user_role() is
  'Role of current user in active workspace. Used to gate admin-only operations.';

-- ---- user_can_access_workspace(workspace_id) --------------------------------
-- Used by /api/me/switch-workspace to verify that the user actually has a
-- membership in the workspace they're trying to activate. Runs as the
-- service role, so RLS doesn't apply here.
create or replace function public.user_can_access_workspace(workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.workspace_id = user_can_access_workspace.workspace_id
  );
$$;

-- Grants: service_role needs to call this from API code that bypasses RLS.
-- We grant to authenticated too so it can self-check (e.g. the switch
-- endpoint can call it from the user's own session).
revoke all on function public.user_can_access_workspace(uuid) from public;
grant execute on function public.user_can_access_workspace(uuid) to authenticated;
grant execute on function public.user_can_access_workspace(uuid) to service_role;

comment on function public.user_can_access_workspace(uuid) is
  'True if any membership row exists for the given workspace.';

-- ---- Convenience: get memberships from JWT ---------------------------------
-- Helper for BFF code that wants to read the list of workspaces directly
-- from the JWT without an extra query. Returns jsonb array.
create or replace function public.current_company_memberships()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(
      current_setting('request.jwt.claim.app_metadata.company_memberships', true),
      ''
    )::jsonb,
    '[]'::jsonb
  );
$$;

comment on function public.current_company_memberships() is
  'List of all (company, workspace, role) tuples for the current user. Read from JWT.';