<!--
add-api-route.md — Vendor-neutral skill for adding a typed Route Handler.
-->

# Skill: Add a typed Route Handler

## Pre-flight

1. Read `AGENTS.md` § 1.4 (Runtime choice) and § 5 (Pre-commit checklist).
2. Read `docs/CONVENTIONS.md` § API response shape.
3. Read `lib/api/response.ts`, `lib/api/handler.ts`, `lib/api/errors.ts`
   in full (these are the helpers the recipe wraps).
4. Read `app/(tenant)/api/notes/route.ts` end to end as the worked example.
5. Confirm whether the new endpoint is tenant-scoped (under
   `app/(tenant)/api/`) or public (under `app/api/`).

## When NOT to use this skill

- The endpoint is just a thin pass-through to Supabase without RLS or
  shape normalization. Use PostgREST directly via the typed client.
- The endpoint is server-side rendered as part of a page. Write a Server
  Component instead.
- You need edge-runtime latency without DB access. Then it's still a
  Route Handler, but with `export const runtime = 'edge'` and a comment
  justifying it.

## Output

The agent produces one new file at
`app/(tenant)/api/<resource>/route.ts` (or `app/api/<resource>/route.ts`
if public).

## Step 1 — Decide the operations

| Operation | Method | Convention |
|---|---|---|
| List / read one or many | `GET` | returns `{ ok: true, data, meta: { count } }` |
| Create | `POST` | returns `{ ok: true, data, ... }` with `status: 201` |
| Update (full or partial) | `PATCH` | returns the updated row |
| Delete | `DELETE` | returns `{ ok: true, data: { id } }` or 204 |

If you need more than GET + POST, export each as a separate function
from the same file. Don't bundle unrelated logic in one handler.

## Step 2 — Define the Zod body schema

For any `POST` / `PATCH` body, declare:

```ts
const Body = z.object({
  field1: z.string().min(1).max(200),
  field2: z.number().int().nonnegative(),
  // ...
});
```

Then in the handler:

```ts
let body: z.infer<typeof Body>;
try {
  body = Body.parse(await request.json());
} catch {
  return err(ApiErrorCode.VALIDATION_FAILED, "Body must match the schema.");
}
```

Zod errors are caught automatically by `withApi` too — calling
`Body.parse()` outside the wrapper is fine but the manual approach is
less surprising.

## Step 3 — Wrap with withApi

### WHY

`withApi` applies `Cache-Control: no-store`, maps errors uniformly
(includes TenantContextError → 401/403/404 and ZodError → 400), and
generates a `requestId` for log correlation. Skipping it means **you
break the cross-tenant cache contract**.

### HOW

```ts
import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";

export const GET = withApi(async () => {
  // ...
  return ok(data, { meta: { count: ... } });
});
```

The wrapped handler can return:
- An `ok`/`warn`/`err` object — passed through.
- A plain value — wrapped as `ok(value)`.
- A thrown error — caught and mapped.

## Step 4 — Read tenant context (if applicable)

For tenant-scoped routes, the first line should be:

```ts
const ctx = await getActiveContext();
```

This throws if the request is unauthenticated or lacks an active workspace.
`withApi` maps it to the right HTTP status automatically.

Do NOT manually check `if (!ctx)` — let the throw happen.

## Step 5 — Query the database

Use the RLS-respecting client:

```ts
const supabase = await createClient();
const { data, error } = await supabase
  .from("<table>")
  .select("<columns>")
  // ...
```

For inserts, set `workspace_id` from `ctx.workspace.id`:

```ts
await supabase.from("<table>").insert({
  workspace_id: ctx.workspace.id,
  created_by: ctx.user.id,
  // ...
});
```

Never hardcode a workspace_id. Never read workspace_id from request
body or query string.

## Step 6 — Map errors to ApiErrorCode

| Supabase error code | Map to |
|---|---|
| `42501` (insufficient_privilege, RLS reject) | `WORKSPACE_FORBIDDEN` |
| `PGRST116` (no rows for `.single()`) | `NOT_FOUND` |
| Anything else | `DB_ERROR` (log full error server-side) |

```ts
if (error.code === "42501") {
  return err(ApiErrorCode.WORKSPACE_FORBIDDEN, "Cannot create this row.");
}
console.error("[api/<resource> POST] DB error:", error);
return err(ApiErrorCode.DB_ERROR, "Could not create row.");
```

## Full recipe (GET + POST example)

```ts
/**
 * GET /api/<resource>  — list recent rows in the active workspace.
 * POST /api/<resource> — create a row in the active workspace.
 *
 * Both protected by proxy.ts; RLS provides data isolation.
 */

import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";

export const GET = withApi(async () => {
  const ctx = await getActiveContext();
  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("<resource>")
    .select("id, title, body, created_at, updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[api/<resource> GET] DB error:", error);
    return err(ApiErrorCode.DB_ERROR, "Could not load rows.");
  }

  return ok(data ?? [], { meta: { count: count ?? data?.length ?? 0 } });
});

const CreateBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(10_000).default(""),
});

export const POST = withApi(async (request) => {
  const ctx = await getActiveContext();
  const supabase = await createClient();

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await request.json());
  } catch {
    return err(
      ApiErrorCode.VALIDATION_FAILED,
      "Body must be { title: string (1-200), body?: string }.",
    );
  }

  const { data, error } = await supabase
    .from("<resource>")
    .insert({
      workspace_id: ctx.workspace.id,
      created_by: ctx.user.id,
      title: body.title,
      body: body.body,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "42501") {
      return err(
        ApiErrorCode.WORKSPACE_FORBIDDEN,
        "Cannot create rows in this workspace.",
      );
    }
    console.error("[api/<resource> POST] DB error:", error);
    return err(ApiErrorCode.DB_ERROR, "Could not create row.");
  }

  return ok(data, { status: 201 });
});
```

## VERIFY

- [ ] `pnpm build` succeeds with the new file.
- [ ] `curl -X POST $HOST/api/<resource>` with no body → 400 with
      `code: VALIDATION_FAILED`.
- [ ] With invalid cookie → 401 with `code: AUTH_REQUIRED` (or a
      redirect, when hitting a page; direct hits see the JSON).
- [ ] With valid cookie in workspace `marketing`, `GET /api/<resource>`
      returns Marketing-only data.
- [ ] Response headers include `Cache-Control: no-store`.

## Rollback

To roll back the endpoint:

1. Delete `app/(tenant)/api/<resource>/route.ts`.
2. If a client component called it, update the client to remove the
   fetch. No database cleanup needed.
