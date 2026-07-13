<!--
add-admin-action.md — Vendor-neutral skill for adding an admin operation
that bypasses RLS via the service role client.
-->

# Skill: Add an admin action (service role)

## Pre-flight

1. Read `AGENTS.md` § 1.2 (Auth rules — esp. about service_role).
2. Read `app/(tenant)/api/me/switch-workspace/route.ts` as the canonical
   worked example. Note the format of the "Justification" comment.
3. Read `lib/supabase/service.ts`.

## Why this skill exists

`service_role` bypasses RLS. That is dangerous. This skill is here so
that **every admin operation has a justification comment + a role check
before the bypass**. If you can't write a one-paragraph justification
for why the bypass is necessary, you don't need this skill — use a
regular Route Handler with the RLS-respecting client.

## When NOT to use this skill

- The operation can be done with a regular Server Action or Route
  Handler + `createClient()`. RLS handles isolation for you; no bypass
  needed.
- You're modifying data on behalf of a single authenticated user. Even
  cross-workspace operations for that user go through normal RLS — the
  user has rights to what they see, no more.

## Output

The agent produces:

1. A new file at `app/(tenant)/api/<resource>/<action>/route.ts`.
2. The file MUST start with a "Justification for service_role" block
   explaining (a) why the bypass is needed and (b) what guards run
   before the bypass.
3. Documentation in `docs/RISKS.md` (create if missing) listing each
   service_role use, so future maintainers can review.

## Pattern (full recipe)

```ts
/**
 * POST /api/<resource>/<action>
 *
 * Justification for service_role:
 *
 *   - <Describe in 1-3 sentences why RLS would block this operation.>
 *   - <Describe the guard(s) we run BEFORE the bypass — role check,
 *     ownership check, etc.>
 *   - <Describe what data is touched and on whose behalf.>
 *
 * If you can't write a justification like this, use the RLS-respecting
 * client instead.
 */

import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { getActiveContext } from "@/lib/tenant/context";
import { createServiceClient } from "@/lib/supabase/service";

const RequestBody = z.object({
  // ... your validated shape
});

export const POST = withApi(async (request) => {
  // 1. Caller must have an active session + active workspace.
  const ctx = await getActiveContext();

  // 2. Guard: role check (or another authorization rule).
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return err(
      ApiErrorCode.ROLE_INSUFFICIENT,
      "You don't have permission for this action.",
    );
  }

  // 3. Validate the body.
  let body: z.infer<typeof RequestBody>;
  try {
    body = RequestBody.parse(await request.json());
  } catch {
    return err(ApiErrorCode.VALIDATION_FAILED, "Invalid payload.");
  }

  // 4. Cross-tenant defense: confirm the target belongs to the caller's
  //    active company. Defense-in-depth against any path that might
  //    accept a target_id from the caller.
  // (Adjust this step to your operation's logic.)

  // 5. RLS-bypass via service_role. Justified above.
  const service = createServiceClient();

  // ... perform the admin operation ...

  return ok({ done: true });
});
```

## Example: invite a user to a workspace

```ts
const RequestBody = z.object({
  workspaceId: z.string().uuid(),
  inviteeEmail: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

/**
 * POST /api/workspaces/admin-invite
 *
 * Justification for service_role:
 *
 *   - We insert a membership row for a user that may not exist yet, or
 *     that exists but whose user_id is not the caller. RLS would block
 *     this on `memberships` because RLS only allows inserting rows where
 *     `user_id = auth.uid()`.
 *   - Guard before bypass: caller must be 'owner' or 'admin' in the
 *     workspace's company (ctx.role check below).
 *   - Cross-tenant defense: we confirm the requested workspaceId belongs
 *     to ctx.company.id before any insert.
 */
export const POST = withApi(async (request) => {
  const ctx = await getActiveContext();
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return err(
      ApiErrorCode.ROLE_INSUFFICIENT,
      "Only owners and admins can invite.",
    );
  }

  let body: z.infer<typeof RequestBody>;
  try {
    body = RequestBody.parse(await request.json());
  } catch {
    return err(ApiErrorCode.VALIDATION_FAILED, "Invalid invite payload.");
  }

  const service = createServiceClient();

  // Cross-tenant defense.
  const { data: targetWorkspace, error: lookupErr } = await service
    .from("workspaces")
    .select("id, company_id")
    .eq("id", body.workspaceId)
    .maybeSingle();
  if (lookupErr || !targetWorkspace) {
    return err(ApiErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found.");
  }
  if (targetWorkspace.company_id !== ctx.company.id) {
    return err(
      ApiErrorCode.WORKSPACE_FORBIDDEN,
      "Cannot invite to a workspace in another company.",
    );
  }

  // Look up invitee by email.
  const { data: userList } = await service.auth.admin.listUsers({
    email: body.inviteeEmail,
  });
  const invitee = userList?.users?.[0];
  if (!invitee) {
    return err(
      ApiErrorCode.NOT_FOUND,
      "Invitee has no account yet. Ask them to sign in once first.",
    );
  }

  // Insert the membership.
  const { error: insertErr } = await service.from("memberships").insert({
    workspace_id: body.workspaceId,
    company_id: ctx.company.id,
    user_id: invitee.id,
    role: body.role,
    invited_at: new Date().toISOString(),
    joined_at: new Date().toISOString(),
  });
  if (insertErr) {
    console.error("[admin-invite] insert failed:", insertErr);
    return err(ApiErrorCode.DB_ERROR, "Could not create membership.");
  }

  // TODO (out of scope for this template): send the invitee a transactional
  // email with a sign-in link.
  return ok({ invited: true });
});
```

## VERIFY

- [ ] Caller without role → 403 ROLE_INSUFFICIENT.
- [ ] Caller with role → 200 with the expected result.
- [ ] If the action involves a target workspace/company: passing a
      workspaceId from a different company → 403 WORKSPACE_FORBIDDEN.
- [ ] The "Justification for service_role" header is present and accurate.
- [ ] The action is listed in `docs/RISKS.md` (create that file if it
      doesn't exist) under "service_role uses".

## Rollback

- Delete the new route file.
- Remove the entry from `docs/RISKS.md`.
- Drop any database changes (down migration).

## Audit checklist (for reviewers)

When reviewing a PR that uses this skill, check:

- [ ] Is the "Justification" header present and convincing?
- [ ] Is the role check strict enough for the action's blast radius?
- [ ] For cross-tenant actions, is the cross-tenant defense in place?
- [ ] Is the action logged? (`console.info` with the admin's user_id
      and the target's id — minimum.)
- [ ] Is the action listed in `docs/RISKS.md`?

If any answer is "no", request changes before merging.
