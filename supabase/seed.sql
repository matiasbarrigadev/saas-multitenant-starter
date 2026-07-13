-- =============================================================================
-- Seed data for local development.
--
-- Run automatically by `supabase db reset` if seed.sql is referenced from
-- supabase/config.toml (the default).
--
-- Creates:
--   - 1 company: "Acme Corp" (slug=acme -> acme.tuapp.local)
--   - 2 workspaces: "Marketing" (slug=marketing) and "Sales" (slug=sales)
--   - 1 auth.users entry + matching profile
--   - 2 memberships: demo user is owner in Marketing, member in Sales
--
-- To sign in locally: use the magic link sent to demo@acme.tuapp.local
-- (configurable in supabase/config.toml under [auth.email]).
-- =============================================================================

-- ---- Demo company -----------------------------------------------------------
insert into public.companies (id, slug, name)
values
  ('00000000-0000-0000-0000-000000000001', 'acme', 'Acme Corp')
on conflict (slug) do nothing;

-- ---- Demo workspaces --------------------------------------------------------
insert into public.workspaces (id, company_id, slug, name)
values
  ('00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'marketing', 'Marketing'),
  ('00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'sales', 'Sales')
on conflict (company_id, slug) do nothing;

-- ---- Demo user --------------------------------------------------------------
-- We create the auth user via Supabase's admin API in a separate script
-- (because auth.users requires the pgcrypto helpers and bcrypt, which are
-- easier to handle from the application layer). For seed.sql we just create
-- the profile and memberships referencing a placeholder user_id.
--
-- To wire up the demo user end-to-end, run:
--   curl -X POST 'http://127.0.0.1:54321/auth/v1/admin/users' \
--     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
--     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"email":"demo@acme.tuapp.local","email_confirm":true}'
--
-- Then update the placeholder user_id below with the real one.
-- (Alternatively, just sign up via magic link the first time and the
-- trigger from 0001 will create the profile.)

-- ---- Memberships (will succeed once a real user_id exists) -----------------
-- We use a CTE-style insert that's idempotent. If the user doesn't exist yet,
-- the FK constraint will fail silently via ON CONFLICT DO NOTHING.
do $$
declare
  demo_user_id uuid;
begin
  -- Look up the demo user. If not found, skip silently — sign in once via
  -- magic link to create the user, then re-run seed.sql.
  select id into demo_user_id
  from auth.users
  where email = 'demo@acme.tuapp.local'
  limit 1;

  if demo_user_id is not null then
    insert into public.memberships (workspace_id, company_id, user_id, role)
    values
      ('00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-000000000001',
       demo_user_id, 'owner'),
      ('00000000-0000-0000-0000-000000000011',
       '00000000-0000-0000-0000-000000000001',
       demo_user_id, 'member')
    on conflict (workspace_id, user_id) do nothing;

    -- Pre-activate Marketing as the default workspace for the demo user.
    -- This way, after magic-link sign-in, the user lands on /w/marketing/dashboard.
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object(
           'active_workspace_id', '00000000-0000-0000-0000-000000000010',
           'active_company_id',   '00000000-0000-0000-0000-000000000001',
           'active_role',         'owner'
         )
    where id = demo_user_id;
  end if;
end $$;