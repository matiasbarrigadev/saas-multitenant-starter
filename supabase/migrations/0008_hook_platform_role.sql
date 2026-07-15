-- =============================================================================
-- Migration 0008: Extend custom_access_token_hook to stamp platform_role.
--
-- 0003_auth_hook.sql defines the original function. We re-create it
-- here with one additional step: read `platform_role` from
-- auth.users.raw_app_meta_data and stamp it into the JWT as
-- `app_metadata.platform_role`. RLS policies and `is_super_admin()`
-- depend on this claim.
--
-- Rollback note: this migration only modifies the function body, not
-- its signature or grants. To revert, restore 0003's exact body via
-- a follow-up migration that `create or replace function ... as $$
-- <0003 body> $$;`.
-- =============================================================================

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
  platform_role text;
begin
  -- Fetch all memberships for the user (existing logic from 0003).
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

  -- NEW (0008): read platform_role from the user's raw_app_meta_data.
  -- This field is set ONLY via service-role (auth.admin.updateUserById
  -- or Supabase Studio). Users cannot self-elevate because
  -- raw_app_meta_data is server-controlled.
  select raw_app_meta_data ->> 'platform_role' into platform_role
  from auth.users
  where id = user_id;

  -- Mutate the event: ensure claims and app_metadata exist as objects.
  claims := event -> 'claims';
  if claims is null then
    claims := '{}'::jsonb;
  end if;
  if (claims -> 'app_metadata') is null then
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  end if;

  -- Stamp the membership list.
  claims := jsonb_set(
    claims,
    '{app_metadata,company_memberships}',
    memberships
  );

  -- Stamp token_version (existing behavior from 0003).
  if (claims -> 'app_metadata' ->> 'token_version') is null then
    claims := jsonb_set(
      claims,
      '{app_metadata,token_version}',
      '1'::jsonb
    );
  end if;

  -- NEW (0008): stamp platform_role ONLY if it is set. Users without
  -- platform_role get no claim (not "false" or "null"), which lets
  -- is_super_admin() return FALSE for them.
  if platform_role is not null then
    claims := jsonb_set(
      claims,
      '{app_metadata,platform_role}',
      to_jsonb(platform_role)
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Grants are unchanged from 0003 (still only supabase_auth_admin
-- can execute). Re-stating for explicitness.
revoke all on function public.custom_access_token_hook(jsonb) from public;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

comment on function public.custom_access_token_hook(jsonb) is
  'Auth hook: stamps company_memberships AND platform_role into JWT app_metadata. EXECUTE restricted to supabase_auth_admin. Updated by 0008.';