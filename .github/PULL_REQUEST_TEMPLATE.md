<!--
PULL_REQUEST_TEMPLATE.md — Aligned with AGENTS.md § 5 (Pre-commit
checklist). Anything not checked here WILL get caught in review, but
having the boxes here makes the cost of skipping them visible.
-->

## What

<!-- One or two sentences. -->

## Why

<!-- What problem does this solve? Link an issue if applicable. -->

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Docs
- [ ] Agent-facing (skill, llms.txt, registry.json)
- [ ] Other (describe)

## Affected areas

<!-- Check all that apply. Helps reviewers know where to look. -->

- [ ] SQL migrations (`supabase/migrations/`)
- [ ] RLS policies
- [ ] Server / API code (`app/`, `lib/`)
- [ ] Auth / session logic
- [ ] Frontend / UI
- [ ] Docs (`docs/`, `README.md`, `AGENTS.md`, `llms.txt`)
- [ ] Agent skills (`skills/`)
- [ ] Registry (`registry.json`, `components.json`)
- [ ] Setup script (`scripts/setup-supabase.ts`)
- [ ] Templates / GitHub metadata (`.github/`, `LICENSE`)

## Pre-commit checklist (mandatory — from AGENTS.md § 5)

- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] Every new tenant-scoped table has RLS enabled + 4 policies
      (select, insert, update, delete)
- [ ] Every new env var is in `.env.example` AND validated in `lib/env.ts`
- [ ] Every new documentation file is listed in `llms.txt`
- [ ] Used `@/lib`, `@/app`, `@/components`, `@/supabase`, `@/docs`, or
      `@/skills` aliases — no invented paths
- [ ] Followed naming conventions from `docs/CONVENTIONS.md`
- [ ] Every new Route Handler wraps with `withApi()` (cache headers + error mapping)
- [ ] No new `service_role` use without a "Justification for service_role"
      comment in the file AND an entry in `docs/RISKS.md`
- [ ] No edits to committed SQL migrations (only new ones)

## Manual verification

<!-- What did you run by hand? Paste output snippets if useful. -->

- [ ] `pnpm dev` starts cleanly
- [ ] `npx supabase db reset` succeeds
- [ ] Sign-in via magic link works end-to-end
- [ ] Switching workspace via `/settings` hides notes from the previous
      workspace (RLS)
- [ ] `curl -I` on an authenticated URL shows `Cache-Control: no-store`

## If this changes the agent-facing layer

- [ ] Added a skill under `skills/` and listed it in `llms.txt`
- [ ] Updated `docs/CONVENTIONS.md` or `AGENTS.md` if conventions changed
- [ ] Bumped `version` in `package.json` and added an entry to `CHANGELOG.md`
      with `schema_migrations:`, `breaking:`, `affects:` fields

## Docs

- [ ] Updated the relevant doc in `docs/` if behavior changed
- [ ] Updated `README.md` if the quickstart / setup changed

## Notes for reviewers

<!-- Anything reviewers should pay particular attention to. -->

