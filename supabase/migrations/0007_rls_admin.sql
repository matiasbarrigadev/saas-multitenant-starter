-- =============================================================================
-- Migration 0007: RLS policies for admin tables (0006_admin_panel.sql).
--
-- Pattern: every policy keys off a helper function (is_super_admin(),
-- is_company_admin()). Helpers themselves were defined in 0006; this
-- file only declares which rows each role can read/write.
--
-- No INSERT/UPDATE/DELETE policies are granted to `authenticated` for
-- audit_events. Only service_role writes — same pattern as memberships
-- in 0002. This is enforced at the route layer (lib/admin/audit.ts).
-- =============================================================================

-- ---- audit_events -----------------------------------------------------------
-- SELECT:
--   - super_admin sees everything.
--   - Regular users see events that:
--       (a) happened in their active company, OR
--       (b) targeted them (actor_user_id = auth.uid()).
--   This covers two practical cases:
--     - "What happened to MY workspace today?" → uses (a).
--     - "What did I personally do?" → uses (b).
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (
    public.is_super_admin()
    or company_id = public.current_company_id()
    or actor_user_id = auth.uid()
  );

-- No INSERT/UPDATE/DELETE for authenticated. Only service_role writes.

-- ---- workspace_module_grants -----------------------------------------------
-- SELECT: company admin (or super_admin) can read grants for their
-- company's workspaces. Regular members can read grants for the
-- workspaces they belong to (so the UI can show "you have access to
-- billing, you don't").
--
-- We compute "is this grant in a workspace the caller can read" by joining
-- against workspaces via the membership list. The helper is_company_admin()
-- already includes super_admin.
drop policy if exists module_grants_select on public.workspace_module_grants;
create policy module_grants_select on public.workspace_module_grants
  for select to authenticated
  using (
    public.is_company_admin(
      (select w.company_id
       from public.workspaces w
       where w.id = workspace_module_grants.workspace_id)
    )
    or exists (
      select 1
      from public.memberships m
      where m.workspace_id = workspace_module_grants.workspace_id
        and m.user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: company admin only.
drop policy if exists module_grants_admin_insert on public.workspace_module_grants;
create policy module_grants_admin_insert on public.workspace_module_grants
  for insert to authenticated
  with check (
    public.is_company_admin(
      (select w.company_id
       from public.workspaces w
       where w.id = workspace_module_grants.workspace_id)
    )
  );

drop policy if exists module_grants_admin_update on public.workspace_module_grants;
create policy module_grants_admin_update on public.workspace_module_grants
  for update to authenticated
  using (
    public.is_company_admin(
      (select w.company_id
       from public.workspaces w
       where w.id = workspace_module_grants.workspace_id)
    )
  )
  with check (
    public.is_company_admin(
      (select w.company_id
       from public.workspaces w
       where w.id = workspace_module_grants.workspace_id)
    )
  );

drop policy if exists module_grants_admin_delete on public.workspace_module_grants;
create policy module_grants_admin_delete on public.workspace_module_grants
  for delete to authenticated
  using (
    public.is_company_admin(
      (select w.company_id
       from public.workspaces w
       where w.id = workspace_module_grants.workspace_id)
    )
  );