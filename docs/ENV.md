# Environment Variables

Every variable the template reads, what it does, and what happens if you
get it wrong. All variables are validated at boot by `lib/env.ts` — bad
config crashes the process with a clear message instead of failing
silently later.

## Public variables (exposed to the browser)

These are bundled into client-side JavaScript. **Never put secrets here.**

### `NEXT_PUBLIC_SUPABASE_URL`

- **Required.** The URL of your Supabase project.
- Local dev: `http://127.0.0.1:54321` (default for `supabase start`).
- Production: `https://<your-project-ref>.supabase.co`.
- **If wrong**: build succeeds; first Supabase call from the browser fails
  with a network error.

### `NEXT_PUBLIC_SUPABASE_ANON_KEY`

- **Required.** The anonymous / publishable key.
- Locally: visible in `supabase status` output.
- In production: Supabase Dashboard → Settings → API.
- **If wrong**: build succeeds; auth calls fail with "Invalid API key".

### `NEXT_PUBLIC_ROOT_DOMAIN`

- **Required.** The root domain of your platform, **without protocol**.
- Local: `tuapp.local`
- Production: `tuapp.com`
- Used by `lib/tenant/host.ts` to extract the subdomain from the Host
  header. If you set this wrong, every subdomain resolution returns null
  and the app falls back to apex behavior.

### `NEXT_PUBLIC_APP_SCHEME`

- **Required.** `http` or `https`. Defaults to `https` if unset.
- Local dev: `http` (unless you've set up local HTTPS, which is rare).
- Production: `https`.
- Used to build absolute URLs for the magic-link `emailRedirectTo` and
  post-login redirects.

## Server-only variables (NEVER exposed to the browser)

### `SUPABASE_SERVICE_ROLE_KEY`

- **Required.** The service role key.
- **DANGER**: bypasses all RLS. Treat as a master password.
- Used by:
  - `app/(tenant)/api/me/switch-workspace/route.ts` (admin user update)
  - `lib/supabase/service.ts` (importable anywhere server-side)
- **If wrong**: requests that hit the service client fail with "Invalid
  API key" at runtime. The `lib/env.ts` check passes (it only validates
  format, not key correctness).
- **If leaked**: rotate it immediately in Supabase Dashboard → Settings
  → API. Then redeploy with the new value.

## Variables we deliberately don't use

- `NEXT_PUBLIC_SITE_URL` — Supabase manages this through its dashboard.
  The template doesn't depend on it.
- Any analytics / observability key — out of scope. Forks should add
  their own (Vercel Analytics, Sentry, etc.) without touching the core
  template.

## Local vs production

A common pattern:

```bash
# .env.local (development)
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<from supabase status>"
SUPABASE_SERVICE_ROLE_KEY="<from supabase status>"
NEXT_PUBLIC_ROOT_DOMAIN="tuapp.local"
NEXT_PUBLIC_APP_SCHEME="http"
```

```bash
# Vercel environment variables (production)
NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
SUPABASE_SERVICE_ROLE_KEY="<service role key>"  # marked Sensitive
NEXT_PUBLIC_ROOT_DOMAIN="tuapp.com"
NEXT_PUBLIC_APP_SCHEME="https"
```

You can set per-environment overrides in Vercel (Production, Preview,
Development). The template doesn't care which you use; env validation is
the same shape.

## Setup-script-only variables

These are read only by `scripts/setup-supabase.ts` and have no effect on
the running app. Leave them unset if you're not running the setup script.

### `SUPABASE_PROJECT_REF`

- **Required only by `pnpm setup:supabase*`**.
- The project ID (the `abcdefghij` slug from
  `https://supabase.com/dashboard/project/abcdefghij`).
- **If wrong**: the setup script exits with code 3 before doing anything.

### `SUPABASE_ACCESS_TOKEN`

- **Required only by `pnpm setup:supabase*`**.
- A Personal Access Token from
  https://supabase.com/dashboard/account/tokens.
- **NOT the same as the service role key.** A PAT is broader (can manage
  project settings, billing, etc.); the service role key is bounded to
  one project's database.
- **If leaked**: revoke it from the same dashboard and reissue.

## Vercel variables

These are read by `scripts/vercel-cli.ts` (locally) and the
`.github/workflows/deploy.yml` workflow (in CI). Leave unset if you're
not deploying via the CLI.

### `VERCEL_TOKEN`

- **Required by `pnpm vercel:*` and the deploy workflow.**
- A Personal Access Token from https://vercel.com/account/tokens.
- Scope: "Full Access" gives the agent / CI complete control over
  deploys, env vars, domains, logs, and project settings. "Limited
  Access" tokens can be scoped to specific teams and projects — prefer
  those when possible.
- **Treat as a secret.** If leaked: revoke from the same dashboard and
  reissue. Update the GitHub Actions secret AND the local `.env.local`.

### `VERCEL_ORG_ID`

- **Required for team deployments.** Optional for personal Hobby deploys
  (CLI will infer).
- Visible at the bottom of the project settings page, or run
  `vercel whoami` after `vercel login` to print the active team.
- Looks like `team_xxxxxxxxxxxxxxxx`.

### `VERCEL_PROJECT_ID`

- **Optional.** When set, removes ambiguity about which project the
  CLI targets. When unset, the CLI uses whichever project is linked
  under `.vercel/project.json` (created by `vercel link`).
- Visible in the URL: `https://vercel.com/<org>/<PROJECT_NAME>/...`.

## Verifying after a change

```bash
pnpm typecheck
pnpm build
```

Both will fail loudly if a variable is missing or malformed.