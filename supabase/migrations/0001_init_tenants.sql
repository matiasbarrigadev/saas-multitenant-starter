-- =============================================================================
-- Migration 0001: Initial tenant tables (companies, workspaces, profiles,
-- memberships) + extensions.
--
-- Hierarchy: auth.users -> memberships -> workspaces -> companies
--
-- Two-level tenancy:
--   - Company: large organization, identified by subdomain (e.g. acme.tuapp.com)
--   - Workspace: internal team, identified by path segment (e.g. /w/marketing)
--
-- RLS is ENABLED on every table in this migration but the actual policies
-- live in 0002. This split keeps schema changes reviewable separately from
-- permission changes.
-- =============================================================================

-- ---- Extensions --------------------------------------------------------------
-- pgcrypto for gen_random_uuid() (Supabase already enables this, but be explicit)
create extension if not exists "pgcrypto";

-- ---- Enums ------------------------------------------------------------------
do $$ begin
  create type public.role as enum ('owner', 'admin', 'member');
exception
  when duplicate_object then null;
end $$;

-- ---- Companies --------------------------------------------------------------
-- One row per large organization. The `slug` is what appears in the subdomain.
-- Example: slug='acme' -> acme.tuapp.com.
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.companies is
  'Top-level tenant. One row per organization. slug is used in subdomain.';

create index if not exists idx_companies_slug on public.companies(slug);

-- ---- Workspaces -------------------------------------------------------------
-- Internal sub-tenants. Workspace is the unit of data isolation (RLS is keyed
-- on workspace_id). Slug is unique within a company.
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  slug text not null
    check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, slug)
);
comment on table public.workspaces is
  'Sub-tenant inside a company. RLS boundary. Slug appears in /w/<slug> path.';

create index if not exists idx_workspaces_company on public.workspaces(company_id);

-- ---- Profiles ---------------------------------------------------------------
-- One row per auth.users.id. Holds neutral, non-tenant-scoped user data.
-- NOTE: profiles are NOT tenant-scoped on purpose — they survive across
-- companies/workspaces so a user can belong to many.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
comment on table public.profiles is
  'User profile, 1:1 with auth.users. Not tenant-scoped.';

-- ---- Memberships ------------------------------------------------------------
-- Joins users to workspaces, with a role. company_id is denormalized so we
-- can filter by company without joining workspaces (faster policies).
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.role not null default 'member',
  invited_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
comment on table public.memberships is
  'User <-> Workspace membership with role. company_id denormalized for fast RLS.';

create index if not exists idx_memberships_user on public.memberships(user_id);
create index if not exists idx_memberships_workspace on public.memberships(workspace_id);
create index if not exists idx_memberships_company on public.memberships(company_id);

-- ---- updated_at triggers ----------------------------------------------------
-- Auto-touch updated_at on companies/workspaces. Memberships/profile don't need it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

drop trigger if exists trg_workspaces_updated_at on public.workspaces;
create trigger trg_workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- ---- RLS: enabled but policies come in 0002 ---------------------------------
-- RLS must be enabled the moment a table is created in an exposed schema,
-- or you risk data leaks via the publishable key (Supabase docs requirement).
alter table public.companies    enable row level security;
alter table public.workspaces   enable row level security;
alter table public.profiles     enable row level security;
alter table public.memberships  enable row level security;

-- ---- New-profile bootstrap --------------------------------------------------
-- When a user signs in for the first time (row appears in auth.users),
-- auto-create a profile. This avoids "profile not found" errors in RSC.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- The trigger lives on auth.users. Supabase has a similar built-in but we
-- keep our own for explicitness and so it lives in our migration history.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();