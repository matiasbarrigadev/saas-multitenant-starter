# Risks & Mitigations

Living document of the non-obvious risks this template accepts and how we
mitigate them. Each entry: **what** can go wrong, **how** we defend, **how**
to verify the defense is in place.

## High-priority

### R1. Cross-tenant session leakage via CDN cache

- **What**: A response generated for user A on company Acme gets cached
  by Vercel's CDN and served to user B on company Globex.
- **How we defend**:
  - `Cache-Control: no-store, max-age=0` on every authenticated response.
    Enforced by `lib/api/handler.ts` (for Route Handlers) and `proxy.ts`
    (for page responses).
  - Cookies are scoped to the subdomain: an `acme.tuapp.com` cookie is
    never sent to `globex.tuapp.com`.
  - Wildcard DNS is one level deep only — can't accidentally serve
    Acme's HTML from an unrelated subdomain.
- **Verify**:
  - `curl -I https://acme.tuapp.com/w/marketing/dashboard` →
    `Cache-Control: no-store`.
  - DevTools → Network → any authenticated request → response shows
    `no-store` + `Set-Cookie: sb-...`.

### R2. `service_role` key leak

- **What**: The service role key bypasses RLS for the entire database. If
  it's exposed to the client bundle, anyone can read/write anything.
- **How we defend**:
  - `lib/supabase/service.ts` starts with `import "server-only"` — Next.js
    fails the build if a Client Component imports it.
  - The key is read from `lib/env.ts` with no `NEXT_PUBLIC_` prefix.
  - Server-only routes that use it follow `skills/add-admin-action.md`,
    which requires a "Justification for service_role" comment per use.
- **Verify**: `pnpm build` should fail if any Client Component accidentally
  imports `service.ts`.

### R3. RLS left disabled on a new table

- **What**: A new tenant-scoped table is created without RLS, so anyone
  with the publishable key can read it (CVE-2025-48757 exploited ~170
  Lovable projects this way).
- **How we defend**: `AGENTS.md` § 1.1 mandates `enable row level security`
  in the same migration that creates the table. `skills/add-table.md`
  enforces the same pattern.
- **Verify**: `get_advisors` for security in Supabase Studio catches
  tables missing RLS.

### R4. JWT staleness after role change

- **What**: If an admin demotes another user from `admin` to `member`,
  the demoted user's existing JWT still has the old role until natural
  refresh (~1h).
- **How we defend** (current): the demoted user's JWT will refresh on
  the next request that triggers `getClaims()` near expiry. For
  immediate staleness fixes, the user must sign out / sign in.
- **Why we accept this risk**: out-of-band forced logout requires either
  a versioned JWT pattern (check `app_metadata.token_version` in
  `getClaims`) or a websocket broadcast. Both are out of scope for the
  template.
- **Future mitigation** (documented in `docs/AUTH.md`): stamp
  `token_version` in the auth hook (already done), and have `getClaims`
  refuse tokens whose version is older than the current DB value.

### R5. Wildcard DNS mis-scope

- **What**: A user types `tenant1.tenant2.tuapp.com`, expecting to reach
  a specific company. Wildcard SSL only covers one level (`*.tuapp.com`).
- **How we defend**: `lib/tenant/host.ts` rejects subdomains containing
  a dot inside the company slug. Multi-level subdomains render as apex.
- **Verify**: visiting `acme.globex.tuapp.com` should fall back to apex
  treatment (no company resolution).

## Medium-priority

### R6. Session cookie stolen via XSS

- **What**: A XSS in the React tree reads `document.cookie` and exfils
  the auth cookies.
- **How we defend**: cookies are `httpOnly: true` (see
  `lib/supabase/server.ts`). XSS cannot read httpOnly cookies.
- **Verify**: open DevTools → Application → Cookies → confirm `httpOnly`
  column is checked for `sb-...` cookies.

### R7. Open redirect in /auth/callback

- **What**: `?next=` is honored without validation, allowing phishing
  links off-platform after sign-in.
- **How we defend**: `app/auth/callback/route.ts` has a `isSafeNext()`
  check that requires the next path to start with `/` and not `//`
  (protocol-relative URL).
- **Verify**: send a request to `/auth/callback?code=...&next=//evil.com`
  and confirm it's not honored.

### R8. RLS bypass via custom_access_token_hook bug

- **What**: If the hook grants `execute` to the wrong role, anyone with
  SQL access can forge JWT claims.
- **How we defend**: migration `0003_auth_hook.sql` does
  `grant execute ... to supabase_auth_admin; revoke ... from public`
  exactly. AGENTS.md forbids editing committed migrations.
- **Verify**: `select has_function_privilege('public', 'custom_access_token_hook(jsonb)', 'execute')`
  should return `false`.

## Low-priority

### R9. Hook performance at scale

- **What**: The auth hook runs a `select from memberships` on every JWT
  issuance. With N workspaces per user this can be slow.
- **How we defend**: the auth hook uses `stable` and joins are indexed
  (`memberships(user_id)` index from migration 0001).
- **Future mitigation**: cache the membership list in `app_metadata` and
  only refresh on membership events, via a webhook.

### R10. Subdomain enumeration via tenant_not_found redirect

- **What**: `/auth/callback?next=...` redirects to `/?company_not_found=<slug>`
  on an unknown subdomain, leaking which subdomains exist.
- **How we defend**: the apex `?company_not_found=` query is read but
  not rendered anywhere user-visible in this template. Forks that add
  marketing pages should treat the param as private.
- **Verify**: grep the codebase for `company_not_found` — only
  `proxy.ts` and `app/(tenant)/layout.tsx` should reference it.

### R11. Tenant context leak via custom JWT claim

- **What**: a future migration adds a claim that exposes data across
  workspaces accidentally.
- **How we defend**: all data-isolation checks happen in RLS, not in
  JS. Even if a JWT claim is wrong, RLS will block reads. The custom
  claim is "directional" only (it tells RLS which workspace to filter).

### R12. Migration ordering collision

- **What**: Two parallel agents create `0007_finance.sql` and
  `0007_notifications.sql`, both ship, conflict.
- **How we defend**: AGENTS.md § 1.5 (in review). Numeric ordering + one
  migration per focused change. The convention: first commit wins,
  second author renumbers.

---

## service_role uses

Each service_role use in this template is documented here. When adding
a new admin action, append an entry.

| File | Operation | Justification | Mitigation in code |
|---|---|---|---|
| `app/(tenant)/api/me/switch-workspace/route.ts` | Set user's active workspace | Updating `app_metadata` requires admin API; user can't self-update their own app_metadata. | Membership check before bypass. |
