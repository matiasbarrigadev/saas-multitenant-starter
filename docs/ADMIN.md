# ADMIN — Admin panel UI tour

This document walks through the admin panel: what each page does, how to
navigate it, and how to test the three RBAC tiers locally.

## URL structure

Two admin surfaces, with different RBAC requirements:

```
/admin              super_admin only — platform-wide
  ├── /                  list all companies
  ├── /audit             global audit log
  └── /companies/[id]   single company detail

/w/<slug>/admin     company admin (owner OR admin)
  ├── /members           list members + roles + workspaces
  ├── /workspaces        list workspaces + create + archive
  └── /settings          company name + settings (owner only)
```

The URLs are deliberately nested differently. `/admin/*` lives
outside the `(tenant)` group because super_admins don't have a
workspace context. `/w/<slug>/admin/*` is INSIDE the `(tenant)` group
so it inherits the auth + workspace validation from the tenant layout.

## Testing locally (3 personas)

You'll need 3 users in your local Supabase to test all flows.

### 1. Super admin (the SaaS vendor)

```sql
-- In Supabase Studio's SQL editor:
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"platform_role": "super_admin"}'::jsonb
where email = 'super@yourdomain.com';
```

Sign in at `https://<any-company-subdomain>.tuapp.local:3000/login` →
JWT now has `platform_role` → visit `/admin` → see all companies.

### 2. Company owner

The seeded user `demo@acme.tuapp.local` is already an `owner` of the
acme / marketing workspace (per `supabase/seed.sql`). Sign in and
visit `https://acme.tuapp.local:3000/w/marketing/admin/members` →
you'll see only Acme's members.

### 3. Regular member

In Supabase Studio → Authentication → Users → "Add user" → create a
new user with `email = member@acme.tuapp.local`. Then in SQL:

```sql
insert into public.memberships (workspace_id, company_id, user_id, role)
values (
  (select id from public.workspaces where slug = 'marketing' and company_id = (select id from public.companies where slug = 'acme')),
  (select id from public.companies where slug = 'acme'),
  (select id from auth.users where email = 'member@acme.tuapp.local'),
  'member'
);
```

Sign in as that user → visit any `/admin/*` URL → redirected.

## Page-by-page tour

### `/admin` — Platform admin landing

**Visible to**: super_admin only.

Shows a table of every company on the platform, with member count and
workspace count. Click "Manage" → company detail.

The query uses service_role because RLS doesn't allow regular users to
see companies they have no membership in. The justification comment is
at the top of the file.

### `/admin/companies/[id]` — Single company detail

**Visible to**: super_admin only.

Shows:
- Company metadata (slug, name, created, suspended flag).
- A list of the company's workspaces.
- A list of unique members (across all workspaces), with their highest
  role and a Promote / Demote button.

The "Visit as subdomain" button opens the company's first workspace
dashboard in a new tab (so you can test cross-tenant UX as a real
tenant admin).

The "Suspend company" button toggles `companies.settings.suspended`.
Suspended companies can still sign in but their users see a "company
suspended" notice (TODO — for now, suspension is recorded in audit
log but not enforced).

### `/admin/audit` — Audit log

**Visible to**: super_admin only.

Shows the most recent 100 events. Each row has:
- When (relative time)
- Actor user ID
- Event type (badge)
- Company ID
- Payload (truncated JSON)

Filtering: append `?company_id=<uuid>` or `?event_type=<type>` to
the URL. The full API at `/admin/api/audit` supports both.

### `/w/<slug>/admin/members` — Company members

**Visible to**: owner or admin (NOT regular members).

Shows every user with at least one membership in the company,
across all workspaces, with their highest role. Currently
read-only — mutations go through the API endpoints listed below.

To invite: (TODO — invitation UI is the next slice; for now use SQL or
the API endpoints directly).

### `/w/<slug>/admin/workspaces` — Company workspaces

**Visible to**: owner or admin.

Lists all workspaces (including archived). Create / archive via the
API endpoints.

### `/w/<slug>/admin/settings` — Company settings

**Visible to**: owner only.

Currently read-only display. Edit via `PATCH /api/admin/company`.

## API endpoints

### Super admin (`/admin/api/*`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/api/companies/[id]/suspend` | Toggle `companies.settings.suspended` |
| POST | `/admin/api/users/[id]/promote` | Toggle `auth.users.raw_app_meta_data.platform_role` |
| GET  | `/admin/api/audit` | List audit events (filterable) |

### Company admin (`/api/admin/*`)

| Method | Path | Purpose |
|---|---|---|
| PATCH  | `/api/admin/company` | Update company name |
| POST   | `/api/admin/workspaces` | Create workspace |
| POST   | `/api/admin/workspaces/[id]/archive` | Toggle archive |
| POST   | `/api/admin/members/invite` | Invite user to workspace |
| PATCH  | `/api/admin/members/[id]/role` | Change role |
| DELETE | `/api/admin/members/[id]` | Remove membership |

All of these emit an audit event on success and return the uniform
`ApiResponse<T>` shape from `lib/api/response.ts`.

## Common workflows

### "Help, I can't see /admin"

1. Confirm you're signed in (your JWT is valid).
2. Confirm `platform_role` is set on your auth.users row:
   ```sql
   select email, raw_app_meta_data
   from auth.users where email = '<your-email>';
   ```
   You should see `"platform_role": "super_admin"`.
3. If missing, run the promotion SQL above.
4. Sign out and sign back in (the hook only runs on token issuance).
5. Hard-reload the page (clear service worker / cookies).

### "I want to see who did what"

Hit `/admin/api/audit?company_id=<uuid>` to see all events for one
company, or `/admin/api/audit?event_type=member.invited` to see all
invites across the platform. The response includes the payload
(JSON), actor user ID, IP address, and user agent.

### "I accidentally demoted myself"

That should be impossible — the `requireCompanyOwner` and the
`CANNOT_DEMOTE_SELF` check on the promote endpoint both refuse it.
If it somehow happened (e.g. direct SQL), set the platform_role back
via Supabase Studio → SQL editor:
```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"platform_role": "super_admin"}'::jsonb
where email = '<your-email>';
```

Then sign out and back in.

## What the panel deliberately does NOT do (out of scope)

- **No user-initiated signup flow.** Users sign up via the magic-link
  login only. There's no "create your company" wizard — companies
  are seeded or created via the SQL editor for now.
- **No Stripe billing.** Documented as future work in
  [docs/RBAC.md](RBAC.md).
- **No audit log export** (no S3 / Datadog sink). For now everything
  lives in `public.audit_events` in the database.
- **No company suspension enforcement** (the flag exists, but the
  proxy doesn't reject sessions of suspended companies yet).
- **No SSO / SAML.** Magic link only.
- **No granular permissions** beyond owner/admin/member at the
  workspace level. Module-level grants exist as a scaffold
  (`workspace_module_grants`) but have no UI and no policies that
  consume them.

These are deliberate omissions to keep the first iteration focused.
Each is a separate, well-scoped feature for future PRs.