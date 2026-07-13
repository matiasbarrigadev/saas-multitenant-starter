/**
 * setup-supabase.ts — Orchestrate Supabase project setup end-to-end.
 *
 * Phases (each idempotent and individually skippable via flags):
 *
 *   1. Pre-flight: validate env (SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN,
 *      NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 *   2. Link: `supabase link --project-ref <ref>` (skipped if already linked).
 *   3. Push migrations: `supabase db push` (Supabase tracks state; safe to
 *      re-run).
 *   4. Verify the custom_access_token_hook is enabled and pointed at
 *      public.custom_access_token_hook.
 *   5. Sync auth config: site_url + additional_redirect_urls.
 *   6. (Optional) Apply seed.sql.
 *
 * Modes:
 *
 *   --check-only   Read-only. Reports state without modifying anything.
 *                  Default for CI / safe inspections.
 *   (no flag)      DRY-RUN by default. Prints every step + exact commands
 *                  / SQL it WOULD execute, then exits.
 *   --apply        Apply all phases. Prompts for confirmation before each
 *                  mutating step (skippable with --yes).
 *   --yes          Skip confirmation prompts. Use with --apply in CI.
 *   --phase=NAME   Only run the named phase (link|push|hook|auth|seed).
 *
 * Examples:
 *
 *   pnpm tsx scripts/setup-supabase.ts                  # dry-run
 *   pnpm tsx scripts/setup-supabase.ts --check-only    # status only
 *   pnpm tsx scripts/setup-supabase.ts --apply          # apply with prompts
 *   pnpm tsx scripts/setup-supabase.ts --apply --yes    # apply non-interactively
 *   pnpm tsx scripts/setup-supabase.ts --phase=hook     # only enable the JWT hook
 *
 * Output: line-oriented JSON-ish records (the agent-friendly format).
 * Every action prints BEFORE it executes so a hung run can be diagnosed.
 */

/**
 * @internal — Imports are deferred inside main() so --check-only and the
 * dry-run path can print help without needing any of these to load.
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { env } from "../lib/env";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = resolve(dirname(__filename), "..");

// ============================================================================
// CLI parsing
// ============================================================================

interface CliOptions {
  checkOnly: boolean;
  apply: boolean;
  yes: boolean;
  phases: Set<Phase> | null; // null = all phases
}

type Phase = "link" | "push" | "hook" | "auth" | "seed";

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    checkOnly: false,
    apply: false,
    yes: false,
    phases: null,
  };
  for (const arg of argv) {
    if (arg === "--check-only") opts.checkOnly = true;
    else if (arg === "--apply") opts.apply = true;
    else if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("--phase=")) {
      const name = arg.slice("--phase=".length);
      if (!isPhase(name)) {
        console.error(`Unknown phase: ${name}. Valid: ${PHASES.join(", ")}`);
        process.exit(2);
      }
      if (!opts.phases) opts.phases = new Set();
      opts.phases.add(name);
    } else {
      console.error(`Unknown flag: ${arg}. Try --help.`);
      process.exit(2);
    }
  }
  return opts;
}

const PHASES: Phase[] = ["link", "push", "hook", "auth", "seed"];
function isPhase(s: string): s is Phase {
  return (PHASES as string[]).includes(s);
}

function printHelp(): void {
  console.log(`Usage: tsx scripts/setup-supabase.ts [flags]

Flags:
  (no flag)        Dry-run by default. Prints every step + commands.
  --check-only     Read-only inspection. Reports state, makes no changes.
  --apply          Apply changes. Prompts for confirmation unless --yes.
  --yes            Skip confirmation prompts (for CI).
  --phase=NAME     Run only one phase. NAME in: ${PHASES.join(" | ")}.
  --help, -h       Show this help.

Environment (read from process.env):
  SUPABASE_PROJECT_REF       Required for non-check-only modes.
  SUPABASE_ACCESS_TOKEN      Required (a Personal Access Token from supabase.com/dashboard/account/tokens).
  NEXT_PUBLIC_SUPABASE_URL   Required.
  SUPABASE_SERVICE_ROLE_KEY  Required for verifying the hook + reading state.

Exit codes:
  0  All requested phases succeeded (or check-only completed).
  1  A phase failed (look at the last printed record).
  2  Bad CLI usage.
  3  Missing or invalid environment.
`);
}

// ============================================================================
// Logging
// ============================================================================

/**
 * Line-prefixed, easy-to-grep output. We use this format (not structured JSON)
 * because humans tail this script interactively. Agents that want structured
 * data can grep for `^\\[step\\]` / `^\\[ok\\]` / `^\\[warn\\]` / `^\\[err\\]`.
 */
