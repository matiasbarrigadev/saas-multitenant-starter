<!--
deploy-ci.md — Vendor-neutral skill for modifying .github/workflows/deploy.yml.

This skill describes the existing workflow and the rules that govern it.
It does NOT prescribe specific tooling — agents edit the YAML with their
normal file tools.
-->

# Skill: Modify .github/workflows/deploy.yml

## Pre-flight

1. Read `AGENTS.md` (rules apply here, especially § 1.4 about
   `Cache-Control: no-store`).
2. Read `.github/workflows/deploy.yml` end-to-end.
3. Read the GitHub Actions documentation for any operator you want to
   introduce (e.g. `actions/upload-artifact@v4`). The version pins in
   the existing file are deliberately conservative.

## What the workflow does

A single workflow `deploy.yml` with two jobs:

### `ci` — runs on every PR and push to `main`

1. Checkout.
2. Setup pnpm + Node 20.
3. `pnpm install --frozen-lockfile`.
4. `pnpm typecheck`.
5. `pnpm build` (with placeholder env vars so the build doesn't need
   real secrets at this stage).
6. No deploy from this job.

### `deploy` — needs `ci`, runs on every push to `main` (and on manual
`workflow_dispatch`)

1. Checkout + setup again (separate job, separate runner).
2. `pnpm install --frozen-lockfile` (vercel CLI is a devDep).
3. `vercel link` (uses `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`).
4. `vercel env pull .env.ci.local --environment=production`.
5. `vercel deploy --prod --yes` (or `vercel deploy` for preview on PR).
6. If this is a PR, comment the preview URL via
   `marocchino/sticky-pull-request-comment`.

### Triggers

- `push` to `main` → CI + production deploy.
- `pull_request` to `main` → CI + preview deploy + comment.
- `workflow_dispatch` → CI + manual deploy (choose `preview` or
  `production` via the input dropdown).

### Concurrency

The `concurrency` block cancels in-progress runs on the same branch.
**Don't remove it** — without it, two pushes in quick succession can
race and deploy in an unpredictable order.

### Required GitHub repository secrets

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
- Plus the same Next.js / Supabase env vars the project needs (the
  workflow reads them from Vercel via `vercel env pull`, not from
  GitHub secrets).

## When NOT to use this skill

- You want to switch to the Vercel GitHub App. That's a re-architecture;
  delete the workflow and uninstall the integration.
- You want to add a per-PR test database. That's outside the deploy
  scope; add it to a separate workflow (`ci.yml`).
- You want to add notifications (Slack, Discord, etc.). That's a
  third workflow (`notify.yml`) so this one stays focused on the
  critical path.

## Adding a new job

The workflow has two jobs (`ci`, `deploy`). To add a third:

### Step 1 — Decide the trigger

By default, new jobs run on every workflow invocation (push + PR +
manual). If you want to gate the new job:

```yaml
my-new-job:
  needs: ci    # depends on the existing ci job
  if: github.event_name == 'push'   # only on push, not PRs
  runs-on: ubuntu-latest
  timeout-minutes: 5
  steps:
    - uses: actions/checkout@v4
    - run: echo "new job"
```

### Step 2 — Permission hygiene

Each job has its own permission set (default inherits from
`permissions:` at the top of the file). Only request what the job
needs. The current top-level `permissions` block is the minimum needed
for both `ci` and `deploy`:

```yaml
permissions:
  contents: read
  pull-requests: write
```

If your new job needs more, scope them at the job level (not the
workflow level) so other jobs don't inherit them.

### Step 3 — Timeout discipline

Every job has `timeout-minutes`. GitHub Actions' default is 360 minutes
(six hours), which is wrong for a CI job. Always set an explicit,
small timeout:

- `ci`: 10 minutes is enough for typecheck + build.
- `deploy`: 15 minutes is enough for a Vercel deploy.
- New jobs: 5 minutes for simple scripts; 15 for ones that involve
  network calls.

### Step 4 — Cache discipline

Both `ci` and `deploy` use `actions/setup-node@v4` with
`cache: pnpm`. If you add a new job that runs `pnpm install`, include
the same cache. Without it, every run re-downloads all dependencies.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: pnpm
```

## Adding a new step inside an existing job

If you need to insert a step into `deploy` (say, send a Slack message
on failure):

1. Find the existing steps in `deploy.yml`.
2. Append your step at the bottom. Don't reorder — the `Pull Vercel
   environment` step MUST run before `Deploy to Vercel` (it populates
   `.env.ci.local` so the deploy's runtime has the right env).
3. If your step runs on failure only, use:

   ```yaml
   - name: Notify Slack on failure
     if: failure()
     run: ...
   ```

## Style rules

- **Pin action versions** (`@v4`, not `@main`). Unpinned actions
  change behavior silently and can break builds.
- **Pin Node + pnpm versions** at the top of each job that needs
  them. Don't assume the runner has the right defaults.
- **Don't print secrets.** Even in `set -x` style debug output, Vercel
  tokens and service-role keys must never appear in logs.
- **Don't run `pnpm dev`** in CI — it never exits.
- **`run:` blocks must be self-contained.** No `cd ..` and back; the
  job's `working-directory` (default: repo root) must be enough.

## Anti-patterns (never)

- ❌ Removing the `concurrency` block.
- ❌ Using `actions/checkout@main` (no version pin).
- ❌ Pasting the full Vercel token into the workflow file as an env
  literal. Use `secrets.X`.
- ❌ Adding `continue-on-error: true` to the deploy step.
- ❌ Adding a step that pushes to git (creates infinite loops with the
  workflow trigger).

## VERIFY

- [ ] Open `.github/workflows/deploy.yml` in GitHub's UI → "View raw"
      → confirm the YAML parses (no red squiggles, "Workflow file
      is valid").
- [ ] Push a test commit to a branch and check the Actions tab runs.
      If adding a new job, push to a draft PR to test the PR-only
      behavior first.
- [ ] Confirm the new job respects `concurrency` (test by pushing two
      commits in quick succession; the second should cancel the first).
- [ ] If the job uses new secrets, document them in
      `CONTRIBUTING.md` and `docs/DEPLOY.md`.

## Rollback

To disable a job temporarily:

```yaml
my-new-job:
  needs: ci
  if: false   # <-- add this to gate off without deleting the job
  runs-on: ubuntu-latest
  ...
```

To remove the workflow entirely, delete `.github/workflows/deploy.yml`
in a single commit. The Vercel GitHub App is NOT configured for this
repo (intentionally), so removing the workflow means deploys stop
until the workflow is restored.