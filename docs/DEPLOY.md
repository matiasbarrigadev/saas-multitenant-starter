# Deployment

Going from local dev to production on Vercel. Covers Vercel project setup,
DNS configuration, wildcard SSL, and the one-time database migration.

## Prerequisites

- A Vercel account (https://vercel.com).
- A Supabase project (https://supabase.com/dashboard).
- A domain you own (e.g. `tuapp.com`) plus access to its DNS records.

## 1. Supabase

### Create the project

1. Sign in to Supabase, click "New project".
2. Choose a region close to where you'll deploy on Vercel (e.g. `us-east-1`
   for Vercel's default `iad1`).
3. Save the database password somewhere safe.

### Apply migrations

From the project root, point the CLI at your remote project:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

This applies `supabase/migrations/*.sql` in order. After it finishes, the
helper functions and the auth hook are active.

### Set the auth hook URL

In Supabase Studio → Authentication → Hooks → "Custom Access Token Hook",
make sure it's enabled and pointed at `public.custom_access_token_hook`. The
migration enables it automatically, but verify.

### Configure the magic-link email

In Supabase Studio → Authentication → URL Configuration:

- Site URL: `https://acme.tuapp.com` (use your production root domain with
  any subdomain — Supabase only checks the host).
- Additional redirect URLs: include
  - `https://acme.tuapp.com/auth/callback`
  - `https://*.tuapp.com/auth/callback` (if you want to support multiple
    companies in one config)
  - `http://acme.tuapp.local:3000/auth/callback` (for local dev)

If you customize the email template, see [AUTH.md](AUTH.md).

## 2. Vercel

### Create the project

```bash
npx vercel link
```

Or via the dashboard: "Add New Project" → "Import Git Repository".

### Environment variables

In Vercel → Project Settings → Environment Variables, add:

- `NEXT_PUBLIC_SUPABASE_URL` — your project's API URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the `anon` / `publishable` key
- `SUPABASE_SERVICE_ROLE_KEY` — the `service_role` key (mark as Sensitive)
- `NEXT_PUBLIC_ROOT_DOMAIN` — e.g. `tuapp.com`
- `NEXT_PUBLIC_APP_SCHEME` — `https`

These are read at build time by `lib/env.ts`. If you forget one, the
build fails fast with a clear error.

### Region

Vercel → Project Settings → Functions → set "Function Region" to match
your Supabase project's region. This is the single biggest latency
lever you control.

## 3. Domain & wildcard SSL

This is the step most people get wrong. Vercel **requires you to delegate
your apex domain's nameservers** before it can issue a wildcard
certificate.

### Steps

1. **Delegate NS to Vercel.** At your DNS registrar, change the nameservers
   for `tuapp.com` to:
   ```
   ns1.vercel-dns.com
   ns2.vercel-dns.com
   ```
   Propagation takes up to 48 hours.

2. **Add the apex domain to Vercel.** In Vercel → Project Settings →
   Domains, add `tuapp.com`. Vercel will issue a Let's Encrypt certificate
   for the apex.

3. **Add the wildcard.** Add `*.tuapp.com` as a domain. Vercel will only
   issue a wildcard cert if the NS is delegated (step 1) — otherwise the
   add fails with a clear message. DNS-01 challenges happen under the
   hood.

4. **Verify.** Run `dig NS tuapp.com` from your terminal; you should see
   the Vercel nameservers. Then visit `https://acme.tuapp.com` (after
   pointing your client at it). The certificate should be valid for both
   `tuapp.com` and `*.tuapp.com`.

### What does NOT work

- ❌ Multi-level wildcards: `*.*.tuapp.com` is not supported. This is why
  the template uses `/w/<slug>` for workspaces — they're path-based, not
  subdomain-based.
- ❌ Wildcard CNAMEs to `cname.vercel-dns.com`: the wildcard cert requires
  NS delegation. (You can still use CNAMEs for individual subdomains.)
- ❌ Custom domains per workspace with wildcards: each would need its own
  certificate. If you want `marketing.acme.tuapp.com` to resolve as a
  workspace URL, you'd need to add it explicitly per workspace per
  company. Out of scope for the template.

## 4. First deploy

```bash
git push
```

Vercel builds and deploys automatically. Watch the build logs for the
env validation to pass (a missing env var will show up as a clear error
from `lib/env.ts`).

## 5. Post-deploy verification

After the first successful deploy:

- [ ] Visit `https://tuapp.com` → landing page renders.
- [ ] Sign in via magic link → check inbox (Supabase logs the email
      delivery under "Auth → Logs").
- [ ] Click the link → lands on `https://<your-company>.tuapp.com/w/<slug>/dashboard`.
- [ ] `curl -I https://acme.tuapp.com/w/marketing/dashboard` returns
      `Cache-Control: no-store`.
- [ ] DevTools → Network → click any authenticated request → response
      shows `no-store` and `Set-Cookie: ...`.

## Local dev quickstart

For local development, you don't need DNS delegation or wildcard SSL:

1. Edit `/etc/hosts` (or `C:\Windows\System32\drivers\etc\hosts`):
   ```
   127.0.0.1 acme.tuapp.local
   ```
2. Start Supabase:
   ```bash
   npx supabase start
   ```
3. Run the dev server:
   ```bash
   pnpm dev
   ```
4. Open `http://acme.tuapp.local:3000`.

For testing multiple companies locally, add more `/etc/hosts` entries:
```
127.0.0.1 acme.tuapp.local
127.0.0.1 globex.tuapp.local
```

You can create the second company either through the Supabase Studio or by
adding it to `supabase/seed.sql`.