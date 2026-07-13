# End-to-end flow — annotated trace

A real request, traced from the browser through every layer to the
database and back. Useful for agents building mental models and humans
debugging production issues.

## Scenario

A user on `marketing@acme.com` clicks their magic-link in their inbox.

## Trace

### 1. Email click → browser navigates

```
URL: https://acme.tuapp.local:3000/auth/callback?code=<long-base64>
     \________________/  \_______________/  \_______________/
      subdomain (Acme)   our app              Supabase PKCE code
```

### 2. Edge: Vercel CDN

Vercel receives the request at the nearest PoP. Because the URL has a
wildcard cert, the connection terminates cleanly. Vercel routes to the
`iad1` region where the function lives.

### 3. proxy.ts runs (Edge runtime)

```
request: GET /auth/callback?code=...
         Host: acme.tuapp.local:3000
         Cookie: (none yet)
```

1. `isPublicPath("/auth/callback")` → true. Pass through.
2. `parseHost("acme.tuapp.local:3000")` →
   `{ hostname: "acme.tuapp.local", companySlug: "acme", isPreview: false }`.
3. `applyNoStore(response)` sets `Cache-Control: no-store` on the response.
4. Forward to the route handler.

### 4. app/auth/callback/route.ts (Node runtime)

1. `supabase.auth.exchangeCodeForSession(code)` — Supabase sets three
   cookies: `sb-<ref>-auth-token` (the actual JWT, split into chunks for
   cookie size limits), plus chunked variants. Writes happen via
   `setAll` in `lib/supabase/server.ts`.
2. The auth hook (`supabase/migrations/0003_auth_hook.sql`) runs in
   Postgres. It reads `memberships` for this user and stamps
   `app_metadata.company_memberships` into the JWT payload.
3. The hook also stamps `app_metadata.token_version: 1`.
4. `supabase.auth.getClaims()` reads the JWT, validates the signature
   against Supabase's published public keys, returns the parsed claims.
5. The route reads `claims.app_metadata.company_memberships`:
   ```
   [
     { company_slug: "acme", workspace_slug: "marketing", role: "owner" },
     { company_slug: "acme", workspace_slug: "sales",     role: "member" }
   ]
   ```
6. Since `active_workspace_id` is unset, we pick the first membership:
   `acme / marketing`.
7. Returns a `302` to `https://acme.tuapp.local:3000/w/marketing/dashboard`.

### 5. Browser follows redirect

```
URL: https://acme.tuapp.local:3000/w/marketing/dashboard
     Cookie: sb-<ref>-auth-token=<chunked-jwt>; ...
```

### 6. proxy.ts runs again

```
request: GET /w/marketing/dashboard
         Host: acme.tuapp.local:3000
         Cookie: sb-<ref>-auth-token=<chunked-jwt>
```

1. `isPublicPath("/w/marketing/dashboard")` → false.
2. `parseHost(...)` → `companySlug: "acme"`.
3. `createServerClient(...)` with anon key. `setAll` reads cookies from
   the request.
4. `supabase.auth.getClaims()` validates the JWT. Token is fresh, no
   refresh needed.
5. Reads `claims.app_metadata.company_memberships`. Finds the entry
   where `company_slug === "acme"`. Sets `x-company-id`, `x-company-slug`
   on the response headers.
6. `parseWorkspaceFromPath("/w/marketing/dashboard")` → `"marketing"`.
   Finds the entry where `workspace_slug === "marketing"`. Sets
   `x-workspace-id`, `x-workspace-slug`.
7. `applyNoStore(response)`. Forward to RSC.

### 7. app/(tenant)/layout.tsx runs (Node runtime)

```
const ctx = await getActiveContext();
// → { user: {...}, company: { id, slug: "acme" }, workspace: { id, slug: "marketing" }, role: "owner", memberships: [...] }
```

Note: `getActiveContext()` re-reads the JWT from cookies. It does NOT
trust the headers from proxy.ts. This is intentional: defense in depth.

### 8. app/(tenant)/dashboard/page.tsx runs

```
const supabase = await createClient();
const { data: notes } = await supabase
  .from("notes")
  .select("id, title, body, created_at")
  .order("created_at", { ascending: false })
  .limit(10);
```

The Supabase client attaches the user's JWT to the PostgREST request.
RLS evaluates:

```sql
create policy notes_select_active_workspace on public.notes
  for select to authenticated
  using (workspace_id = public.current_workspace_id());
```

`current_workspace_id()` reads from `auth.jwt() -> 'app_metadata' ->
'active_workspace_id'`. But wait — we just signed in and didn't call
`switch-workspace` yet, so `active_workspace_id` is null!

→ The query returns 0 rows. The user sees an empty dashboard.

To fix this for first-time users, the auth callback (step 4) should
also set `active_workspace_id` via the service client. **This is a
known TODO documented in `docs/RISKS.md` and `skills/add-table.md`'s
recipe for new flows.**

### 9. User clicks "Switch to sales" in /settings

The Switcher component POSTs to `/api/me/switch-workspace` with
`{ workspaceId: "<sales-id>" }`.

### 10. app/(tenant)/api/me/switch-workspace/route.ts runs

1. `withApi` wrapper sets no-store, generates requestId.
2. `getActiveContext()` — succeeds; `ctx.workspace.id` is still
   "marketing" at this point.
3. Validate the requested `workspaceId` is in `ctx.memberships`.
4. **`createServiceClient()`** — bypasses RLS for the metadata update.
5. `auth.admin.updateUserById(ctx.user.id, { app_metadata: {
   active_workspace_id: "<sales-id>", active_company_id: "<acme-id>",
   active_role: "member", active_workspace_slug: "sales" } })`.
6. `supabase.auth.refreshSession()` — triggers a fresh JWT issuance.
   The hook re-runs (memberships unchanged, fast path), the new claims
   are stamped into the cookies.
7. Returns `{ ok: true, data: { workspace: {...sales...}, role: "member" } }`.

### 11. Browser navigates to /w/sales/dashboard

The Switcher's client-side code does
`window.location.href = '/w/sales/dashboard'`.

### 12. proxy.ts + RSC repeat, this time with the new active workspace

`current_workspace_id()` now returns sales's id. The dashboard query
returns sales notes.

## Observations

- **Cookies carry the entire session.** No server-side session store.
  This is intentional (matches Supabase's model) but means JWT refresh
  must happen on the same request that triggers the refresh — done via
  `setAll` in proxy.ts.
- **RLS is the only thing standing between users and other tenants.**
  Every query goes through `auth.jwt()` evaluation. If RLS is wrong or
  missing, data leaks.
- **`active_workspace_id` is the dynamic piece.** It's set via API, not
  in the hook. The hook stamps the membership list (relatively static);
  the API stamps the active pointer (mutable, per-request). This split
  is deliberate — see `docs/ARCHITECTURE.md`.
- **The first-login empty dashboard is a UX gotcha.** Documented in
  `docs/RISKS.md`. Two fixes:
  1. Have the auth callback set `active_workspace_id` after exchange.
  2. Or have `getActiveContext()` auto-pick the first membership if no
     active one is set (less explicit, but smoother UX).

For real production use, fix #1 in the callback is the canonical
approach.