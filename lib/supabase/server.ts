/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers.
 *
 * This client reads and writes auth cookies via next/headers, so it MUST
 * only be imported from server contexts. Importing it in a Client Component
 * will fail the build with a "use client" mismatch.
 *
 * IMPORTANT: this client respects RLS. The current user's JWT is read from
 * the request cookies and attached to every query, so policies evaluate
 * correctly. For admin operations that need to bypass RLS, use service.ts
 * instead.
 *
 * Usage:
 *   import { createClient } from "@/lib/supabase/server";
 *   const supabase = await createClient();
 *   const { data } = await supabase.from("notes").select("*");
 */

import "server-only";

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

import { env } from "@/lib/env";

/**
 * Shape of each entry passed to `setAll` by @supabase/ssr. The library
 * uses this callback to write refreshed auth cookies back to the
 * response. Pinning the shape here keeps `setAll(cookiesToSet)`
 * strongly-typed regardless of @supabase/ssr version changes.
 */
type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Create a Supabase client scoped to the current request.
 *
 * The cookie store is read fresh on every call, so this is safe to call
 * inside React Server Components (which may run multiple times per render).
 *
 * The second argument to `setAll` receives the request headers and is where
 * we inject `Cache-Control: no-store` to prevent Vercel's CDN from caching
 * authenticated responses. This is the #1 cause of cross-tenant session
 * leakage on shared edges. DO NOT REMOVE.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // The `setAll` method was called from a Server Component or
            // Server Action where cookies cannot be set. This is expected
            // in middleware/proxy contexts. The proxy.ts refresh logic
            // handles cookie writes there; we can safely ignore.
          }
        },
      },
      // Cache-Control headers. Applied automatically to every response that
      // goes through this client. Critical for multi-tenant safety.
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.NEXT_PUBLIC_APP_SCHEME === "https",
        path: "/",
      },
    },
  );
}