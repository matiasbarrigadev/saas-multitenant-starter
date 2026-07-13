/**
 * Service-role Supabase client. BYPASSES RLS.
 *
 * ⚠️ DANGER ⚠️
 *
 * This client authenticates as the service role, which has full read/write
 * access to every table, every schema, every row. It is meant ONLY for:
 *
 *   1. Server-side admin tasks (e.g. switching a user's active workspace by
 *      updating their `app_metadata`).
 *   2. The `custom_access_token_hook` (but that lives in Postgres, not here).
 *   3. Background jobs and cron tasks that need to operate across tenants.
 *
 * NEVER:
 *   - Import this from a Client Component (would expose the service key).
 *   - Use this to fetch data on behalf of an end user. Use server.ts instead
 *     so RLS protects the user.
 *   - Pass user-controlled input directly into queries without manual
 *     validation. RLS is your safety net for the regular client; here you
 *     have to enforce tenancy yourself.
 *
 * Every call to createServiceClient() must be justified in a code comment
 * explaining why RLS is being bypassed.
 *
 * Usage:
 *   import { createServiceClient } from "@/lib/supabase/service";
 *   const supabase = createServiceClient();
 *   // ...admin operation...
 */

import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * Create a Supabase client with service-role privileges.
 *
 * We use the raw supabase-js client (not @supabase/ssr) because we don't
 * need cookie handling — the service role is identified by its key, not
 * by a user session.
 *
 * `auth.persistSession: false` and `auth.autoRefreshToken: false` ensure we
 * don't accidentally try to maintain a session for the service role.
 */
export function createServiceClient() {
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}