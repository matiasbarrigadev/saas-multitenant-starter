-- =============================================================================
-- Migration 0002: Row Level Security policies for tenant tables.
--
-- Pattern: every policy is keyed on a helper function that reads
-- `auth.jwt() -> 'app_metadata'`. The JWT is populated by the
-- `custom_access_token_hook` (see 0003).
--
-- All policies use the `authenticated` role. The `anon` role cannot read or
-- write anything; if you need public pages, expose them via the Supabase API
-- explicitly with a `for select to anon using (...)` policy.
-- =============================================================================

-- ---- Companies --------------------------------------------------------------
-- A user can read a company only if they have at least one membership in it.
-- Writes (insert/update/delete) are admin-only via service_role; no policy
-- below means no `to authenticated` user can write.
drop policy if exists companies_select_for_members on public.companies;
create policy companies_select_for_members
  on public.companies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.company_id = companies.id
        and m.user_id = auth.uid()
    )
  );

-- ---- Workspaces -------------------------------------------------------------
-- Read: any member of the workspace's parent company can see all workspaces
-- in that company. (Agencies want to browse workspaces; alternative would be
-- to restrict to "members of the workspace only", but that's stricter.)
drop policy if exists workspaces_select_for_company_members on public.workspaces;
create policy workspaces_select_for_company_members
  on public.workspaces
  for select
  to authenticated
  using (
    company_id = public.current_company_id()
  );

-- ---- Profiles ---------------------------------------------------------------
-- A user can always see their own profile.
-- Reading other profiles is allowed only within the same company (so the
-- "Members" page can list teammates without leaking across companies).
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_company_mates on public.profiles;
create policy profiles_select_company_mates
  on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.user_id = profiles.id
        and m.company_id = public.current_company_id()
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---- Memberships ------------------------------------------------------------
-- Read: a user can see all memberships in their currently-active company.
-- This is what powers the "Members" page in the admin UI.
drop policy if exists memberships_select_via_company on public.memberships;
create policy memberships_select_via_company
  on public.memberships
  for select
  to authenticated
  using (company_id = public.current_company_id());

-- Insert/update/delete: only service_role can manage memberships.
-- This means invitations, role changes, and removals must go through a
-- Route Handler that uses the service client. (Documented in AUTH.md.)
-- No policies = no access for `authenticated`.