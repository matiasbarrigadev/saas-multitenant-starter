# Recipes

> Canonical, copy-pasteable examples. Each recipe shows the minimum viable
> change for a common extension. Use them as templates — do not invent
> your own structure.
>
> These recipes are the **canonical pattern**. If you find yourself
> deviating, write a new recipe here and link it from `llms.txt`.

## Recipe index

| To add... | Recipe |
|---|---|
| A new tenant-scoped table | [§1. Tenant-scoped table](#1-tenant-scoped-table) |
| A new typed API route | [§2. Typed Route Handler](#2-typed-route-handler) |
| A new UI page in the protected area | [§3. Tenant-scoped page](#3-tenant-scoped-page) |
| A new admin operation (service role) | [§4. Admin operation](#4-admin-operation-service-role) |
| A new auth flow / sign-in method | [§5. Auth flow](#5-auth-flow) |
| A new env var | [§6. Env var](#6-env-var) |

---

## 1. Tenant-scoped table

Use when the new entity is owned by a workspace and isolation must be
RLS-enforced. Pattern adapted from `supabase/migrations/0005_notes_example.sql`.

### Files to create / modify

1. `supabase/migrations/0006_<name>.sql` — schema + RLS.
2. `lib/supabase/types.ts` — add the row types so the client is typed.
3. Update `llms.txt` (add a mention under "Architecture files").

### Recipe (paste into a new file `0006_invoices.sql`)

```sql
-- =============================================================================
-- Migration 0006: invoices (example — adjust to your real domain).
-- =============================================================================

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Domain fields below — replace with yours.
  customer_email text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'void')),
  due_at timestamptz,
  created_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.invoices is
  'Invoices are workspace-scoped. See docs/RLS.md.';

create index idx_invoices_workspace on public.invoices(workspace_id);
create index idx_invoices_status     on public.invoices(workspace_id, status);

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- ⚠️ Enable RLS the moment the table is created.
alter table public.invoices enable row level security;

-- RLS policies — same pattern as notes. Adjust the author-or-admin rule
-- for your domain.
create policy invoices_select_active_workspace on public.invoices
  for select to authenticated
  using (workspace_id = public.current_workspace_id());

create policy invoices_insert_active_workspace on public.invoices
  for insert to authenticated
  with check (
    workspace_id = public.current_workspace_id()
    and created_by = auth.uid()
  );

create policy invoices_update_author_or_admin on public.invoices
  for update to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and (
      created_by = auth.uid()
      or public.current_user_role() in ('owner', 'admin')
    )
  )
  with check (
    workspace_id = public.current_workspace_id()
    and (
      created_by = auth.uid()
      or public.current_user_role() in ('owner', 'admin')
    )
  );

create policy invoices_delete_admin_only on public.invoices
  for delete to authenticated
  using (
    workspace_id = public.current_workspace_id()
    and public.current_user_role() in ('owner', 'admin')
  );
```

### Types update (`lib/supabase/types.ts`)

Add the row/insert/update shapes to the `Database` map. Mirror the
structure used by `notes` in `types.ts`.

### Verification

- [ ] `npx supabase db diff` shows the new migration applied cleanly.
- [ ] With a JWT active in workspace `marketing`, `select * from invoices`
      returns only Marketing invoices.
- [ ] Switching to workspace `sales` hides them.

---

## 2. Typed Route Handler

Use when exposing a new endpoint to the client. Pattern from
`app/(tenant)/api/notes/route.ts`.

### File location

`app/(tenant)/api/<resource>/route.ts` for tenant-scoped endpoints.
`app/api/<resource>/route.ts` for public endpoints.

### Recipe

```ts
import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/<resource> — list recent rows in the active workspace.
 *
 * Protected. Tenant-scoped via `proxy.ts`. RLS is the only thing standing
 * between users and other tenants' data — never add a manual filter.
 */
export const GET = withApi(async () => {
  const ctx = await getActiveContext();
  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("<resource>")
    .select("<columns>", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[api/<resource> GET] DB error:", error);
    return err(ApiErrorCode.DB_ERROR, "Could not load <resource>.");
  }

  return ok(data ?? [], { meta: { count: count ?? data?.length ?? 0 } });
});

const CreateBody = z.object({
  // ... zod schema for the body
});

/**
 * POST /api/<resource> — create a row in the active workspace.
 */
export const POST = withApi(async (request) => {
  const ctx = await getActiveContext();
  const supabase = await createClient();

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await request.json());
  } catch {
    return err(
      ApiErrorCode.VALIDATION_FAILED,
      "Body must match the documented schema.",
    );
  }

  const { data, error } = await supabase
    .from("<resource>")
    .insert({
      workspace_id: ctx.workspace.id,
      created_by: ctx.user.id,
      // ... other fields
    })
    .select()
    .single();

  if (error) {
    if (error.code === "42501") {
      return err(ApiErrorCode.WORKSPACE_FORBIDDEN, "Cannot create this row.");
    }
    console.error("[api/<resource> POST] DB error:", error);
    return err(ApiErrorCode.DB_ERROR, "Could not create row.");
  }

  return ok(data, { status: 201 });
});
```

### Verification

- [ ] `curl -X POST $HOST/api/<resource>` with no body → 400 with
      `code: VALIDATION_FAILED`.
- [ ] With invalid cookie → 401 with `code: AUTH_REQUIRED` (caught by
      `proxy.ts` redirect, but visible if hit directly).
- [ ] With valid cookie in workspace `marketing` → 200/201 with the row.
- [ ] Response headers include `Cache-Control: no-store` (enforced by
      `withApi`).

---

## 3. Tenant-scoped page

Use when adding a new UI page in the protected app. Pattern from
`app/(tenant)/dashboard/page.tsx`.

### File location

`app/(tenant)/<page>/page.tsx`.

### Recipe

```tsx
import { redirect } from "next/navigation";

import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";

export default async function MyPage() {
  let ctx;
  try {
    ctx = await getActiveContext();
  } catch {
    redirect("/settings");
  }

  // Query a tenant-scoped table. RLS does the filtering.
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("<resource>")
    .select("id, title, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <main>
      <h1 style={{ margin: 0, fontSize: "1.75rem" }}>
        My page (workspace: {ctx.workspace.slug})
      </h1>
      {error ? (
        <p style={{ color: "#991b1b" }}>Failed: {error.message}</p>
      ) : (
        <ul>{rows?.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
      )}
    </main>
  );
}
```

### Verification

- [ ] Page renders only when authenticated (proxy.ts redirects to /login
      otherwise).
- [ ] Page shows the active workspace slug in the heading.
- [ ] Switching workspace via /settings changes the page header.

---

## 4. Admin operation (service role)

Use for operations that MUST bypass RLS, e.g. invitations, role changes,
or batch admin tasks. **Justify the bypass with a comment.** Pattern from
`app/(tenant)/api/me/switch-workspace/route.ts`.

### Recipe

```ts
import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { getActiveContext } from "@/lib/tenant/context";
import { createServiceClient } from "@/lib/supabase/service";

const RequestBody = z.object({
  workspaceId: z.string().uuid(),
  inviteeEmail: z.string().email(),
  role: z.enum(["owner", "admin", "member"]).default("member"),
});

/**
 * POST /api/<resource>/admin-invite — admin invites a user to a workspace.
 *
 * Justification for service_role:
 *   - We need to insert a membership row for a user_id that hasn't yet
 *     accepted. The admin auth context can't RLS-allow inserting for
 *     another user.
 *   - We validate the admin's right to invite (role check) before the
 *     bypass.
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

  // RLS-bypass: justified above. The admin role check is our gate.
  const service = createServiceClient();

  // 1. Resolve invitee by email.
  const { data: inviteeData, error: lookupErr } =
    await service.auth.admin.listUsers({ email: body.inviteeEmail });
  if (lookupErr || !inviteeData?.users?.length) {
    return err(ApiErrorCode.NOT_FOUND, "Invitee has no account yet.");
  }
  const inviteeId = inviteeData.users[0].id;

  // 2. Insert membership.
  const { error: insertErr } = await service.from("memberships").insert({
    workspace_id: body.workspaceId,
    user_id: inviteeId,
    company_id: ctx.company.id,
    role: body.role,
    invited_at: new Date().toISOString(),
    joined_at: new Date().toISOString(),
  });
  if (insertErr) {
    console.error("[admin-invite] insert failed:", insertErr);
    return err(ApiErrorCode.DB_ERROR, "Could not create membership.");
  }

  return ok({ invited: true });
});
```

### Verification

- [ ] Non-admin caller → 403 ROLE_INSUFFICIENT.
- [ ] Admin caller → 200; membership visible to admin via `/api/me`.
- [ ] Invitee receives an email with the accept link (assuming you wire
      up transactional email — out of scope for this template).

---

## 5. Auth flow

Use when adding a new sign-in method (e.g. Google OAuth, SMS link, magic
link with redirect customization). Pattern from
`app/api/auth/request-link/route.ts` and `app/auth/callback/route.ts`.

### Files to create / modify

1. `app/api/auth/<flow-name>/route.ts` — initiate.
2. `app/auth/<flow-name>-callback/route.ts` — exchange and redirect.
3. `app/(auth)/<flow-name>/page.tsx` — UI button.

### Recipe (initiate)

```ts
import { withApi } from "@/lib/api/handler";
import { ok, warn } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { parseHost, buildAbsoluteUrl } from "@/lib/tenant/host";
import { env } from "@/lib/env";

export const POST = withApi(async (request) => {
  const supabase = await createClient();
  const host = parseHost(request.headers.get("host"));
  const redirectTo = buildAbsoluteUrl(
    host.companySlug,
    "/auth/<flow-name>-callback",
  );

  const { error } = await supabase.auth.signInWith<Provider>({
    options: { redirectTo },
  });

  if (error) {
    if (error.status === 429) {
      return warn({ sent: false }, {
        code: "RATE_LIMITED",
        message: "Try again in a minute.",
      });
    }
    return {
      ok: false,
      error: {
        code: "UPSTREAM_ERROR",
        message: "Could not start sign-in.",
      },
      requestId: "upstream",
    };
  }

  return ok({ started: true });
});
```

### Recipe (callback)

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  // Re-use the redirect logic from app/auth/callback/route.ts.
  // (Extract to a helper if you add more flows.)
  return NextResponse.redirect(`${origin}/`);
}
```

### Verification

- [ ] Unauthenticated user clicks button → lands in provider.
- [ ] After provider auth → lands on `/dashboard` (or wherever).
- [ ] Coexists with existing magic-link flow (both work).

---

## 6. Env var

Use when adding any new environment variable. Pattern from `lib/env.ts` and
`.env.example`.

### Recipe

In **`.env.example`**:

```bash
# PUBLIC (in client bundle) or SERVER-ONLY (NEVER in client bundle)?
# If PUBLIC: prefix with NEXT_PUBLIC_, accept that it's visible to users.
# If SERVER-ONLY: do NOT prefix; will fail the build if imported into a
# Client Component.

NEW_VAR_NAME="default-or-doc-value"
```

In **`lib/env.ts`**:

```ts
const publicSchema = z.object({
  // ... existing
  NEW_VAR_NAME: z.string().min(1, "NEW_VAR_NAME is required"),
});

const serverSchema = z.object({
  // ... existing
});
```

### Verification

- [ ] `pnpm dev` without the var set → clear error in the terminal.
- [ ] `pnpm build` without the var set → build fails fast.
- [ ] `pnpm build` with the var set → builds.
- [ ] Documented in `docs/ENV.md` (add an entry).

---

## Honoring the recipes

If a recipe here and a `skills/*.md` file disagree, the recipe wins for
**the shape of the output** (file structure, naming); the skill wins for
**the step-by-step procedure** (which file to create first, which order).
