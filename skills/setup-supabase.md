<!--
setup-supabase.md — Vendor-neutral skill for extending
scripts/setup-supabase.ts. Any AI agent that wants to add a phase to the
setup flow reads this first.

The skill describes the conventions of the script, not any specific
tool. Agents modify the script using their normal file-editing tools.
-->

# Skill: Modify scripts/setup-supabase.ts

## Pre-flight

1. Read `AGENTS.md` (rules apply here too — especially § 3 file headers).
2. Read `scripts/setup-supabase.ts` end-to-end. It is 350+ lines but
   organized into clear sections marked with `// ====...` headers.
3. If you are adding a NEW PHASE: also read this file fully and check
   `PHASES` (the array near the top).

## What the script does

`scripts/setup-supabase.ts` orchestrates the multi-step process of
setting up a Supabase project for this template:

1. Validate required env vars (`SUPABASE_PROJECT_REF`,
   `SUPABASE_ACCESS_TOKEN`).
2. Link the local repo to the remote Supabase project.
3. Push SQL migrations to the remote database.
4. Verify the `custom_access_token_hook` is enabled and pointed at the
   right function.
5. Sync the auth config (`site_url`, `additional_redirect_urls`).
6. Optionally apply `supabase/seed.sql`.

It supports three modes:

- **dry-run (default)** — prints what it would do, no mutations.
- **`--check-only`** — read-only inspection of the remote project state.
- **`--apply`** — actually mutate (with optional `--yes` to skip prompts).

## When NOT to use this skill

- You're fixing a typo or improving comments. Just edit the file.
- You're adding a NEW COMMAND to package.json that doesn't fit the
  existing phase model. Edit package.json directly.
- You're adding a hook script that runs AFTER setup (e.g. a CI check).
  Create a separate script under `scripts/` and wire it in CI.

## Adding a new phase

When you add a phase to the script, follow these conventions exactly
so future contributors (human and agent) recognize the pattern.

### Step 1 — Add to the `Phase` type and `PHASES` array

```ts
type Phase = "link" | "push" | "hook" | "auth" | "seed" | "<your-phase>";

const PHASES: Phase[] = ["link", "push", "hook", "auth", "seed", "<your-phase>"];
```

Order matters: `PHASES` is the canonical execution order. Insert your
phase where it logically belongs.

### Step 2 — Write the phase function

Every phase has the same shape:

```ts
/**
 * <one-line description of what the phase does>.
 *
 * Reference for any API call:
 *   <link to Supabase docs>
 *
 * Side effects: <none / db / config / disk>.
 * Idempotent: <yes / no / "yes but slow; skip if cached marker exists">.
 */
async function phase<Name>(
  e: RequiredEnv,
  opts: CliOptions,
): Promise<boolean> {
  const phaseName = "<name>";

  // 1. Compute the work: read files, build payloads, etc.
  //    No I/O against Supabase yet.

  // 2. Handle the three modes.

  if (opts.checkOnly) {
    info(`[check-only] would <describe what would happen>`);
    return true;
  }

  if (!opts.apply) {
    // Dry-run: print exactly what would run, but don't execute.
    dry(phaseName, `<command or curl>`);
    // If the dry-run output includes a JSON body, pretty-print it indented:
    console.log(
      JSON.stringify(body, null, 2)
        .split("\n")
        .map((l) => "        " + l)
        .join("\n"),
    );
    return true;
  }

  // --apply mode: confirm with the user unless --yes.
  if (!(await confirm(phaseName, `<single-sentence user-facing prompt>?`))) {
    warn(phaseName, "skipped by user");
    return true;
  }

  // Execute the work.
  step(phaseName, `<one-line summary of what's running>`);
  const success = await <call the supabase CLI / Management API>;
  if (success) ok(phaseName, "<success message>");
  else err(phaseName, "<failure message>");
  return success;
}
```

Use the existing helpers (`step`, `ok`, `info`, `warn`, `err`, `dry`,
`runCommand`, `confirm`, `managementApi`). Do not introduce new logging
or HTTP helpers — the existing ones are agent-parseable.

### Step 3 — Wire it into `main()`

In the `main()` function, add:

```ts
if (phasesToRun.has("<your-phase>")) {
  results.<your-phase> = await phase<Name>(required, opts);
}
```

Also add `results.<your-phase>: true` to the `results` object initializer.

### Step 4 — Update help text and Phase summary

In `printHelp()`, list the phase in the `--phase=NAME` description.

In `main()`'s summary loop, the existing code already iterates `PHASES`,
so you don't need to touch it — just make sure your phase is in
`PHASES`.

### Step 5 — Add a script alias to package.json (optional)

If the phase is commonly run on its own, add a script:

```json
"setup:supabase:<phase>": "tsx scripts/setup-supabase.ts --phase=<phase>"
```

Skip this if the phase doesn't make sense to run in isolation.

## Style rules (strict)

- **No `any`.** Type the parameters and returns precisely.
- **Top-of-file JSDoc** if you change the overall script structure.
  Otherwise, the phase function's own JSDoc is enough.
- **No `console.log` for status.** Use `step` / `ok` / `info` / `warn` /
  `err` / `dry` so the prefix-based grep pattern works.
- **User-facing prompts in `confirm()`** must be a single sentence
  ending with `?`. They are shown verbatim to a human.
- **Side effects must be in `--apply` mode only.** Read-only inspection
  is allowed in `--check-only` mode. Anything else must be gated.
- **Failure paths return `false`, never throw.** `main()` collects
  booleans and decides whether to exit 1.

## Anti-patterns (never)

- ❌ Adding a `process.exit()` inside a phase function. The runner in
  `main()` owns exit codes.
- ❌ `console.log("✅ done!")` — emoji + ad-hoc strings break the grep
  pattern. Use `ok(phaseName, "done.")`.
- ❌ Spinning up a new HTTP client. Reuse `managementApi()`.
- ❌ Reading env vars directly with `process.env.X` outside
  `loadRequiredEnv()`. Add a new var to the loader.
- ❌ Making the script interactive with rich prompts (inquirer, prompts,
  etc.). The script must run unattended in CI. The single
  `confirm(phase, msg)` is the only interactive primitive.

## VERIFY

After modifying the script:

- [ ] `pnpm setup:supabase` (no flags) → runs in dry-run mode, prints
      every phase, no mutations.
- [ ] `pnpm setup:supabase:check` → reports current state without
      attempting any change.
- [ ] `pnpm setup:supabase:apply --phase=<your-phase>` (with a project
      where you control the outcome) → runs only your phase and
      succeeds.
- [ ] `pnpm typecheck` → exits 0.
- [ ] The skill's `Pre-flight` section still matches the file's
      current shape (update the skill if you reorganize sections).

## Rollback

If a phase change has shipped and is causing problems, you can revert
the file to a known-good commit. The script is the canonical setup
entry point; nothing else in the codebase depends on its internals.

If you need to disable a phase without deleting it (e.g. a phase that's
broken on the current Supabase version), comment out its call in
`main()` and update this skill accordingly.