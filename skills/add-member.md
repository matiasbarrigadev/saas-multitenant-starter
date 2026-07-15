<!--
add-member.md — recipe for inviting / changing role / removing members.

Pattern mirror: skills/add-workspace.md (also company-admin). The
specific twist: members require a JOIN with auth.users to find the
invitee by email, which only service_role can do across the platform.
-->

# Skill: Add member-management operations

## Pre-flight

1. Read `AGENTS.md` § 1.1 (tenancy boundary).
2. Read `skills/add-admin-action.md` — same patterns, different domain.
3. Read `skills/add-workspace.md` — same structure, different domain.
4. Read `app/(tenant)/api/admin/members/invite/route.ts`,
   `.../[id]/role/route.ts`, `.../[id]/route.ts` as canonical examples.

## When to use this skill

Use it when:
- The user wants to add a member-invite form.
- The user wants to change a member's role (member <-> admin <-> owner).
- The user wants to remove a member from a workspace.
- The user wants to add bulk invites (TODO — extend the patterns here
  when needed).

Don't use it when:
- You want to update the user's profile data (use a separate
  `/api/me/profile` endpoint — different scope).
- You want to change which company a member belongs to (not
  supported — out of scope).

## Output

1. **A new endpoint** at `app/(tenant)/api/admin/members/<action>/route.ts`.
2. **An audit event** on success.
3. **Validation** to prevent last-owner scenarios.

## Critical constraint: last-owner protection

You CANNOT remove or demote the **last owner** of a workspace. The
check is server-side; never trust the client. Without it, you can
lock yourself out of a workspace.

```ts
// Pseudocode for the check
const { data: owners } = await service
  .from("memberships")
  .select("id")
  .eq("workspace_id", target.workspace_id)
  .eq("role", "owner");
if ((owners ?? []).length <= 1 && target.role === "owner") {
  return err(ApiErrorCode.LAST_OWNER, "Cannot remove the last owner.");
}
```

Note: this requires fetching the workspace_id of the target membership
BEFORE the update. Pattern:

```ts
const { data: target } = await service
  .from("memberships")
  .select("id, company_id, user_id, workspace_id, role")
  .eq("id", membershipId)
  .maybeSingle();

// Check last-owner (only if we're touching an owner).
if (target.role === "owner") {
  // ... last-owner check ...
}

// Then update.
```

## Invite endpoint

### Cross-tenant lookup: invitee may not be in your company

The invitee could be:
- A user who has signed in before (auth.users row exists)
- A user who has never signed in (no auth.users row — they need to
  sign in once via magic link first)

The endpoint queries `auth.admin.listUsers()` because regular
`supabase.auth.admin` is server-only. There's no "lookup by email"
method, so we fetch the first page and filter in code. For larger
user bases, add a dedicated lookup function.

```ts
const { data: userList } = await service.auth.admin.listUsers({
  page: 1,
  perPage: 200,
});
const invitee = userList?.users?.find(
  (u) => u.email?.toLowerCase() === body.email.toLowerCase(),
);
if (!invitee) {
  return err(
    ApiErrorCode.NOT_FOUND,
    "Invitee has no account yet. Ask them to sign in once.",
  );
}
```

`perPage: 200` is fine for small/medium platforms. If your user
base grows beyond that, add a server-side search by email via
`auth.admin.getUserByEmail()` (available in newer Supabase versions).

## Change-role endpoint

