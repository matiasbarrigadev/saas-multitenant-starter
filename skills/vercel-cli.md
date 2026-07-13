<!--
vercel-cli.md — Vendor-neutral skill for extending scripts/vercel-cli.ts.

Same conventions as scripts/setup-supabase.ts, with subcommands instead
of phases. Any AI agent that wants to add a new subcommand reads this
first.
-->

# Skill: Modify scripts/vercel-cli.ts

## Pre-flight

1. Read `AGENTS.md` (rules apply here).
2. Read `scripts/vercel-cli.ts` end-to-end. ~670 lines organized into
   clear sections marked with `// ====...` headers.
3. Read `skills/setup-supabase.md` first — `vercel-cli.ts` follows the
   same shape. Reuse the same conventions (helpers, dry-run mode,
   --apply / --yes / --check-only semantics).

## What the script does

`scripts/vercel-cli.ts` is a thin wrapper around the `vercel` CLI.
Each subcommand maps to one CLI invocation, with:

- Dry-run output that prints the exact command it would run.
- A read-only `--check-only` variant when applicable.
- An `--apply` mode that prompts unless `--yes` is set.
- Output streamed via `runCommand()` (no custom parsing of `vercel`
  output).

### Subcommands today

| Subcommand | CLI command |
|---|---|
| `link` | `vercel link --yes --token $TOK [--scope $ORG] [--project $PROJ]` |
| `env list` | `vercel env ls <environment> --token $TOK` |
| `env pull [path]` | `vercel env pull <path> --environment <env> --token $TOK --yes` |
| `env push` | `vercel env push <file> --environment <env> --token $TOK --yes` |
| `domains list` | `vercel domains ls --token $TOK` |
| `domains add <d>` | `vercel domains add <d> --token $TOK --yes` |
| `domains rm <d>` | `vercel domains rm <d> --token $TOK --yes` |
| `deploy` | `vercel deploy --yes` or `vercel deploy --prod --yes` |
| `deployments list` | `vercel ls --limit N --token $TOK` |
| `inspect <id\|latest>` | `vercel inspect <id> --token $TOK` |

## When NOT to use this skill

- You need to call the Vercel REST API directly, not the CLI. The
  script's helpers (`managementApi` in setup-supabase.ts is a starting
  point) only cover Supabase. If you want a Vercel REST wrapper, this
  skill only addresses adding CLI subcommands — for REST, open a new
  file and add a parallel skill.
- You're changing how the CLI itself is invoked across the project.
  That's a refactor; do it as a single PR with multiple file edits.

## Adding a new subcommand

When you add a subcommand to the script, follow these conventions
exactly so future contributors recognize the pattern.

### Step 1 — Add to the `Subcommand` type and `SUBCOMMANDS` array

```ts
type Subcommand =
  | "link" | "env" | "domains" | "deploy" | "deployments" | "inspect"
  | "<your-subcommand>";

const SUBCOMMANDS: Subcommand[] = [
  "link", "env", "domains", "deploy", "deployments", "inspect",
  "<your-subcommand>",
];
```

Insert alphabetically or in execution order — pick one and stay
consistent. The CLI doesn't care about the order.

### Step 2 — Write the dispatcher function

```ts
async function subcommand<Name>(
  e: RequiredEnv,
  opts: CliOptions,
): Promise<boolean> {
  const phaseName = "<name>"; // used as the log prefix
  const action = opts.args[0] ?? "help";

  // If your subcommand has actions (like `env list` / `env pull`):
  switch (action) {
    case "list": return await <name>List(e, opts);
    case "pull": return await <name>Pull(e, opts);
    // ...
    default:
      err(phaseName, `Unknown <name> action: ${action}. Use: ...`);
      return false;
  }
}
```

### Step 3 — Write the action function(s)

Each action has the same shape:

```ts
async function <name>List(e: RequiredEnv, opts: CliOptions): Promise<boolean> {
  const phaseName = "<name>";
  const cmd = `vercel <...> --token ${e.token}`;

  // Read-only actions (list, inspect): allow --check-only and --apply.
  if (!opts.apply && !opts.checkOnly) {
    dry(phaseName, cmd);
    return true;
  }
  step(phaseName, cmd);
  return await runCommand(cmd);
}
```

For mutating actions (pull, push, add, rm, deploy):

```ts
async function <name>Add(e: RequiredEnv, opts: CliOptions): Promise<boolean> {
  const phaseName = "<name>";
  const arg = opts.args[1];
  if (!arg) {
    err(phaseName, "Usage: <name> add <argument>");
    return false;
  }

  const cmd = `vercel <...> ${arg} --token ${e.token} --yes`;

  if (opts.checkOnly) {
    info(`[check-only] would run: ${cmd}`);
    return true;
  }
  if (!opts.apply) {
    dry(phaseName, cmd);
    return true;
  }
  if (!(await confirm(phaseName, `Run: ${cmd}?`))) {
    warn(phaseName, "skipped by user");
    return true;
  }
  step(phaseName, cmd);
  return await runCommand(cmd);
}
```

### Step 4 — Wire into `main()`

```ts
case "<your-subcommand>": success = await subcommand<Name>(required, opts); break;
```

### Step 5 — Update help text

Add a line to `SUBCOMMANDS` documentation in `printHelp()`.

### Step 6 — Add a script alias to package.json (optional)

```json
"vercel:<name>": "tsx scripts/vercel-cli.ts <name>"
```

## Style rules (strict)

- **No `any`.** Type CLI args precisely.
- **No `console.log` for status.** Use `step` / `ok` / `info` / `warn` /
  `err` / `dry` — these compose with `setup-supabase.ts` so the user
  can grep across both scripts.
- **Reuse `runCommand` and `confirm`.** Don't introduce new helpers.
- **Tokens always come from `RequiredEnv.token`** — never read
  `process.env.VERCEL_TOKEN` directly outside `loadRequiredEnv()`.

## Anti-patterns (never)

- ❌ Spawning `vercel` with `shell: true` and passing unescaped user
  args. We shell-quote via template literals, but if you add a new
  argument, double-check it can't inject extra commands.
- ❌ Catching and swallowing `runCommand()` errors. If the command
  fails, the script should exit non-zero — that's how CI fails-fast.
- ❌ Adding a subcommand that writes to the filesystem in `--check-only`
  mode. `--check-only` is read-only by definition.
- ❌ Implementing custom JSON parsing of `vercel` output. Use
  `runCommandCapturing()` (already exists for `inspect latest`) only when
  strictly necessary; otherwise let the output stream to the user.

## VERIFY

- [ ] `pnpm vercel:<your-subcommand>` (no flags) → dry-run, prints
      the command(s) it WOULD run, exits 0.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm tsx scripts/vercel-cli.ts <your-subcommand> --help` lists
      your subcommand in the help output.
- [ ] If your subcommand is read-only: `pnpm tsx scripts/vercel-cli.ts
      <your-subcommand> --check-only` runs without prompting and
      exits 0.
- [ ] If your subcommand is mutating: `pnpm tsx scripts/vercel-cli.ts
      <your-subcommand> --apply` prompts once per action and exits
      cleanly on `n`.

## Rollback

To remove a subcommand:

1. Delete its function from `scripts/vercel-cli.ts`.
2. Remove the entry from `Subcommand` and `SUBCOMMANDS`.
3. Remove the line from `main()`'s switch.
4. Remove the help line and any package.json script entry.
5. Update `CHANGELOG.md` with a `breaking: true` entry.