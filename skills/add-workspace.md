<!--
add-workspace.md — recipe for adding workspace-creation logic to a
company admin panel.

Pattern mirror: skills/add-table.md, but for workspace operations
specifically. Workspaces have an additional constraint: slug uniqueness
within (company_id, slug), which requires a cross-tenant defense check.
-->

# Skill: Add workspace creation / archival

## Pre-flight

1. Read `AGENTS.md` § 1.1 (tenancy boundary).
2. Read `docs/TENANCY.md` to confirm the operation belongs at the
   workspace level (vs. company or platform level).
3. Read `skills/add-admin-action.md` — workspace operations follow the
   company-admin pattern.
4. Read `app/(tenant)/api/admin/workspaces/route.ts` (create) and
   `.../workspaces/[id]/archive/route.ts` (archive) as canonical
   examples.

## When to use this skill

Use it when:
- The user wants to add a workspace-create form in the admin panel.
- The user wants to add an archive/unarchive button.
- The user wants to change workspace settings (name, slug — slug is
  locked, see below).

Don't use it when:
- You're modifying how data is queried for an existing workspace
  (use `skills/add-api-route.md`).
- You're moving workspace ownership between companies (not supported
  yet — would require a migration).

## Output

1. **A new endpoint** at `app/(tenant)/api/admin/workspaces/<action>/route.ts`.
2. **A new UI piece** in `app/(tenant)/admin/workspaces/page.tsx` (or a
   new page if the operation is complex enough to warrant it).
3. **An audit event** emitted on success.

## Workspace creation endpoint

### File: `app/(tenant)/api/admin/workspaces/route.ts`

```ts
/**
 * POST /api/admin/workspaces — Create a new workspace in the active company.
 *
 * Justification for service_role:
 *   - workspaces has no INSERT policy for `authenticated` (see 0002).
 *   - We need to verify uniqueness across the company before insert.
 *   - Guard before bypass: requireCompanyAdmin() verified the caller.
 */

import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";

import { requireCompanyAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { extractRequestMeta, recordAuditEvent } from "@/lib/admin/audit";
import { getActiveContext } from "@/lib/tenant/context";

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const Body = z.object({
  slug: z.string().regex(SLUG_RE, "Slug must be kebab-case (a-z, 0-9, dashes)."),
  name: z.string().min(1).max(120),
});

export const POST = withApi(async (request) => {
  const ctx = await getActiveContext();
  const guard = await requireCompanyAdmin(ctx.company.id);
  if (!guard.ok) return guard.response;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return err(
      ApiErrorCode.VALIDATION_FAILED,
      "Body must be { slug: kebab-case, name: string }.",
    );
  }

  const service = createServiceClient();

  // Cross-tenant defense: confirm the slug is not already in use WITHIN
  // this company. (The DB unique constraint will also catch this, but
  // checking first gives a better error message.)
  const { data: existing } = await service
    .from("workspaces")
    .select("id, archived_at")
    .eq("company_id", ctx.company.id)
    .eq("slug", body.slug)
    .maybeSingle();
  if (existing && !existing.archived_at) {
    return err(
      ApiErrorCode.ALREADY_EXISTS,
      `Workspace slug '${body.slug}' already exists in this company.`,
    );
  }

  const { data, error } = await service
    .from("workspaces")
    .insert({
      company_id: ctx.company.id,
      slug: body.slug,
      name: body.name,
    })
    .select()
    .single();
  if (error) {
    return err(ApiErrorCode.DB_ERROR, error.message);
  }

  const meta = extractRequestMeta(request);
  await recordAuditEvent({
    actor: ctx.user,
    companyId: ctx.company.id,
    workspaceId: data.id,
    eventType: "workspace.created",
    payload: { slug: body.slug, name: body.name },
    ...meta,
  });

  return ok(data, { status: 201 });
});
```

### Archive / unarchive endpoint

