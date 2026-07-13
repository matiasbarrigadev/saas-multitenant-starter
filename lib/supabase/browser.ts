/**
 * Browser-side Supabase client.
 *
 * Used inside Client Components (`"use client"`) for direct UI interactions:
 *   - Real-time subscriptions (Realtime)
 *   - Client-side data fetching with RLS still enforced
 *   - Calling Supabase Functions directly from the browser
 *
 * For Server Components and Route Handlers, use server.ts instead — it has
 * proper cookie handling via next/headers.
 *
 * Usage:
 *   "use client";
 *   import { createClient } from "@/lib/supabase/browser";
 *   const supabase = createClient();
 *   const { data } = await supabase.from("notes").select("*");
 */

"use client";

import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";

/**
 * Create a Supabase client for the browser.
 *
 * Cookie handling is automatic: @supabase/ssr syncs auth tokens to/from
 * document.cookie on each request.
 *
 * NOTE: this client still respects RLS because it uses the anon key. If you
 * need to bypass RLS (admin operations), the call MUST go through a Route
 * Handler that uses service.ts.
 */
export function createClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}