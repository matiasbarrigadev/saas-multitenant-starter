<!--
add-super-admin-action.md — vendor-neutral skill for adding routes that
require platform super_admin privileges.

Pattern mirror: skills/add-admin-action.md (the company-level pattern).
The difference: this one checks ctx.platformRole === 'super_admin'
instead of ctx.role, and bypasses company checks entirely.
-->

# Skill: Add a super_admin-only action

## Pre-flight

1. Read `AGENTS.md` (rules apply here, especially § 1.2 on
   `service_role` and § 5 on the pre-commit checklist).
2. Read `lib/admin/guards.ts` end-to-end — `requireSuperAdmin()` is the
   one guard you want.
3. Read `lib/admin/audit.ts` end-to-end — every super_admin mutation
   emits an audit event.
4. Read `skills/add-admin-action.md` end-to-end — that's the company-level
   pattern. This skill is its platform-level sibling.

## What "super_admin action" means here

Super_admin actions:

- **Cross-tenant by design**: the caller can act on any company, any
  workspace, any user. The route's `target*Id` comes from the URL/body,
  never from `ctx.company.id`.
- **Write to `auth.users.raw_app_meta_data`** is sometimes required
  (e.g. promoting a user to super_admin). This MUST go through
  `service.auth.admin.updateUserById` — the regular client cannot.
- **Always emit audit events.** Super_admin actions have the highest
  blast radius in the system; every one is recorded.

## Where to put the route

Routes live under `app/admin/api/` (the platform admin group, NOT the
`(tenant)` group). The URL is `/admin/api/<resource>/<action>`. The
layout at `app/admin/layout.tsx` enforces super_admin at the page
level; the API route re-enforces it for safety.

## Output

The agent produces:

1. **A new file** at `app/admin/api/<resource>/<action>/route.ts`
   (or `app/admin/api/<resource>/route.ts` for an index endpoint).
2. **Audit integration**: the file ends with `recordAuditEvent()`.
3. **`Justification for service_role`** JSDoc block at the top of the file.

## Step 1 — Define the route

```ts
/**
 * POST /admin/api/<resource>/<action> — <one-line description>.
 *
 * Justification for service_role:
 *
 *   - <Why RLS would block this operation. Be specific — name the table,
 *     the predicate that fails, and what you need to bypass.>
 *   - <What guards run BEFORE the bypass — role check, ownership check,
 *     cross-tenant defense for the target.>
 *   - <What data is touched and on whose behalf.>
 *
 * If you can't write a justification like this, use the regular server
 * client instead.
 */

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { extractRequestMeta, recordAuditEvent } from "@/lib/admin/audit";

const Body = z.object({ /* ... */ });

export const POST = withApi(async (request) => {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return err(ApiErrorCode.VALIDATION_FAILED, "<validation message>.");
  }

  const service = createServiceClient();

  // ... do the work ...

  // Audit MUST happen after a successful mutation. Use a verb in the past
  // tense for event_type, structured payload for the details.
  const meta = extractRequestMeta(request);
  await recordAuditEvent({
    actor: guard.ctx.user,
    companyId: null,             // null for platform-level events
    eventType: "company.suspended",
    payload: { target_company_id: id, previous: prev, next: suspended },
    ...meta,
  });

  return ok({ /* response body */ });
});
```

## Step 2 — Specific patterns

### Promoting / demoting a user

This is the one place where you MUST touch `auth.users.raw_app_meta_data`:

```ts
const { data: target } = await service.auth.admin.getUserById(targetUserId);
if (!target?.user) {
  return err(ApiErrorCode.NOT_FOUND, "User not found.");
}
const prev = (target.user.app_metadata ?? {}) as Record<string, unknown>;
const next = granting
  ? { ...prev, platform_role: "super_admin" }
  : Object.fromEntries(
      Object.entries(prev).filter(([k]) => k !== "platform_role"),
    );
const { error } = await service.auth.admin.updateUserById(targetUserId, {
  app_metadata: next,
});
```

**Critical**: server-side block self-demotion:

```ts
if (revoking && targetUserId === guard.ctx.user.id) {
  return err(
    ApiErrorCode.CANNOT_DEMOTE_SELF,
    "You cannot revoke your own super_admin role.",
  );
}
```

The token refresh is automatic: the user's next request to a route
that uses `getActiveContext()` will get the new `platform_role`. But
their CURRENT JWT still has the old one. For admin work, that's fine —
admin actions verify the claim at the guard level. If the user is in
the middle of something that requires the new claim, they need to
re-authenticate.

### Listing across companies

```ts
const service = createServiceClient();
const { data } = await service
  .from("companies")
  .select("id, slug, name, created_at, settings")
  .order("created_at", { ascending: false });
```

RLS would return only companies the user is a member of — which for a
super_admin with no memberships is the empty set. Service role is
required for cross-tenant reads.

### Suspending a company

Use `companies.settings.suspended` (a JSONB field). Don't delete the
row — the user's data must remain accessible for reactivation:

```ts
const prev = (company.settings ?? {}) as Record<string, unknown>;
const next = { ...prev, suspended: !prev.suspended };
await service.from("companies").update({ settings: next }).eq("id", id);
```

Event type: `company.suspended` or `company.unsuspended`. Include the
previous and next values in the payload so the audit log captures the
diff.

## Anti-patterns

- ❌ **Reading `ctx.company.id` to scope the query.** Super_admins don't
  have a meaningful company context; use the `target*Id` from the URL/body.
- ❌ **Forgetting to audit.** Every super_admin mutation is high-blast-radius
  and must be logged. `recordAuditEvent()` is the only sanctioned way.
- ❌ **Letting a super_admin demote themselves.** Always check `targetUserId
  === guard.ctx.user.id` before revoking `platform_role`.
- ❌ **Skipping the cross-tenant defense when reading a target.** Service
  role has no scope; without explicit verification, you can read/write
  any company.

## VERIFY

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm build` clean.
- [ ] Sign in as a super_admin → endpoint returns the expected result.
- [ ] Sign in as a regular user → endpoint returns 403 SUPER_ADMIN_REQUIRED.
- [ ] Sign in as a company owner (not super_admin) → endpoint returns 403.
- [ ] After mutation, `/admin/api/audit` shows the new event with correct
      `actor_user_id`, `event_type`, and `payload`.
- [ ] Listed in `llms.txt` under "Agent-facing recipes" if it introduces
      a new pattern.

## Rollback

To remove a super_admin action:

1. Delete the route file.
2. If you added a new audit `event_type`, document the change in
   `docs/ADMIN.md` so old audit rows can still be interpreted.
3. Bump the version in `CHANGELOG.md` with a `breaking: true` entry
   if you removed an action users may have scripts depending on.
4. Update `llms.txt` and `registry.json` if you added a new block.