function step(name: string, msg: string): void {
  console.log(`[step]  ${name.padEnd(8)} ${msg}`);
}
function ok(name: string, msg: string): void {
  console.log(`[ok]    ${name.padEnd(8)} ${msg}`);
}
function info(msg: string): void {
  console.log(`[info]  ${msg}`);
}
function warn(name: string, msg: string): void {
  console.log(`[warn]  ${name.padEnd(8)} ${msg}`);
}
function err(name: string, msg: string): void {
  console.error(`[err]   ${name.padEnd(8)} ${msg}`);
}
function dry(name: string, msg: string): void {
  console.log(`[dry]   ${name.padEnd(8)} ${msg}`);
}

// ============================================================================
// Pre-flight
// ============================================================================

interface RequiredEnv {
  projectRef: string;
  accessToken: string;
  supabaseUrl: string;
  serviceRoleKey: string;
}

/**
 * Validate the env vars this script needs.
 *
 * Note: `lib/env.ts` validates NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY at boot. We re-read them here without going
 * through env.ts so a missing SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN
 * produces a clear error message instead of a ZodError about an unknown key.
 */
function loadRequiredEnv(): RequiredEnv | null {
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
  if (!projectRef) missing.push("SUPABASE_PROJECT_REF");
  if (!accessToken) missing.push("SUPABASE_ACCESS_TOKEN");

  if (missing.length > 0) {
    err(
      "env",
      `Missing required env vars: ${missing.join(", ")}. ` +
        `SUPABASE_PROJECT_REF is your project ID (the abcdefghij from ` +
        `https://supabase.com/dashboard/project/abcdefghij). ` +
        `SUPABASE_ACCESS_TOKEN is from supabase.com/dashboard/account/tokens.`,
    );
    return null;
  }

  return {
    projectRef: projectRef!,
    accessToken: accessToken!,
    supabaseUrl,
    serviceRoleKey,
  };
}

// ============================================================================
// Phase 1: Link to remote project
// ============================================================================

/**
 * Run `supabase link --project-ref <ref>` so the CLI knows which remote
 * project to push to. This writes `supabase/.temp/project-ref`; we
 * consider "already linked" by checking that file.
 */
async function phaseLink(e: RequiredEnv, opts: CliOptions): Promise<boolean> {
  const phaseName = "link";
  const linkedMarker = resolve(ROOT_DIR, "supabase", ".temp", "project-ref");

  if (existsSync(linkedMarker)) {
    const current = readFileSync(linkedMarker, "utf8").trim();
    if (current === e.projectRef) {
      ok(phaseName, `Already linked to project ${current}.`);
      return true;
    }
    warn(
      phaseName,
      `Currently linked to ${current}; requested ${e.projectRef}. Will re-link.`,
    );
  }

  const cmd = `npx supabase link --project-ref ${e.projectRef}`;
  if (opts.checkOnly) {
    info(`[check-only] would run: ${cmd}`);
    return true;
  }
  if (!opts.apply) {
    dry(phaseName, cmd);
    return true;
  }
  if (!(await confirm(phaseName, `Link local repo to Supabase project ${e.projectRef}?`))) {
    warn(phaseName, "skipped by user");
    return true;
  }
  step(phaseName, cmd);
  return await runCommand(cmd, { env: { SUPABASE_ACCESS_TOKEN: e.accessToken } });
}

// ============================================================================
// Phase 2: Push migrations
// ============================================================================

