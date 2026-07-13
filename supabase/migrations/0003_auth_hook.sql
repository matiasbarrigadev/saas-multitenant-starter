-- =============================================================================
-- Migration 0003: custom_access_token_hook.
--
-- This Postgres function is invoked by Supabase Auth EVERY TIME it issues a
-- JWT for a user (sign-in, refresh, magic link callback, etc.). It receives
-- the auth event as JSON and returns a mutated event JSON.
--
-- What we inject into app_metadata:
--   - company_memberships: array of { company_id, company_slug, workspace_id,
--     workspace_slug, role } for ALL workspaces the user belongs to.
--
-- What we deliberately do NOT inject:
--   - active_workspace_id, active_company_id. Why: the "active" tenant
--     depends on which workspace the user is currently working in, and that
--     changes more frequently than JWT issuance. Instead, the client calls
--     POST /api/me/switch-workspace which updates app_metadata and triggers
--     a refresh.
--
-- SECURITY:
--   - The function is SECURITY DEFINER so it can query `public.memberships`
--     even though the calling role is `supabase_auth_admin` which has no
--     direct access to public tables.
--   - We grant EXECUTE only to `supabase_auth_admin` and REVOKE from everyone
--     else. This is the canonical Supabase pattern; getting it wrong means
--     anyone with SQL access can spoof tokens.
-- =============================================================================

-- ---- The hook function ------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  user_id uuid := (event ->> 'user_id')::uuid;
  memberships jsonb;
begin
  -- Fetch all memberships for the user, joined with company + workspace
  -- for slug/role context. Runs once per token issuance.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'company_id',     c.id,
      'company_slug',   c.slug,
      'workspace_id',   w.id,
      'workspace_slug', w.slug,
      'role',           m.role
    )
  ), '[]'::jsonb)
  into memberships
  from public.memberships m
  join public.workspaces w on w.id = m.workspace_id
  join public.companies c on c.id = m.company_id
  where m.user_id = user_id;

  -- Mutate the event: ensure app_metadata is an object, then attach our data.
  -- We never overwrite user-supplied app_metadata fields; we only set ours.
  claims := event -> 'claims';
  if claims is null then
    claims := '{}'::jsonb;
  end if;

  -- Make sure app_metadata exists as a jsonb object.
  if (claims -> 'app_metadata') is null then
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  end if;

  -- Stamp membership list into app_metadata.
  claims := jsonb_set(
    claims,
    '{app_metadata,company_memberships}',
    memberships
  );

  -- Stamp a "token version" so we can invalidate all sessions by bumping it.
  -- Useful for forced logout after a security incident. Default 1.
  if (claims -> 'app_metadata' ->> 'token_version') is null then
    claims := jsonb_set(
      claims,
      '{app_metadata,token_version}',
      '1'::jsonb
    );
  end if;

  -- Return the mutated event. Supabase Auth takes `event.claims` and
  -- uses it as the JWT payload.
  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- ---- Grants: only supabase_auth_admin may execute ---------------------------
-- Without this, the hook would never fire. Without the revokes, anyone with
-- SQL access could call it and forge claims.
revoke all on function public.custom_access_token_hook(jsonb) from public;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ---- Enable the hook in Supabase Auth --------------------------------------
-- This updates auth.hook config so Supabase actually calls our function.
-- We do an UPDATE-only approach because the exact INSERT signature of
-- auth.hooks varies across Supabase versions; the hook row is created
-- by Supabase's migration system itself, and we just enable + point it
-- at our function.
--
-- If this fails with "permission denied" locally, run `supabase db reset`
-- (which runs migrations as superuser).
do $$
begin
  if exists (select 1 from auth.hooks where hook_name = 'custom_access_token_hook') then
    update auth.hooks
    set enabled = true,
        function_name = 'public.custom_access_token_hook'
    where hook_name = 'custom_access_token_hook';
  end if;
end $$;

-- Note: if the hook is not yet registered at all (rare in a fresh
-- project), enable it manually via Supabase Studio → Authentication →
-- Hooks → Custom Access Token Hook → enable and select
-- `public.custom_access_token_hook` from the function dropdown.

comment on function public.custom_access_token_hook(jsonb) is
  'Auth hook: stamps company_memberships into JWT app_metadata. EXECUTE restricted to supabase_auth_admin.';