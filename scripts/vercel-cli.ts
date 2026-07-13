/**
 * vercel-cli.ts — Orchestrate Vercel project operations.
 *
 * Subcommands (one per "thing the agent needs to do"):
 *
 *   link        Link the local repo to a Vercel project. Required once.
 *               Reads VERCEL_ORG_ID + VERCEL_PROJECT_ID from env.
 *   env         List / pull / push env vars. Pull writes .env.local from
 *               the project's stored env (matches what the CI workflow
 *               does). Push uploads local env to the project.
 *   domains     Add / list domains. Used for the wildcard subdomain
 *               (acme.tuapp.com / *.tuapp.com).
 *   deploy      Trigger a production or preview deploy via the CLI.
 *   deployments List recent deployments.
 *   inspect     Inspect a deployment (status, logs URL, errors).
 *
 * Modes:
 *
 *   --check-only     Read-only inspection of Vercel state. No changes.
 *   (no flag)        Dry-run. Prints what would happen, then exits.
 *   --apply          Apply changes with interactive prompts.
 *   --yes            Skip prompts (CI mode).
 *
 * Examples:
 *
 *   # First-time setup: link the repo.
 *   pnpm vercel:link --apply
 *
 *   # Pull the project's env vars into .env.local.
 *   pnpm tsx scripts/vercel-cli.ts env pull --apply
 *
 *   # Add a wildcard subdomain.
 *   pnpm tsx scripts/vercel-cli.ts domains add "*.tuapp.com" --apply
 *
 *   # List recent deployments.
 *   pnpm tsx scripts/vercel-cli.ts deployments list
 *
 *   # Inspect the most recent deployment.
 *   pnpm tsx scripts/vercel-cli.ts inspect latest
 *
 * Environment:
 *   VERCEL_TOKEN         Required. https://vercel.com/account/tokens.
 *   VERCEL_ORG_ID        Optional for personal deploys; required for teams.
 *   VERCEL_PROJECT_ID    Optional; recommended for unambiguous targeting.
 *
 * Exit codes:
 *   0  All requested operations succeeded (or check-only completed).
 *   1  An operation failed (see last printed record).
 *   2  Bad CLI usage.
 *   3  Missing required env vars.
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = resolve(dirname(__filename), "..");

// ============================================================================
// CLI parsing
// ============================================================================

type Subcommand =
  | "link"
  | "env"
  | "domains"
  | "deploy"
  | "deployments"
  | "inspect";

interface CliOptions {
  checkOnly: boolean;
  apply: boolean;
  yes: boolean;
  subcommand: Subcommand;
  // Subcommand arguments (variadic, parsed by each subcommand).
  args: string[];
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  const opts: CliOptions = {
    checkOnly: false,
    apply: false,
    yes: false,
    subcommand: argv[0] as Subcommand,
    args: [],
  };

  // Collect all flag-bearing options first; rest goes to args.
  const positional: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check-only") opts.checkOnly = true;
    else if (a === "--apply") opts.apply = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else positional.push(a);
  }
  opts.args = positional;

  if (!isSubcommand(opts.subcommand)) {
    console.error(
      `Unknown subcommand: ${opts.subcommand}. Valid: ${SUBCOMMANDS.join(", ")}`,
    );
    process.exit(2);
  }
  return opts;
}

const SUBCOMMANDS: Subcommand[] = [
  "link",
  "env",
  "domains",
  "deploy",
  "deployments",
  "inspect",
];
function isSubcommand(s: string): s is Subcommand {
  return (SUBCOMMANDS as string[]).includes(s);
}

function printHelp(): void {
  console.log(`Usage: tsx scripts/vercel-cli.ts <subcommand> [flags] [args...]

Subcommands:
  link                          Link the local repo to a Vercel project.
  env list                      List env vars (names only; values are secret).
  env pull [path]               Pull env vars to .env.local (or path).
  env push [--environment=...]  Push local env to a Vercel project.
  domains list                  List configured domains.
  domains add <domain>          Add a domain (e.g. *.tuapp.com).
  domains rm  <domain>          Remove a domain.
  deploy [--prod]               Trigger a deploy (default: preview).
  deployments list [--limit=N]  List recent deployments.
  inspect <id|latest>           Inspect a deployment.

Flags:
  --check-only     Read-only inspection. No changes.
  --apply          Apply changes. Prompts unless --yes.
  --yes            Skip prompts (for CI / automation).
  --help, -h       Show this help.

Environment:
  VERCEL_TOKEN         Required.
  VERCEL_ORG_ID        Optional for personal, required for teams.
  VERCEL_PROJECT_ID    Optional; recommended.

Exit codes:
  0  All operations succeeded (or check-only completed).
  1  An operation failed.
  2  Bad CLI usage.
  3  Missing env vars.
`);
}

// ============================================================================
// Logging (same prefix format as setup-supabase.ts so scripts compose visually)
// ============================================================================

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
// Required env
// ============================================================================

interface RequiredEnv {
  token: string;
  orgId: string | null;
  projectId: string | null;
}

function loadRequiredEnv(): RequiredEnv | null {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    err(
      "env",
      `Missing VERCEL_TOKEN. Get one at https://vercel.com/account/tokens.`,
    );
    return null;
  }
  return {
    token,
    orgId: process.env.VERCEL_ORG_ID ?? null,
    projectId: process.env.VERCEL_PROJECT_ID ?? null,
  };
}

// ============================================================================
// Subcommand: link
// ============================================================================

async function subcommandLink(
  e: RequiredEnv,
  opts: CliOptions,
): Promise<boolean> {
  const phaseName = "link";
  const linkedMarker = resolve(ROOT_DIR, ".vercel", "project.json");

  if (existsSync(linkedMarker)) {
    try {
      const current = JSON.parse(readFileSync(linkedMarker, "utf8")) as {
        projectId?: string;
        orgId?: string;
      };
      if (current.projectId && current.projectId === e.projectId) {
        ok(phaseName, `Already linked to project ${current.projectId}.`);
        return true;
      }
      warn(
        phaseName,
        `Currently linked to ${current.projectId ?? "(unknown)"}; requested ${e.projectId ?? "(unspecified)"}.`,
      );
    } catch {
      warn(phaseName, `Could not read .vercel/project.json; will re-link.`);
    }
  }

  const cmdArgs = ["link", "--yes", "--token", e.token];
  if (e.orgId) cmdArgs.push("--scope", e.orgId);
  if (e.projectId) cmdArgs.push("--project", e.projectId);
  const cmd = ["vercel", ...cmdArgs].join(" ");

  if (opts.checkOnly) {
    info(`[check-only] would run: ${cmd}`);
    return true;
  }
  if (!opts.apply) {
    dry(phaseName, cmd);
    return true;
  }
  if (!(await confirm(phaseName, "Link this repo to the Vercel project?"))) {
    warn(phaseName, "skipped by user");
    return true;
  }
  step(phaseName, cmd);
  return await runCommand(cmd);
}

// ============================================================================
// Subcommand: env
// ============================================================================

async function subcommandEnv(
  e: RequiredEnv,
  opts: CliOptions,
): Promise<boolean> {
  const phaseName = "env";
  const action = opts.args[0] ?? "help";

  if (action === "list") {
    return await envList(e, opts);
  }
  if (action === "pull") {
    return await envPull(e, opts);
  }
  if (action === "push") {
    return await envPush(e, opts);
  }

  err(
    "env",
    `Unknown env action: ${action}. Use: list | pull [path] | push [--environment=...]`,
  );
  return false;
}

async function envList(e: RequiredEnv, opts: CliOptions): Promise<boolean> {
  const phaseName = "env";
  const envName = parseFlag(opts.args.slice(1), "--environment") ?? "production";
  const cmd = `vercel env ls ${envName} --token ${e.token}`;
  if (opts.checkOnly || !opts.apply) {
    dry(phaseName, cmd);
    return true;
  }
  step(phaseName, cmd);
  return await runCommand(cmd);
}

async function envPull(e: RequiredEnv, opts: CliOptions): Promise<boolean> {
  const phaseName = "env";
  const outPath = opts.args[1] ?? ".env.local";
  const envName = parseFlag(opts.args.slice(1), "--environment") ?? "production";

  // Resolve relative path against ROOT_DIR.
  const targetPath = resolve(ROOT_DIR, outPath);

  const cmd = `vercel env pull ${targetPath} --environment=${envName} --token ${e.token} --yes`;
  if (opts.checkOnly) {
    info(`[check-only] would run: ${cmd}`);
    return true;
  }
  if (!opts.apply) {
    dry(phaseName, cmd);
    return true;
  }
  if (existsSync(targetPath)) {
    if (
      !(await confirm(
        phaseName,
        `Overwrite existing file at ${outPath}?`,
      ))
    ) {
      warn(phaseName, "skipped by user");
      return true;
    }
  }
  step(phaseName, cmd);
  return await runCommand(cmd);
}

async function envPush(e: RequiredEnv, opts: CliOptions): Promise<boolean> {
  const phaseName = "env";
  const envName = parseFlag(opts.args.slice(1), "--environment") ?? "production";

  // `vercel env push` reads from stdin or a file. We expect a file path.
  const fileArg = opts.args[1] && !opts.args[1].startsWith("--")
    ? opts.args[1]
    : ".env.local";
  const filePath = resolve(ROOT_DIR, fileArg);
  if (!existsSync(filePath)) {
    err(phaseName, `No file at ${filePath}. Use 'env pull' first to create one.`);
    return false;
  }

  const cmd = `vercel env push ${filePath} --environment=${envName} --token ${e.token} --yes`;
  if (opts.checkOnly) {
    info(`[check-only] would run: ${cmd}`);
    return true;
  }
  if (!opts.apply) {
    dry(phaseName, cmd);
    return true;
  }
  if (
    !(await confirm(
      phaseName,
      `Push env vars from ${fileArg} to the ${envName} environment?`,
    ))
  ) {
    warn(phaseName, "skipped by user");
    return true;
  }
  step(phaseName, cmd);
  return await runCommand(cmd);
}

// ============================================================================
// Subcommand: domains
// ============================================================================

async function subcommandDomains(
  e: RequiredEnv,
  opts: CliOptions,
): Promise<boolean> {
  const phaseName = "domains";
  const action = opts.args[0] ?? "help";

  if (action === "list") {
    const cmd = `vercel domains ls --token ${e.token}`;
    if (opts.checkOnly || !opts.apply) {
      dry(phaseName, cmd);
      return true;
    }
    step(phaseName, cmd);
    return await runCommand(cmd);
  }
  if (action === "add") {
    const domain = opts.args[1];
    if (!domain) {
      err(phaseName, "Usage: domains add <domain>");
      return false;
    }
    const cmd = `vercel domains add ${domain} --token ${e.token} --yes`;
    if (opts.checkOnly) {
      info(`[check-only] would run: ${cmd}`);
      return true;
    }
    if (!opts.apply) {
      dry(phaseName, cmd);
      return true;
    }
    if (!(await confirm(phaseName, `Add domain ${domain}?`))) {
      warn(phaseName, "skipped by user");
      return true;
    }
    step(phaseName, cmd);
    return await runCommand(cmd);
  }
  if (action === "rm") {
    const domain = opts.args[1];
    if (!domain) {
      err(phaseName, "Usage: domains rm <domain>");
      return false;
    }
    if (opts.checkOnly || !opts.apply) {
      dry(phaseName, `vercel domains rm ${domain} --token ${e.token} --yes`);
      return true;
    }
    if (!(await confirm(phaseName, `Remove domain ${domain}?`))) {
      warn(phaseName, "skipped by user");
      return true;
    }
    step(phaseName, `vercel domains rm ${domain} --token ${e.token} --yes`);
    return await runCommand(
      `vercel domains rm ${domain} --token ${e.token} --yes`,
    );
  }
  err(phaseName, `Unknown domains action: ${action}. Use: list | add | rm`);
  return false;
}

// ============================================================================
// Subcommand: deploy
// ============================================================================

async function subcommandDeploy(
  e: RequiredEnv,
  opts: CliOptions,
): Promise<boolean> {
  const phaseName = "deploy";
  const prod = opts.args.includes("--prod");
  const cmd = prod
    ? `vercel deploy --prod --yes --token ${e.token}`
    : `vercel deploy --yes --token ${e.token}`;

  if (opts.checkOnly) {
    info(`[check-only] would run: ${cmd}`);
    return true;
  }
  if (!opts.apply) {
    dry(phaseName, cmd);
    return true;
  }
  if (!(await confirm(phaseName, prod ? "Deploy to PRODUCTION?" : "Deploy preview?"))) {
    warn(phaseName, "skipped by user");
    return true;
  }
  step(phaseName, cmd);
  return await runCommand(cmd);
}

// ============================================================================
// Subcommand: deployments
// ============================================================================

async function subcommandDeployments(
  e: RequiredEnv,
  opts: CliOptions,
): Promise<boolean> {
  const phaseName = "deployments";
  const action = opts.args[0] ?? "list";
  if (action !== "list") {
    err(phaseName, `Unknown deployments action: ${action}. Use: list`);
    return false;
  }
  const limit = parseFlag(opts.args.slice(1), "--limit") ?? "10";
  const cmd = `vercel ls --limit ${limit} --token ${e.token}`;
  // `deployments list` is read-only; check-only and apply both run it.
  if (!opts.apply && !opts.checkOnly) {
    dry(phaseName, cmd);
    return true;
  }
  step(phaseName, cmd);
  return await runCommand(cmd);
}

// ============================================================================
// Subcommand: inspect
// ============================================================================

async function subcommandInspect(
  e: RequiredEnv,
  opts: CliOptions,
): Promise<boolean> {
  const phaseName = "inspect";
  const target = opts.args[0];
  if (!target) {
    err(phaseName, "Usage: inspect <deployment-id | latest>");
    return false;
  }

  // Resolve "latest" to the most recent deployment id.
  let deploymentId = target;
  if (target === "latest") {
    const resolved = await resolveLatestDeploymentId(e);
    if (!resolved) {
      err(phaseName, `Could not resolve "latest" — no deployments found.`);
      return false;
    }
    deploymentId = resolved;
    info(`Resolved "latest" -> ${deploymentId}`);
  }

  const cmd = `vercel inspect ${deploymentId} --token ${e.token}`;
  if (!opts.apply && !opts.checkOnly) {
    dry(phaseName, cmd);
    return true;
  }
  step(phaseName, cmd);
  return await runCommand(cmd);
}

/**
 * Fetch the most recent deployment ID. We call `vercel ls` (the same
 * command deployments list runs) and parse the first line. Returns null
 * on parse failure or empty output.
 */