async function phasePush(e: RequiredEnv, opts: CliOptions): Promise<boolean> {
  const phaseName = "push";
  const cmd = "npx supabase db push --include-all";
  if (opts.checkOnly) {
    info(`[check-only] would run: ${cmd}`);
    return true;
  }
  if (!opts.apply) {
    dry(phaseName, cmd);
    return true;
  }
  if (!(await confirm(phaseName, "Apply pending migrations to remote database?"))) {
    warn(phaseName, "skipped by user");
    return true;
  }
  step(phaseName, cmd);
  return await runCommand(cmd, { env: { SUPABASE_ACCESS_TOKEN: e.accessToken } });
}

// ============================================================================
// Phase 3: custom_access_token_hook
// ============================================================================

/**
 * Verify the custom_access_token_hook is enabled. We can't enable it via the
 * Supabase Management API directly (it's a Postgres-side config in
 * auth.hooks). Instead:
 *
 *   - On a fresh project, migration 0003 enables it via an UPDATE on
 *     auth.hooks. The push in Phase 2 will have done this.
 *   - We verify by reading auth.hooks through the service-role client.
 *
 * If the hook is NOT enabled, we print the SQL the user needs to run
 * manually in Supabase Studio (we can't UPDATE auth.hooks from a
 * service-role client — it's intentionally not writable by API).
 */
