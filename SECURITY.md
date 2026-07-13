# Security policy

This template ships with sensible defaults but **you are responsible
for hardening it before production use.** Treat anything in this repo as
a starting point, not a finished security audit.

## Supported versions

The latest minor version on `main` is the only supported line. Older
versions receive best-effort fixes for severe issues only.

## Reporting a vulnerability

**Do not open a public GitHub issue for security findings.** Use one of
the channels below:

- **GitHub Security Advisories** (preferred): click "Report a
  vulnerability" on the Security tab of the repo. This routes the
  report privately to maintainers.
- **Email**: see the GitHub profile of the project owner for the
  contact address.

Please include:

- A clear description of the issue and its impact.
- Reproduction steps (or a proof-of-concept).
- The commit / version where you found it.

We aim to acknowledge reports within **3 business days** and ship a
fix within **30 days** for severity ≥ high. We'll coordinate disclosure
timing with you.

## What we will NOT consider vulnerabilities

The following are intentional design choices documented elsewhere in the
template. Please read before filing:

- **Multi-tenant data isolation is the user's responsibility to
  maintain.** This template ships RLS enabled on every tenant-scoped
  table, but if you add a new table without RLS, you've broken the
  isolation model. That's not a template bug — that's a usage bug.
  See [`AGENTS.md` § 1.1](AGENTS.md) and [`docs/RLS.md`](docs/RLS.md).
- **JWT staleness after a role change** is a known limitation. See
  [`docs/RISKS.md` R4](docs/RISKS.md) and [`docs/AUTH.md`](docs/AUTH.md).
- **`Cache-Control` headers must remain `no-store` on authenticated
  responses.** If you remove them, you have introduced a cross-tenant
  leak. See [`AGENTS.md` § 1.3](AGENTS.md) and [`docs/RISKS.md` R1](docs/RISKS.md).

## Hardening checklist before going to production

These are the things the template does NOT do for you — you must do them
yourself:

- [ ] Set Vercel environment variables to use **Production** environment,
      not Preview.
- [ ] Verify the Supabase service role key is **only** in server-only env
      vars (no `NEXT_PUBLIC_` prefix). Run `pnpm typecheck` after any
      change — the type system catches accidental leaks.
- [ ] Configure custom SMTP for transactional email (magic links,
      invites). Supabase's default SMTP has rate limits that don't fit
      real production.
- [ ] Enable MFA for your Supabase account and your Vercel account.
- [ ] Review your DNS: wildcard subdomain on Vercel requires delegating
      NS to `ns1/ns2.vercel-dns.com`. See [`docs/DEPLOY.md`](docs/DEPLOY.md).
- [ ] Add rate limiting on `/api/auth/request-link` (e.g. via Vercel
      WAF or a custom middleware). The template currently only surfaces
      Supabase's rate limit as a warning.
- [ ] Audit your `service_role` uses in [`docs/RISKS.md`](docs/RISKS.md).
      Each one is a potential RLS bypass.
- [ ] Run a security review of any code you added on top of this
      template.

## Hall of fame

<!-- A future addition. Maintainers can recognize reporters here with their consent. -->

Thank you for keeping the template safe.