-- =============================================================================
-- Migration 0006: Admin panel helpers + audit_events + module grant scaffold.
--
-- Adds:
--   - public.current_platform_role()        -- read platform_role from JWT
--   - public.is_super_admin()               -- true if current user is super_admin
--   - public.is_company_owner(uuid)          -- super_admin OR role=owner in company
--   - public.is_company_admin(uuid)          -- super_admin OR role in (owner, admin) in company
--   - public.audit_events                   -- append-only audit log
--   - public.workspace_module_grants        -- scaffold for future module-level scopes
--
-- Notes:
--   - super_admin is NOT a value of public.role. It lives in
--     app_metadata.platform_role and is checked via is_super_admin().
--   - public.role remains exactly: 'owner' | 'admin' | 'member' (workspace-level).
--   - All tables created here get RLS enabled immediately. Policies live
--     in 0007_rls_admin.sql so schema and permissions review separately.
-- =============================================================================

-- ---- 1. Helper: current_platform_role() -------------------------------------
-- Reads the platform_role claim stamped into app_metadata by the
-- custom_access_token_hook (see 0003 + 0008_hook_platform_role.sql).
create or replace function public.current_platform_role()
returns text
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claim.app_metadata.platform_role', true),
    ''
  );
$$;
comment on function public.current_platform_role() is
  'Returns the platform_role claim from the current JWT, or NULL if unset.';

-- ---- 2. Helper: is_super_admin() --------------------------------------------
-- The canonical predicate every super-admin-only policy and route uses.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select public.current_platform_role() = 'super_admin';
$$;
comment on function public.is_super_admin() is
  'True if the current JWT carries platform_role = ''super_admin''.';

-- ---- 3. Helper: is_company_owner(uuid) ---------------------------------------
-- True if the user owns a company, either via super_admin or via an
-- 'owner' role on any membership in the company.
--
-- Why "any membership" instead of "the active workspace's membership":
-- because an admin panel may target a workspace the user isn't currently
-- sitting in. The check is "do they have owner authority anywhere in
-- this company", which is the right semantic for cross-workspace ops.
create or replace function public.is_company_owner(target_company_id uuid)
returns boolean
language sql
stable
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.company_id = target_company_id
        and m.role = 'owner'
    );
$$;
comment on function public.is_company_owner(uuid) is
  'True if the caller is super_admin OR has any ''owner'' membership in the company.';

-- ---- 4. Helper: is_company_admin(uuid) ---------------------------------------
-- Looser version of is_company_owner: also accepts 'admin' role.
create or replace function public.is_company_admin(target_company_id uuid)
returns boolean
language sql
stable
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.company_id = target_company_id
        and m.role in ('owner', 'admin')
    );
$$;
comment on function public.is_company_admin(uuid) is
  'True if the caller is super_admin OR has any ''owner''/''admin'' membership in the company.';

-- ---- 5. audit_events table --------------------------------------------------
-- Append-only audit log. Lives at platform scope (a row's company_id
-- is optional so platform-level events like "company.created" can be
-- recorded without a tenant).
--
-- Writes are intentionally not RLS-allowed for `authenticated`. Only
-- service_role (used by admin routes and future background jobs) inserts
-- here. This prevents members from forging audit entries.
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  -- Who did it. NULL for system-triggered events (e.g. company.created
  -- when the first workspace is provisioned by a background job).
  actor_user_id uuid references auth.users(id) on delete set null,
  -- Tenant scope. NULL for platform-level events (cross-tenant ops).
  company_id uuid references public.companies(id) on delete cascade,
  -- Workspace scope. NULL when the action is at company level or higher.
  workspace_id uuid references public.workspaces(id) on delete set null,
  -- What happened. Use lower_snake_case.dot.notation. Examples:
  --   company.created, company.suspended, member.invited,
  --   member.role_changed, workspace.created, workspace.archived,
  --   user.promoted_to_super_admin.
  event_type text not null,
  -- Structured details. Keep small (no full payloads of edited entities,
  -- just IDs and diff summaries). Operators can join on id if they need
  -- the full context.
  payload jsonb not null default '{}'::jsonb,
  -- Optional request metadata. Callers that have request info should set
  -- these; others leave NULL.
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
comment on table public.audit_events is
  'Append-only audit log. Reads: super_admin sees all; company owners see their own. Writes: service_role only.';

-- Indexes for the typical queries (filter by company + recency, by actor,
-- by event_type for incident investigation).
create index if not exists idx_audit_events_company
  on public.audit_events(company_id, created_at desc)
  where company_id is not null;
create index if not exists idx_audit_events_actor
  on public.audit_events(actor_user_id, created_at desc)
  where actor_user_id is not null;
create index if not exists idx_audit_events_type
  on public.audit_events(event_type, created_at desc);

-- ⚠️ Enable RLS the moment the table is created. Policies live in 0007.
alter table public.audit_events enable row level security;

-- ---- 6. workspace_module_grants table (FUTURE SCAFFOLD) -------------------
-- Lets a company owner say "this workspace gets the 'billing' module,
-- this one doesn't". Empty for now. Populated when modules are added.
--
-- The shape is intentionally minimal: workspace_id + module_key string
-- + who granted it. Future migrations can add expires_at, conditions,
-- etc.
create table if not exists public.workspace_module_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  module_key text not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (workspace_id, module_key)
);
comment on table public.workspace_module_grants is
  'Module-level grants per workspace. Empty until modules are added. RLS in 0007.';

create index if not exists idx_module_grants_workspace
  on public.workspace_module_grants(workspace_id);

alter table public.workspace_module_grants enable row level security;