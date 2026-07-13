# Authentication

Magic-link sign-in flow, end-to-end. For the why and trade-offs, see
[ARCHITECTURE.md](ARCHITECTURE.md).

## Flow

```
┌──────────┐      ┌─────────┐      ┌─────────┐       ┌──────────┐
│ Browser  │      │ Next.js │      │Supabase │       │ Postgres │
└────┬─────┘      └────┬────┘      └────┬────┘       └────┬─────┘
     │  1. POST /api/auth/request-link  │                   │
     │     { email: "jane@acme.com" }   │                   │
     ├────────────────────►│            │                   │
     │                     │  2. signInWithOtp           │
     │                     ├───────────►│                   │
     │                     │            │  3. INSERT users │
     │                     │            ├──────────────────►│
     │                     │            │◄──────────────────┤
     │                     │            │  4. trigger      │
     │                     │            │     handle_new_user│
     │                     │            │     INSERT profile│
     │                     │            │                   │
     │                     │            │  5. send email    │
     │                     │            ├────►[Email]        │
     │                     │            │                   │
     │  6. { ok: true }    │            │                   │
     │◄────────────────────┤            │                   │
     │                     │            │                   │
     │  [user clicks link] │            │                   │
     │                     │            │                   │
     │  7. GET /auth/callback?code=…    │                   │
     ├────────────────────►│            │                   │
     │                     │ 8. exchangeCodeForSession     │
     │                     ├───────────►│                   │
     │                     │            │  9. INSERT session│
     │                     │            │     + custom_access_token_hook
     │                     │            ├──────────────────►│
     │                     │            │◄──────────────────┤
     │                     │            │ 10. JWT stamped  │
     │                     │            │     with memberships
     │                     │            │                   │
     │                     │ 11. Set-Cookie: sb-…           │
     │                     │◄───────────┤                   │
     │  12. 302 → /w/<ws>/dashboard      │                   │
     │◄────────────────────┤            │                   │
     │                     │            │                   │
     │  13. GET /w/.../dashboard        │                   │
     ├────────────────────►│            │                   │
     │                     │ 14. Read cookies             │
     │                     │     getClaims() validates JWT │
     │                     │            │                   │
     │                     │ 15. Query (RLS via JWT)      │
     │                     ├───────────►│                   │
     │                     │            │ 16. RLS policy   │
     │                     │            │     uses auth.jwt()│
     │                     │            │     -> app_metadata│
     │                     │            │◄──────────────────┤
     │  17. Page           │            │                   │
     │◄────────────────────┤            │                   │
```

## Where each piece lives

| Step | File |
|------|------|
| 1–2   | `app/(auth)/login/LoginForm.tsx` (client) → `app/api/auth/request-link/route.ts` |
| 3–6   | Supabase Auth (managed) |
| 7–12  | `app/auth/callback/route.ts` |
| 13–17 | `proxy.ts` + `app/(tenant)/layout.tsx` + pages |

## Sessions and the proxy

Every protected request hits `proxy.ts` first. There:

1. The Supabase server client reads cookies from the request.
2. `supabase.auth.getClaims()` validates the JWT against Supabase's
   published public keys. If the token is expired or near-expiry, the
   library transparently refreshes it and writes new cookies via `setAll`.
3. We inject `x-company-id`, `x-workspace-id`, `x-user-id` into request
   headers so downstream RSC code can read them without re-parsing.
4. We apply `Cache-Control: no-store` to the response so Vercel's CDN
   never serves one user's HTML to another user.

## Switching workspaces

`POST /api/me/switch-workspace { workspaceId }` does:

1. Reads the caller's session via `getActiveContext()`.
2. Validates the requested workspace exists and the user is a member.
3. Uses the **service role** client to call `auth.admin.updateUserById`
   with new `app_metadata.active_*` fields. Regular users can't write
   their own `app_metadata` (that's a security control), so we go
   through the admin API.
4. Calls `supabase.auth.refreshSession()` so the user's next request
   already sees the new active workspace (no waiting for natural refresh).
5. Returns `{ ok: true, data: { workspace, role } }`.

The browser then navigates to `/w/<slug>/dashboard`, where `proxy.ts`
re-runs and confirms the new workspace belongs to the current company.

## What you typically need to add for production

### Email templates

`supabase/config.toml` references `./supabase/templates/magic_link.html`.
Create that file with your brand styling. Supabase merges `{{ .SiteURL }}`
and `{{ .ConfirmationURL }}` placeholders.

### Rate limiting

`/api/auth/request-link` returns a `warn()` when Supabase rate-limits the
email send (429). For brute-force protection at the route level, add a
Vercel WAF rule or a token-bucket in `proxy.ts`. The template intentionally
leaves this open so it's easy to fork.

### Forced logout

If you ever need to invalidate all sessions for a user (compromised account,
role change), bump their `app_metadata.token_version`. The hook (see
`0003_auth_hook.sql`) stamps it into the JWT; you can add a check to
`getClaims()` that compares against the latest version. Out of scope for
the template — see Supabase docs on "force logout".

### New users without memberships

When a brand-new user signs in, they have no memberships yet. The callback
redirects them to `/onboarding`. The template doesn't implement that page;
forks typically add a "create or join a company" form here.

### audit log

Add a `public.audit_events` table with `user_id`, `company_id`, `event`,
`created_at`. RLS: only admins see them. Insert from server actions using
`auth.uid()` and `current_company_id()`. Documented as a pattern; not
included in the template.