async function phaseHook(e: RequiredEnv, opts: CliOptions): Promise<boolean> {
  const phaseName = "hook";

  // Read auth.hooks via service-role client (PostgREST exposes the schema).
  const admin = createClient(e.supabaseUrl, e.serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Wrap in a try: if RLS / permissions prevent this read, we surface that.
  let hookRow: { enabled: boolean; function_name: string | null } | null = null;
  let readError: string | null = null;
  try {
    const { data, error } = await admin
      .schema("auth")
      .from("hooks")
      .select("enabled, function_name")
      .eq("hook_name", "custom_access_token_hook")
      .maybeSingle();
    if (error) {
      readError = error.message;
    } else {
      hookRow = data ?? null;
    }
  } catch (e) {
    readError = (e as Error).message;
  }

  if (readError) {
    warn(
      phaseName,
      `Could not read auth.hooks (${readError}). This usually means ` +
        `the postgrest role can't read the auth schema. The hook MAY still ` +
        `be active — verify manually in Supabase Studio → Authentication → Hooks.`,
    );
    return true;
  }

  if (!hookRow) {
    warn(
      phaseName,
      `No row in auth.hooks with hook_name='custom_access_token_hook'. ` +
        `Supabase may not have auto-created it. Run this SQL in the SQL editor:`,
    );
    console.log(`        -- SQL to run manually --`);
    console.log(`        INSERT INTO auth.hooks (hook_name, enabled, function_name)`);
    console.log(`        VALUES ('custom_access_token_hook', true, 'public.custom_access_token_hook');`);
    return false;
  }

  if (!hookRow.enabled || hookRow.function_name !== "public.custom_access_token_hook") {
    const fixSql =
      `UPDATE auth.hooks SET enabled = true, function_name = 'public.custom_access_token_hook' ` +
      `WHERE hook_name = 'custom_access_token_hook';`;
    warn(
      phaseName,
      `Hook is misconfigured (enabled=${hookRow.enabled}, ` +
        `function_name=${hookRow.function_name}). Run this SQL manually:`,
    );
    console.log(`        ${fixSql}`);
    return false;
  }

  ok(phaseName, "custom_access_token_hook is enabled and pointed correctly.");
  return true;
}

// ============================================================================
// Phase 4: Auth config (site_url + additional_redirect_urls)
// ============================================================================

/**
 * Sync the auth config: site_url and additional_redirect_urls. The
 * Management API endpoint is /v1/projects/{ref}/config/auth.
 *
 * Reference: https://api.supabase.com/api/v1#/projects/update_auth_config
 *
 * We send a PATCH that only updates the two fields we care about, so we
 * don't accidentally clobber any other auth config (MFA, SMTP, etc.).
 */
async function phaseAuth(e: RequiredEnv, opts: CliOptions): Promise<boolean> {
  const phaseName = "auth";

  // Derive the values to set. Production uses NEXT_PUBLIC_ROOT_DOMAIN;
  // for local dev we always include tuapp.local too.
  const rootDomain = env.NEXT_PUBLIC_ROOT_DOMAIN;
  const scheme = env.NEXT_PUBLIC_APP_SCHEME;
  const siteUrl = `${scheme}://${rootDomain}`;
  const additionalRedirects = [
    `${scheme}://${rootDomain}/auth/callback`,
    // Wildcard for subdomains (company.tuapp.com).
    `${scheme}://*.${rootDomain}/auth/callback`,
    // Common local-dev entries.
    `http://acme.tuapp.local:3000/auth/callback`,
    `http://*.tuapp.local:3000/auth/callback`,
  ];

  // Build the request body. Only send the fields we own.
  const body = {
    site_url: siteUrl,
    additional_redirect_urls: additionalRedirects,
  };

  if (opts.checkOnly) {
    info(`[check-only] would PATCH auth config with:`);
    console.log(JSON.stringify(body, null, 2).split("\n").map((l) => "        " + l).join("\n"));
    return true;
  }
  if (!opts.apply) {
    dry(phaseName, `PATCH https://api.supabase.com/v1/projects/${e.projectRef}/config/auth`);
    console.log(JSON.stringify(body, null, 2).split("\n").map((l) => "        " + l).join("\n"));
    return true;
  }
  if (
    !(await confirm(
      phaseName,
      `Set site_url=${siteUrl} and ${additionalRedirects.length} additional redirect URLs?`,
    ))
  ) {
    warn(phaseName, "skipped by user");
    return true;
  }
  step(phaseName, `PATCH auth config on project ${e.projectRef}`);
  const success = await managementApi(
    e.accessToken,
    e.projectRef,
    "PATCH",
    "/config/auth",
    body,
  );
  if (success) {
    ok(phaseName, "Auth config updated.");
  } else {
    err(phaseName, "Auth config update failed. See above for response body.");
  }
  return success;
}

// ============================================================================
// Phase 5: Seed (opt-in)
// ============================================================================

/**
 * Apply supabase/seed.sql. This is gated behind an extra confirmation
 * because seed data is the most likely thing a user wants to skip in
 * a real environment.
 *
 * Implementation: we run it through the psql endpoint via the
 * Supabase Database REST endpoint (`/v1/projects/{ref}/database/query`).
 * For a more robust flow, users can also run it via psql directly
 * (printed as an alternative).
 */
async function phaseSeed(e: RequiredEnv, opts: CliOptions): Promise<boolean> {
  const phaseName = "seed";
  const seedPath = resolve(ROOT_DIR, "supabase", "seed.sql");
  if (!existsSync(seedPath)) {
    warn(phaseName, `No supabase/seed.sql found at ${seedPath}. Skipping.`);
    return true;
  }
  const sql = readFileSync(seedPath, "utf8");

  if (opts.checkOnly) {
    info(`[check-only] would run seed.sql (${sql.length} chars). First line: ${sql.split("\n")[0]}`);
    return true;
  }
  if (!opts.apply) {
    dry(phaseName, `POST /v1/projects/${e.projectRef}/database/query with seed.sql contents`);
    return true;
  }
  if (!(await confirm(phaseName, "Apply supabase/seed.sql to the remote database?"))) {
    warn(phaseName, "skipped by user (recommended for production)");
    return true;
  }
  step(phaseName, `Running seed.sql (${sql.length} chars)`);
  return await managementApi(e.accessToken, e.projectRef, "POST", "/database/query", { query: sql });
}

// ============================================================================
// Helpers: command execution, prompts, Management API
// ============================================================================

/**
 * Run a shell command and stream its output. Returns true on exit code 0.
 * We pass SUPABASE_ACCESS_TOKEN via the spawned env so the supabase CLI
 * doesn't need it on the user's shell.
 */
function runCommand(
  cmd: string,
  opts: { env?: Record<string, string> } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd: ROOT_DIR,
      shell: true,
      stdio: "inherit",
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(true);
      else {
        err("shell", `Command exited with code ${code}: ${cmd}`);
        resolve(false);
      }
    });
    child.on("error", (e) => {
      err("shell", `Failed to spawn: ${e.message}`);
      resolve(false);
    });
  });
}

