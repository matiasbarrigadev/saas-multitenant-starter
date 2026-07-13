/**
 * Resolve a company by slug.
 *
 * Given a slug from the Host header (e.g. "acme" from acme.tuapp.local),
 * fetch the corresponding company row.
 *
 * Why a dedicated module: this is the FIRST database call on every request,
 * so it should be (a) fast, (b) cacheable, and (c) careful about which
 * client to use.
 *
 * Client choice:
 *   - We use the regular server client (anon key + user JWT). That means
 *     RLS still applies, so anonymous users cannot enumerate company slugs.
 *   - The RLS policy on `companies` allows reads for users with at least
 *     one membership in the company. So:
 *       - Authenticated users get the row if they're a member.
 *       - Unauthenticated users get nothing -> "company not found".
 *   - For the marketing site (apex domain), we don't resolve companies;
 *     the lookup only runs when a slug is present.
 *
 * Caching:
 *   - We cache in-memory for 60 seconds. For higher scale, swap for
 *     Vercel Edge Config or Redis. The cache key is just the slug.
 *   - We do NOT cache during proxy.ts execution because proxy.ts runs
 *     on the Edge runtime and the cache lives in Node. The page-level
 *     resolvers can use the cache.
 */

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Company } from "@/lib/supabase/types";

/**
 * In-memory TTL cache. Sufficient for single-instance dev / preview.
 * Production: replace with Vercel Edge Config or Redis.
 */
const TTL_MS = 60_000;
const cache_ = new Map<string, { value: Company | null; expiresAt: number }>();

function getCached(slug: string): Company | null | undefined {
  const entry = cache_.get(slug);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache_.delete(slug);
    return undefined;
  }
  return entry.value;
}

function setCached(slug: string, value: Company | null) {
  cache_.set(slug, { value, expiresAt: Date.now() + TTL_MS });
}

/**
 * Resolve a company by slug. Returns null if no company exists OR if the
 * user has no membership (RLS hides it).
 *
 * Uses React's `cache()` to dedupe within a single request render pass.
 * This is important because both proxy.ts and the page-level code may
 * resolve the same slug; we want them to share the result.
 *
 * `cache()` only deduplicates per-request and per-process. The TTL cache
 * above handles cross-request deduplication for the same slug.
 */
export const resolveCompanyBySlug = cache(
  async (slug: string): Promise<Company | null> => {
    const cached = getCached(slug);
    if (cached !== undefined) return cached;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      // Don't expose DB errors to callers — log and return null. The caller
      // (proxy.ts) translates "null + protected route" into a redirect to
      // login. For public routes (apex, login), the page renders as if the
      // company doesn't exist.
      console.error(`[resolveCompanyBySlug] DB error for slug=${slug}:`, error);
      setCached(slug, null);
      return null;
    }

    const company = (data ?? null) as Company | null;
    setCached(slug, company);
    return company;
  },
);