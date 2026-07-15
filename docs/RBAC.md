# RBAC — Role-Based Access Control

This template uses a **3-tier RBAC model**. Each tier has a different
scope and a different "blast radius" — make sure you understand which
tier is doing what before adding new admin endpoints.

## The 3 tiers

| Tier | Who | Lives in | Blast radius | Where it's checked |
|---|---|---|---|---|
| **super_admin** | The SaaS vendor's platform operators | `app_metadata.platform_role` (server-controlled only) | All companies in the database | `public.is_super_admin()` (SQL) and `requireSuperAdmin()` (TS) |
| **owner** / **admin** | Company admins (owner = strongest) | `public.memberships.role` (per-company) | Their own company only | `public.is_company_admin(uuid)` and `requireCompanyAdmin(companyId)` |
| **member** | Regular users | `public.memberships.role = 'member'` | Their workspaces, no admin power | N/A — no admin endpoints accept member |

`super_admin` is **NOT** a value of the `public.role` enum. The enum stays
exactly `'owner' | 'admin' | 'member'` (per-workspace / per-company). The
platform role is a separate concept, stored in JWT claims.

## Claim sources

### `app_metadata.platform_role`

- Set on `auth.users.raw_app_meta_data` (NOT user-writable — only
  service-role can change it).
- Stamped into the JWT by the `custom_access_token_hook` (see
  `supabase/migrations/0008_hook_platform_role.sql`).
- Cleared by removing the key from `raw_app_meta_data`.

### `app_metadata.company_memberships`

- Auto-populated by the hook for every workspace the user belongs to.
- Cannot be modified directly; only by creating/deleting membership
  rows in `public.memberships`.

### `app_metadata.active_*`

- Set by `POST /api/me/switch-workspace` (see
  `app/(tenant)/api/me/switch-workspace/route.ts`).
- These are workspace-scoped — they tell RLS policies which row the
  user is "currently sitting in".
- Not relevant to admin scope.

## Promotion flow

To promote a user to super_admin:

1. Connect to your Supabase project's SQL editor.
2. Run:
   ```sql
   update auth.users
   set raw_app_meta_data =
     coalesce(raw_app_meta_data, '{}'::jsonb)
     || '{"platform_role": "super_admin"}'::jsonb
   where email = '<their-email>';
   ```
3. The user must sign out and sign back in. The hook runs on every
   token issuance, so the JWT they get next will include
   `app_metadata.platform_role = 'super_admin'`.
4. They can now visit `/admin`.

The same SQL with `'platform_role': null` (or just deleting the key)
demotes. The endpoint at `POST /admin/api/users/[id]/promote` does the
same from the UI.

### Why not do this via a normal SQL query in our codebase?

We could add a helper migration that runs the UPDATE on signup, but that
defeats the purpose of having super_admin be a manual, server-controlled
promotion. The current pattern keeps the "human pulls the lever" step
explicit. If you need self-service onboarding of super_admins, you're
doing something dangerous.

## Permission matrix

| Endpoint | super_admin | owner | admin | member |
|---|---|---|---|---|
| `GET /admin` | ✅ | → redirect | → redirect | → redirect |
| `GET /admin/companies/[id]` | ✅ | → redirect | → redirect | → redirect |
| `POST /admin/api/companies/[id]/suspend` | ✅ | → 403 | → 403 | → 403 |
| `POST /admin/api/users/[id]/promote` | ✅ (no self-demote) | → 403 | → 403 | → 403 |
| `GET /admin/api/audit` | ✅ (all) | → 403 | → 403 | → 403 |
| `GET /w/<slug>/admin/members` | ✅ | ✅ | ✅ | → redirect |
| `GET /w/<slug>/admin/workspaces` | ✅ | ✅ | ✅ | → redirect |
| `GET /w/<slug>/admin/settings` | ✅ | ✅ | → redirect | → redirect |
| `POST /api/admin/company` (PATCH name) | ✅ | ✅ | → 403 | → 403 |
| `POST /api/admin/workspaces` (create) | ✅ | ✅ | ✅ | → 403 |
| `POST /api/admin/workspaces/[id]/archive` | ✅ | ✅ | ✅ | → 403 |
| `POST /api/admin/members/invite` | ✅ | ✅ | ✅ | → 403 |
| `PATCH /api/admin/members/[id]/role` | ✅ | ✅ | ✅ | → 403 |
| `DELETE /api/admin/members/[id]` | ✅ | ✅ | ✅ | → 403 |

## Why `super_admin` is not in `public.role`

Because it's a different kind of authority:

- `public.role` answers "what can you do in this workspace/company?"
- `super_admin` answers "do you have platform-level access at all?"

Mixing them in one enum would create three problems:

1. A super_admin who has no memberships in any company would have
   `role = null`, breaking the type system.
2. The `role = 'admin'` policy checks (e.g. `notes_delete_admin_only`)
   would have to special-case super_admin everywhere, which is hard
   to audit.
3. Promoting to super_admin would require creating a fake membership
   row, which leaks data and creates confusing membership records.

By making it a separate JWT claim, super_admin works WITHOUT any
memberships. They can list companies and audit events across the entire
platform, but cannot impersonate a regular workspace user unless they
have an actual membership.

## Cross-tenant defense

Every admin endpoint guards against cross-tenant attacks by:

1. Calling `requireSuperAdmin()` or `requireCompanyAdmin(companyId)`.
2. The guard checks the JWT claim BEFORE any DB read/write.
3. When fetching/updating a target by id, the endpoint re-verifies
   the target's `company_id` matches the caller's company (or is
   cross-tenant for super_admin).

This is why you see patterns like:

```ts
const { data: ws } = await service.from("workspaces")
  .select("id, company_id")
  .eq("id", body.workspaceId).maybeSingle();
if (ws.company_id !== ctx.company.id) {
  return err(ApiErrorCode.COMPANY_MISMATCH, "...");
}
```

The guard handles "who you are", the endpoint handles "what you're
touching belongs to you". Belt and suspenders.

## Audit log policy

Every admin mutation MUST emit an audit event via
`recordAuditEvent()`. The event_type uses `lower_snake_case.dot.notation`:

- `company.suspended`, `company.unsuspended`
- `company.settings_updated`
- `workspace.created`, `workspace.archived`, `workspace.unarchived`
- `member.invited`, `member.role_changed`, `member.removed`
- `user.promoted_to_super_admin`, `user.demoted_from_super_admin`

The audit_events table has no INSERT policy for `authenticated` by
design. Only the service-role client (used by `recordAuditEvent`) can
write. This prevents members from forging audit entries.

## Future work (out of scope)

- **Module-level scopes**: the `workspace_module_grants` table exists
  but no UI consumes it. Add a `current_user_has_module(key)` helper
  once you have actual modules to gate.
- **Time-bounded memberships**: add `expires_at` to memberships.
- **Audit log export**: stream events to an external sink (e.g. S3
  via Supabase Edge Function) for long-term retention.
- **Cross-company invites**: not currently supported — a user can
  belong to multiple companies but must be invited separately to each.

See [docs/ADMIN.md](ADMIN.md) for the UI tour.