```ts
/**
 * POST /api/admin/workspaces/[id]/archive — Toggle workspace archive status.
 *
 * Soft archive via `archived_at`. Archived workspaces are hidden from
 * the /w/<slug> resolution (proxy.ts already filters them out), but
 * their data is preserved.
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireCompanyAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { extractRequestMeta, recordAuditEvent } from "@/lib/admin/audit";
import { getActiveContext } from "@/lib/tenant/context";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getActiveContext();
  const guard = await requireCompanyAdmin(ctx.company.id);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const service = createServiceClient();

  // Cross-tenant defense: confirm the workspace belongs to the caller's
  // company before any update.
  const { data: ws, error: readErr } = await service
    .from("workspaces")
    .select("id, company_id, archived_at")
    .eq("id", id)
    .maybeSingle();
  if (readErr || !ws) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Workspace not found." } },
      { status: 404 },
    );
  }
  if (ws.company_id !== ctx.company.id) {
    return NextResponse.json(
      { ok: false, error: { code: "COMPANY_MISMATCH", message: "Workspace belongs to another company." } },
      { status: 403 },
    );
  }

  const willArchive = !ws.archived_at;
  const { error: updateErr } = await service
    .from("workspaces")
    .update({ archived_at: willArchive ? new Date().toISOString() : null })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json(
      { ok: false, error: { code: "DB_ERROR", message: updateErr.message } },
      { status: 500 },
    );
  }

  const meta = extractRequestMeta(request);
  await recordAuditEvent({
    actor: ctx.user,
    companyId: ctx.company.id,
    workspaceId: id,
    eventType: willArchive ? "workspace.archived" : "workspace.unarchived",
    payload: {},
    ...meta,
  });

  return NextResponse.json({ ok: true, data: { id, archived: willArchive } });
}
```

## UI integration

In `app/(tenant)/admin/workspaces/page.tsx`, add a "Create" form.
The form posts to `/api/admin/workspaces`. On success, refresh the
page (or use `router.refresh()` from a client component).

For archive buttons in a row, use a form per row with `action`:
```tsx
<form action={`/api/admin/workspaces/${w.id}/archive`} method="post">
  <button type="submit">{w.archived_at ? "Unarchive" : "Archive"}</button>
</form>
```

These forms work without JS — they navigate on submit. For a
smoother UX, use a client component with `useTransition` and
`fetch()` (mirror the Switcher pattern in
`app/(tenant)/settings/Switcher.tsx`).

## Why slug is locked after creation

Changing a workspace's slug breaks:
- Magic link callbacks that include `/w/<slug>/...`
- Existing emails users sent to teammates
- Any user bookmarks or external integrations

The cost of supporting rename is high; the benefit is low. If you
must support it:

1. Add a `slug_change_locked_at` timestamp; reject renames after some
   grace period.
2. Maintain a redirect table (`old_slug -> new_slug`) and update
   `proxy.ts` to consult it.
3. Send a "your URL is changing" email to all members ahead of time.

For the template, we just don't expose slug mutation.

## Anti-patterns

- ❌ **Creating a workspace without checking slug uniqueness.** The DB
  will reject, but the user gets a generic error. Check first, give a
  specific `ALREADY_EXISTS`.
- ❌ **Hard-deleting an archived workspace.** Always soft-archive. The
  data may have foreign-key references (notes, members, audit events).
- ❌ **Allowing cross-company workspace moves.** Not supported. If a
  workspace needs to change companies, create a new one and migrate
  the data manually.
- ❌ **Bypassing `requireCompanyAdmin`** to allow members to create
  their own workspaces. Only company admins can. Otherwise users would
  create shadow workspaces bypassing the company.

## VERIFY

- [ ] `pnpm typecheck` clean.
- [ ] Sign in as a company owner → create workspace → it appears in
      the workspaces list with status=active.
- [ ] Sign in as a regular member → POST /api/admin/workspaces returns
      403 ROLE_INSUFFICIENT.
- [ ] Archive a workspace → it's hidden from `/w/<slug>` resolution
      (proxy.ts already handles this), but its data is intact.
- [ ] `/admin/api/audit?event_type=workspace.created` shows the new
      event with correct payload.

## Rollback

Workspace archive is reversible (unarchive). Delete is not supported.
If a workspace was created in error, the path is:

1. Soft-archive it (visible nowhere, but data preserved).
2. Optionally: rename it to `archived-<timestamp>` so the slug can be
   reused.
3. After 30+ days, write a manual cleanup migration if hard-deletion
   becomes desirable.