```ts
const Body = z.object({
  role: z.enum(["owner", "admin", "member"]),
});

export const PATCH = withApi(async (request) => {
  const ctx = await getActiveContext();
  const guard = await requireCompanyAdmin(ctx.company.id);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const membershipId = url.pathname.split("/")[4]; // /api/admin/members/[id]/role
  if (!membershipId) {
    return err(ApiErrorCode.VALIDATION_FAILED, "Missing membership id.");
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return err(
      ApiErrorCode.VALIDATION_FAILED,
      "Body must be { role: 'owner' | 'admin' | 'member' }.",
    );
  }

  const service = createServiceClient();

  // Fetch target with workspace_id for the last-owner check.
  const { data: target, error: tErr } = await service
    .from("memberships")
    .select("id, company_id, user_id, workspace_id, role")
    .eq("id", membershipId)
    .maybeSingle();
  if (tErr || !target) {
    return err(ApiErrorCode.NOT_FOUND, "Membership not found.");
  }
  if (target.company_id !== ctx.company.id) {
    return err(ApiErrorCode.COMPANY_MISMATCH, "Membership belongs to another company.");
  }

  // Last-owner check (only if demoting from owner).
  if (target.role === "owner" && body.role !== "owner") {
    const { data: wsMembership } = await service
      .from("memberships")
      .select("workspace_id")
      .eq("id", membershipId)
      .maybeSingle();
    const { data: owners } = await service
      .from("memberships")
      .select("id")
      .eq("workspace_id", wsMembership!.workspace_id)
      .eq("role", "owner");
    if ((owners ?? []).length <= 1) {
      return err(
        ApiErrorCode.LAST_OWNER,
        "Cannot demote the last owner of a workspace.",
      );
    }
  }

  const { data, error } = await service
    .from("memberships")
    .update({ role: body.role })
    .eq("id", membershipId)
    .select()
    .single();
  if (error) {
    return err(ApiErrorCode.DB_ERROR, error.message);
  }

  const meta = extractRequestMeta(request);
  await recordAuditEvent({
    actor: ctx.user,
    companyId: ctx.company.id,
    workspaceId: data.workspace_id,
    eventType: "member.role_changed",
    payload: {
      target_user_id: target.user_id,
      old_role: target.role,
      new_role: body.role,
    },
    ...meta,
  });

  return ok(data);
});
```

## Remove endpoint

Same shape as PATCH but DELETE. The last-owner check applies.

```ts
if (target.role === "owner") {
  const { data: owners } = await service
    .from("memberships")
    .select("id")
    .eq("workspace_id", target.workspace_id)
    .eq("role", "owner");
  if ((owners ?? []).length <= 1) {
    return err(
      ApiErrorCode.LAST_OWNER,
      "Cannot remove the last owner of a workspace.",
    );
  }
}

const { error } = await service
  .from("memberships")
  .delete()
  .eq("id", membershipId);
```

## Anti-patterns

- ❌ **Skipping the last-owner check.** Always run it for owner operations.
- ❌ **Trusting the client to specify workspace_id.** Always derive
  it from the existing membership row.
- ❌ **Sending invite emails from this endpoint.** The invite endpoint
  just creates the row; emails are a separate concern (transactional
  email setup, link templates, etc.). Add a separate job for that.
- ❌ **Auditing with the new role instead of the old.** Record the
  diff (`old_role`, `new_role`) so operators can reconstruct what
  happened.

## VERIFY

- [ ] `pnpm typecheck` clean.
- [ ] Sign in as company admin → invite a member → they appear in the
      members list.
- [ ] Try to demote the last owner → 403 LAST_OWNER.
- [ ] Change a member's role → audit log shows old_role and new_role.
- [ ] Remove a non-owner member → they're gone from the list.
- [ ] Sign in as a regular member → all endpoints return 403.

## What this skill does NOT cover

- **Self-service role changes.** Members changing their own role is
  not a thing — only admins can. If you want role-request flows,
  add a separate `role_request` table and a workflow.
- **Cross-company membership.** A user can be in many companies, but
  they're always invited per-company. No cross-company bulk invite.
- **Bulk invitations.** Pattern: extend the invite endpoint to
  accept `{ emails: string[] }` and process them in a loop with one
  audit event per email. Out of scope for the initial template.

## Rollback

Memberships are soft in the sense that you can re-invite. But the
`joined_at` timestamp survives — re-invites get a NEW `joined_at`.
If you need to undo a remove, re-issue the invite with the original
`joined_at` (manual SQL). Document this in your ops runbook.