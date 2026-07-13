/**
 * Resolve a workspace by (company_id, slug).
 *
 * Used by both proxy.ts (to validate the /w/:slug segment) and by the
 * switch-workspace endpoint (to verify the user is requesting a real
 * workspace).
 *
 * Like resolve-company.ts, this uses the regular server client and is
 * subject to RLS. The `workspaces` policy lets any member of the parent
 * company see all its workspaces.
 */

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/lib/supabase/types";

const TTL_MS = 60_000;
const cache_ = new Map<string, { value: Workspace | null; expiresAt: number }>();

function key(companyId: string, slug: string) {
  return `${companyId}:${slug}`;
}

function getCached(companyId: string, slug: string): Workspace | null | undefined {
  const entry = cache_.get(key(companyId, slug));
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache_.delete(key(companyId, slug));
    return undefined;
  }
  return entry.value;
}

function setCached(companyId: string, slug: string, value: Workspace | null) {
  cache_.set(key(companyId, slug), { value, expiresAt: Date.now() + TTL_MS });
}

/**
 * Look up a workspace by (company_id, slug). Returns null if not found
 * OR if the user has no membership in the company (RLS hides it).
 */
export const resolveWorkspaceBySlug = cache(
  async (companyId: string, slug: string): Promise<Workspace | null> => {
    const cached = getCached(companyId, slug);
    if (cached !== undefined) return cached;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workspaces")
      .select("*")
      .eq("company_id", companyId)
      .eq("slug", slug)
      .is("archived_at", null)
      .maybeSingle();

    if (error) {
      console.error(
        `[resolveWorkspaceBySlug] DB error for company=${companyId} slug=${slug}:`,
        error,
      );
      setCached(companyId, slug, null);
      return null;
    }

    const workspace = (data ?? null) as Workspace | null;
    setCached(companyId, slug, workspace);
    return workspace;
  },
);

/**
 * Parse `/w/:slug` from a pathname.
 *
 * Returns the workspace slug if the path starts with /w/{something}/, else
 * null. We require something after the /w/ so that bare /w/ doesn't match
 * (otherwise users hitting the root of /w/ would erroneously "have a
 * workspace in the URL").
 */
export function parseWorkspaceFromPath(pathname: string): string | null {
  // Match /w/<slug> at the start of the pathname. Slug may not contain "/".
  const match = pathname.match(/^\/w\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\/|$)/i);
  if (!match) return null;
  return match[1].toLowerCase();
}