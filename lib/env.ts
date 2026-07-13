/**
 * Environment variable validation (fail-fast).
 *
 * Why this exists: a missing or malformed env var is the #1 source of
 * "works on my machine" bugs. We validate at module load so the process
 * crashes with a clear error rather than failing cryptically at first query.
 *
 * Usage:
 *   import { env } from "@/lib/env";
 *   const url = env.NEXT_PUBLIC_SUPABASE_URL;
 *
 * NEVER access `process.env.X` directly elsewhere — go through this module.
 */

import { z } from "zod";

/**
 * Schema for the public (browser-exposed) environment.
 *
 * These must be safe to embed in client bundles. NEVER put secrets here.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short"),
  NEXT_PUBLIC_ROOT_DOMAIN: z
    .string()
    .min(3, "NEXT_PUBLIC_ROOT_DOMAIN is required (e.g. tuapp.com)")
    .refine(
      (s) => !s.includes("://"),
      "NEXT_PUBLIC_ROOT_DOMAIN must NOT include protocol (no http://)",
    ),
  NEXT_PUBLIC_APP_SCHEME: z.enum(["http", "https"]).default("https"),
});

/**
 * Schema for the server-only environment.
 *
 * IMPORTANT: this module is only evaluated server-side. If you ever need
 * server-only vars in a context that could leak to the browser, you MUST
 * guard with `import "server-only"` or Next.js will yell at you.
 */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "SUPABASE_SERVICE_ROLE_KEY is required and looks too short"),
});

/**
 * Combined schema. `parse()` throws ZodError on bad input — Next.js will
 * surface that as a 500 with the validation message in dev mode.
 */
const schema = publicSchema.merge(serverSchema);

/**
 * Validate at module load. This runs the first time `env` is imported.
 *
 * In dev, you'll see the full error in the terminal.
 * In prod, we log a sanitized version and still throw — better to crash on
 * boot than to silently misbehave.
 */
function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Log all validation errors at once so the user fixes everything in one go.
    console.error("\n❌ Invalid environment configuration:\n");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nCheck your .env.local against .env.example.\n");
    throw new Error("Invalid environment configuration");
  }
  return Object.freeze(parsed.data);
}

/**
 * Validated environment object. Access values via `env.X`.
 *
 * The shape is the union of public + server schemas. Both groups can be used
 * from server-side code; only the NEXT_PUBLIC_* fields are safe to use from
 * client components.
 */
export const env = loadEnv();