# Contributing

Thanks for considering a contribution. This document covers the
mechanics — what to file where, what to expect from review, and how to
run the project locally. For the **why** of any rule, see
[`AGENTS.md`](AGENTS.md) and [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

## Quick links

- [Code of conduct](#code-of-conduct)
- [Reporting a bug](#reporting-a-bug)
- [Suggesting a feature](#suggesting-a-feature)
- [Submitting a pull request](#submitting-a-pull-request)
- [Development setup](#development-setup)
- [Coding conventions](#coding-conventions)

## Code of conduct

Be kind. Assume good faith. Critique code, not people. The standard
[Contributor Covenant](https://www.contributor-covenant.org/) applies.

## Reporting a bug

Open an issue using the **Bug report** template. Fill in the
reproduction steps and the expected vs. actual behavior. If you can
paste the relevant logs, that shortens the fix cycle dramatically.

## Suggesting a feature

Open an issue using the **Feature request** template. Lead with the use
case — who is affected and what scenario does this unblock — and only
then describe the proposed solution. If your feature doesn't fit the
template's purpose (a vendored-neutral, agent-friendly starter), say so
in the proposal and we'll figure out a home for it.

## Submitting a pull request

1. Fork the repo and create a branch from `main`.
2. Make your changes.
3. Fill in the PR template (it shows up automatically). All pre-commit
   boxes should be checked.
4. Wait for CI to pass and for review.
5. Once approved, a maintainer will merge.

For the rules every PR must follow, see
[`AGENTS.md` § 5 — Pre-commit checklist](AGENTS.md) and the PR template
itself. Anything unchecked there will be sent back for revision.

## Development setup

```bash
git clone <your-fork>
cd multitenant-template

# Install deps.
pnpm install

# Start local Supabase (requires Docker).
npx supabase start

# Copy env template and fill in the values from `supabase status`.
cp .env.example .env.local

# Apply migrations and seed.
npx supabase db reset

# Optional: edit /etc/hosts so the subdomain works.
echo "127.0.0.1 acme.tuapp.local" | sudo tee -a /etc/hosts

# Start the dev server.
pnpm dev
```

Open <http://acme.tuapp.local:3000/login>. See
[`README.md` — Quickstart](README.md) for the full flow.

## Coding conventions

This is a template — consistency matters more than taste. The canonical
source of truth is [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).
Highlights:

- SQL: `snake_case` tables/columns, `NNNN_description.sql` migrations.
- TypeScript: `kebab-case` files, `PascalCase` components, `camelCase`
  variables. No `any`.
- Imports: use the path aliases (`@/lib`, `@/app`, `@/components`, etc.)
  — never invent relative paths.
- Every file starts with a JSDoc header explaining purpose.
- API responses go through `withApi()` + `ok`/`warn`/`err`.

If you add a new convention (e.g. a new path alias), update
`docs/CONVENTIONS.md`, `tsconfig.json`, `components.json`, and `llms.txt`
in the same PR.

## When you change the agent-facing layer

This template is consumed by AI agents. They read `AGENTS.md`,
`docs/CONVENTIONS.md`, `llms.txt`, and the `skills/` files. When you
change any of those, agents need to know:

- **New skill**: add the file under `skills/`, then add it to `llms.txt`
  (under "Agent-facing recipes") and to this CONTRIBUTING file's "Quick
  links".
- **New convention**: edit `docs/CONVENTIONS.md` and add a one-line
  summary to `AGENTS.md`. If it's a hard rule, add it to
  `AGENTS.md` § 1.
- **New doc file**: add it to `llms.txt` (and optionally `llms-ctx.txt`
  if it's not Optional / droppable).
- **New registry item**: update `registry.json`.

For changes to `scripts/setup-supabase.ts`, follow
[`skills/setup-supabase.md`](skills/setup-supabase.md).

## Review process

- One maintainer review is required.
- A second review is required for changes to `supabase/migrations/`,
  `lib/supabase/service.ts`, `proxy.ts`, or any `service_role` use.
- CI runs `pnpm typecheck`, `pnpm build`, and `pnpm lint`. All must pass.
- Reviewers will check the PR template boxes. Anything unchecked is
  grounds for "changes requested".

## Release process

Maintainers cut a release by:

1. Bumping `version` in `package.json`.
2. Adding a `CHANGELOG.md` entry with `schema_migrations:`, `breaking:`,
   and `affects:` fields.
3. Tagging the commit (`git tag v0.X.Y`).
4. Publishing release notes.

Contributors don't need to do this — a maintainer handles it after a
non-trivial change ships.

## CI/CD and secrets

This template ships its own deploy pipeline in
`.github/workflows/deploy.yml`. It uses the Vercel CLI directly instead
of the Vercel GitHub App, so programmatic control stays available.

Required GitHub repository secrets (Settings → Secrets and variables
→ Actions → Repository secrets):

| Secret | Required for | Get it from |
|---|---|---|
| `VERCEL_TOKEN` | Deploys + local CLI + CI | <https://vercel.com/account/tokens> |
| `VERCEL_ORG_ID` | Team deploys | Vercel dashboard, project settings |
| `VERCEL_PROJECT_ID` | Optional but recommended | Vercel dashboard URL |

Plus the same `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
etc. that the app needs at runtime — these get pulled into CI via
`vercel env pull`, not stored as GitHub secrets.

For local usage of the same operations, use the npm scripts under
`vercel:` (see [README.md](README.md) → "Deploy to production").

## License

By contributing, you agree that your contributions will be licensed
under the MIT License — the same license as the rest of the project.
See [`LICENSE`](LICENSE).