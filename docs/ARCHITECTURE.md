# Architecture

This document explains **why** the template is built the way it is. For
**how to use it**, see [README.md](../README.md).

## TL;DR

- **Two levels of tenancy**: Company (top, by subdomain) + Workspace (sub-tenant, by path `/w/:slug`).
- **Workspace is the data isolation boundary.** RLS is keyed on `workspace_id`. Company is for billing, branding, and "list everyone across all our workspaces".
- **All data lives in one Postgres database, one schema, one row per tenant-scoped entity.** No multi-schema, no multi-DB. This is the canonical Supabase recommendation for SaaS.
- **The auth stack is Supabase Auth with magic links.** The `custom_access_token_hook` injects membership data into JWTs at issuance, so RLS policies can be evaluated without extra joins.
- **Cookie-based sessions** via `@supabase/ssr`. Server-side reads use `supabase.auth.getClaims()`. The browser sees nothing of the JWT.
- **`proxy.ts` (Next.js 16's renamed middleware.ts)** resolves the tenant on every request, refreshes the session, applies no-store headers, and forwards `x-company-id` / `x-workspace-id` to downstream code.
- **Node runtime by default.** Edge only for genuinely latency-sensitive, DB-free paths.

---

## Tenancy hierarchy

```
auth.users (Supabase managed)
    └── memberships (workspace_id, user_id, role)
            └── workspaces (company_id, slug)
                    └── companies (slug)  ← visible in subdomain
```

A user can have many memberships, each scoped to one workspace. A workspace
belongs to one company. A company maps 1:1 to a subdomain.

## Why a custom_access_token_hook?

Without it, every RLS policy needs a join against `memberships`:

```sql
-- Without hook: 3 joins per query.
using (
  exists (
    select 1 from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where w.id = notes.workspace_id
      and m.user_id = auth.uid()
  )
)
```

With it, the data is in the JWT:

```sql
-- With hook: zero joins per query.
using (workspace_id = public.current_workspace_id())
```

The hook (migration `0003_auth_hook.sql`) runs once per token issuance and
stamps `app_metadata.company_memberships` — the full list of
`(company, workspace, role)` tuples for the user. The current *active*
workspace is set separately via `POST /api/me/switch-workspace` and lives
in `app_metadata.active_workspace_id` etc.

The split is deliberate:
- **Membership list** is part of who you are. It changes rarely (admin
  adds you to a workspace). Hook re-runs on next sign-in/refresh.
- **Active workspace** is part of what you're doing right now. It changes
  whenever you click "switch" in the UI. We update it via an explicit API
  call so the change is immediate, not on next token refresh.

## Why workspace as the data boundary, not company?

Because agency-style customers want strict separation between clients:

- Marketing workspace for client A and Sales workspace for client A both
  belong to company A. Users in Marketing should never see Sales data.
- A freelancer consultant may belong to 3 companies (their own + 2 clients),
  each with multiple workspaces. The workspace level gives clean isolation
  even when company boundaries are weaker.

If your business has the opposite shape (every employee sees everything in
the company), you can flip the primary filter to `current_company_id()` and
drop `workspace_id` from your tables. The schema is flexible enough.

## Two Supabase clients, with very different rules

| File | Runtime | Key | Bypasses RLS? | Used by |
|------|---------|-----|---------------|---------|
| `lib/supabase/server.ts` | Node | anon | No (respects JWT) | Server Components, Route Handlers, Server Actions |
| `lib/supabase/browser.ts` | Browser | anon | No (respects JWT) | Client Components |
| `lib/supabase/service.ts` | Node | service-role | **YES** | Admin operations only (e.g. switch-workspace) |

The service client is dangerous. Every call to `createServiceClient()` is
documented in this template — if you fork it and add new admin operations,
follow the same pattern: justify the bypass, validate inputs manually.

## Verified best practices (deep research, jul-2026)

10 claims passed 3-vote adversarial verification and underpin this design:

1. **RLS enabled on every exposed table.** Without policies, the publishable key returns empty results; without RLS, *all* data is exposed. CVE-2025-48757 hit ~170 Lovable projects exactly because they forgot RLS.
2. **`app_metadata` for authorization.** `user_metadata` is user-writable; `app_metadata` is server-only.
3. **`supabase.auth.getClaims()` on the server.** Not `getSession()`, not `getUser()`. It validates the JWT signature every call.
4. **`Cache-Control: no-store` on every authenticated response.** The #1 cross-tenant leak vector on Vercel/CDN.
5. **`custom_access_token_hook` with strict grants.** `execute` only to `supabase_auth_admin`; revoke from everyone else.
6. **Node.js runtime by default.** Edge is for cases without DB access. Cross-region DB latency typically outweighs edge benefits.
7. **Edge Runtime limits.** No `node:fs`, no native modules, no ISR.
8. **Wildcard subdomains require Vercel nameservers.** `ns1.vercel-dns.com` / `ns2.vercel-dns.com`. See [DEPLOY.md](DEPLOY.md).
9. **Subdomain → tenant in `proxy.ts`.** Maps Host header → company slug, then `/w/:slug` → workspace slug.
10. **Single deployment, multi-tenant.** One codebase serves all tenants; per-tenant code is a different model and not what we want here.

### Refuted claims (do NOT do these)

These appeared in our research and were killed by adversarial verification:

- ❌ "Wrap `(select auth.uid())` in RLS for a 178000→12ms speedup." The benchmark was real but applied to `has_role()` (a SECURITY DEFINER function with a table join), not to `auth.uid()`. The technique still helps for expensive sub-queries, but not magically.
- ❌ "Vercel issues individual SSL for every subdomain automatically." Only wildcard SSL (one level) is automatic. `a.b.acme.com` requires explicit domain add.
- ❌ "Vercel provides unlimited custom domains." Hobby caps at 50; Pro/Enterprise are "unlimited" with soft limits of 100k/1M per project.

---

## Trade-offs

| Decision | Why | When to revisit |
|----------|-----|-----------------|
| Workspace as path (`/w/:slug`) not subdomain | Wildcard SSL is one level only | If customers want branded URLs per workspace |
| Shared schema + RLS | Cheapest, scales to ~10k tenants on a single Supabase project | If compliance mandates DB-per-tenant |
| Magic-link only | Simplest auth; no password storage | If you need password + 2FA / SSO |
| Workspace = data boundary | Agency-friendly | If your orgs don't sub-divide, just use company-level RLS |
| Node runtime for everything | DB access, native modules, full Next.js feature set | If you build a DB-free latency-critical service |

---

## See also

- [AUTH.md](AUTH.md) — full magic-link flow with sequence diagrams.
- [RLS.md](RLS.md) — recipe for adding a new tenant-scoped table.
- [TENANCY.md](TENANCY.md) — when to use Company vs Workspace as the data boundary.
- [DEPLOY.md](DEPLOY.md) — Vercel + DNS + wildcard subdomain setup.
- [ENV.md](ENV.md) — every env var and its effect.