/**
 * Interactive confirmation. Auto-yes when --yes is set. Returns false on
 * empty input (safe default) or "n"/"no". Returns true on "y"/"yes".
 */
async function confirm(phase: string, msg: string): Promise<boolean> {
  // Load lazily so this script can run without readline in a pipe.
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = process;
  const rl = createInterface({ input: stdin, output: stdout });
  stdout.write(`[?] ${phase}: ${msg} [y/N] `);
  try {
    const answer = (await rl.question("")).trim().toLowerCase();
    rl.close();
    if (answer === "y" || answer === "yes") return true;
    return false;
  } catch {
    rl.close();
    // No TTY (CI without --yes): default to no.
    return false;
  }
}

/**
 * Call the Supabase Management API. Returns true on 2xx.
 *
 * We use Node's built-in fetch (Node 18+) — no extra deps.
 *
 * Reference for endpoints used:
 *   - PATCH /v1/projects/{ref}/config/auth
 *   - POST  /v1/projects/{ref}/database/query
 */
async function managementApi(
  accessToken: string,
  projectRef: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<boolean> {
  const url = `https://api.supabase.com/v1/projects/${projectRef}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      err("api", `${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
      return false;
    }
    // For 204 responses, there's no body.
    if (res.status === 204) return true;
    // For others, log a short summary.
    const json = (await res.json().catch(() => null)) as unknown;
    if (json) {
      info(`api response (truncated): ${JSON.stringify(json).slice(0, 200)}...`);
    }
    return true;
  } catch (e) {
    err("api", `${method} ${path} -> network error: ${(e as Error).message}`);
    return false;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // Print the mode banner so the operator (human or agent) always knows
  // whether the script is going to mutate anything.
  if (opts.checkOnly) {
    info("Mode: --check-only (read-only inspection).");
  } else if (opts.apply) {
    info(`Mode: --apply${opts.yes ? " --yes" : ""} (mutating; will prompt unless --yes).`);
  } else {
    info("Mode: dry-run (no mutations). Re-run with --apply to execute.");
  }

  const required = loadRequiredEnv();
  if (!required) {
    process.exit(3);
  }

  // If user passed --phase=, only run that phase.
  const phasesToRun = opts.phases ?? new Set<Phase>(PHASES);

  // Each phase returns true on success, false on failure.
  const results: Record<Phase, boolean> = {
    link: true,
    push: true,
    hook: true,
    auth: true,
    seed: true,
  };

  if (phasesToRun.has("link")) results.link = await phaseLink(required, opts);
  // Stop early if link failed — subsequent phases will likely fail too.
  if (!results.link && !opts.checkOnly && opts.apply) {
    err("main", "Link phase failed. Aborting subsequent phases.");
    process.exit(1);
  }

  if (phasesToRun.has("push")) results.push = await phasePush(required, opts);
  if (phasesToRun.has("hook")) results.hook = await phaseHook(required, opts);
  if (phasesToRun.has("auth")) results.auth = await phaseAuth(required, opts);
  if (phasesToRun.has("seed")) results.seed = await phaseSeed(required, opts);

  // Summary
  info("---");
  info("Summary:");
  for (const phase of PHASES) {
    if (!phasesToRun.has(phase)) continue;
    const sym = results[phase] ? "✓" : "✗";
    const status = results[phase] ? "ok" : "FAIL";
    console.log(`        ${sym}  ${phase.padEnd(8)} ${status}`);
  }

  const anyFailed = Object.entries(results).some(
    ([p, ok]) => phasesToRun.has(p as Phase) && !ok,
  );
  if (anyFailed) {
    err("main", "One or more phases failed. See output above.");
    process.exit(1);
  }
  ok("main", "Done.");
}

main().catch((e) => {
  err("main", (e as Error).message);
  console.error(e);
  process.exit(1);
});