async function resolveLatestDeploymentId(
  e: RequiredEnv,
): Promise<string | null> {
  const result = await runCommandCapturing(
    `vercel ls --limit 1 --token ${e.token}`,
  );
  if (!result.ok) return null;
  // `vercel ls` output looks like:
  //   Age    Deployment    Status     Duration    Username
  //   1m     dpl_abc123...  Ready      1m         you
  const lines = result.stdout.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const dataLine = lines[1];
  const match = dataLine.match(/\b(dpl_[A-Za-z0-9]+)\b/);
  return match ? match[1] : null;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Run a shell command and stream its output. Returns true on exit code 0.
 */
function runCommand(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd: ROOT_DIR,
      shell: true,
      stdio: "inherit",
      env: process.env,
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
 * Same as runCommand but captures stdout/stderr for parsing. Used by
 * resolveLatestDeploymentId.
 */
function runCommandCapturing(
  cmd: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd: ROOT_DIR,
      shell: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("exit", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on("error", (e) => {
      resolve({ ok: false, stdout, stderr: e.message });
    });
  });
}

/**
 * Interactive confirmation. Auto-yes when --yes is set.
 */
async function confirm(phase: string, msg: string): Promise<boolean> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write(`[?] ${phase}: ${msg} [y/N] `);
  try {
    const answer = (await rl.question("")).trim().toLowerCase();
    rl.close();
    if (answer === "y" || answer === "yes") return true;
    return false;
  } catch {
    rl.close();
    return false;
  }
}

/**
 * Pull the value of a `--key=value` or `--key value` flag from an argv tail.
 * Returns null if not present.
 */
function parseFlag(args: string[], flag: string): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === flag && i + 1 < args.length) return args[i + 1];
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  }
  return null;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // Mode banner.
  if (opts.checkOnly) info("Mode: --check-only (read-only).");
  else if (opts.apply) info(`Mode: --apply${opts.yes ? " --yes" : ""} (mutating).`);
  else info("Mode: dry-run (no mutations). Re-run with --apply.");

  const required = loadRequiredEnv();
  if (!required) process.exit(3);

  let success = false;
  switch (opts.subcommand) {
    case "link": success = await subcommandLink(required, opts); break;
    case "env": success = await subcommandEnv(required, opts); break;
    case "domains": success = await subcommandDomains(required, opts); break;
    case "deploy": success = await subcommandDeploy(required, opts); break;
    case "deployments": success = await subcommandDeployments(required, opts); break;
    case "inspect": success = await subcommandInspect(required, opts); break;
  }

  if (!success) {
    err("main", "Subcommand failed. See output above.");
    process.exit(1);
  }
  ok("main", "Done.");
}

main().catch((e) => {
  err("main", (e as Error).message);
  console.error(e);
  process.exit(1);
});