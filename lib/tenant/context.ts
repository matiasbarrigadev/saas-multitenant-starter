/**
 * Active tenant context for the current request.
 *
 * Once proxy.ts has validated the request, downstream code (RSCs, route
 * handlers, server actions) needs a typed way to read:
 *   - the user
 *   - the active company
 *   - the active workspace
 *   - the user's role in that workspace
 *
 * `getActiveContext()` reads the JWT claims set by the auth hook and the
 * /api/me/switch-workspace endpoint. It does NOT re-query the database —
 * the JWT is the source of truth for "active workspace".
 *
 * Throws `TenantContextError` if no valid context exists. Callers should
 * either let the throw bubble (it's a 401/403 condition) or catch and
 * handle explicitly.
 */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

import { parseHost } from "@/lib/tenant/host";
import { headers } from "next/headers";

/**
 * Why this error class exists: every API route / page that requires a
 * tenant context needs to know whether a missing context means "not
 * signed in" (redirect to /login) vs "signed in but in the wrong
 * subdomain" (show a 403 page). Distinguishing these lets us give the
 * user a useful message instead of a generic error.
 */
export class TenantContextError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "AUTH_REQUIRED"
      | "COMPANY_MISMATCH"
      | "WORKSPACE_REQUIRED"
      | "WORKSPACE_FORBIDDEN",
  ) {
    super(message);
    this.name = "TenantContextError";
  }
}

export interface ActiveContext {
  user: { id: string; email: string | null };
  company: { id: string; slug: string };
  workspace: { id: string; slug: string };
  role: "owner" | "admin" | "member";
  /** All workspaces the user is a member of, useful for the switcher UI. */
  memberships: Array<{
    company_id: string;
    company_slug: string;
    workspace_id: string;
    workspace_slug: string;
    role: "owner" | "admin" | "member";
  }>;
}

/**
 * Read the active tenant context for the current request.
 *
 * Steps:
 *   1. Get the Supabase client (reads cookies for current user).
 *   2. Call getClaims() to validate the JWT. Throws on no session.
 *   3. Read the company slug from the Host header (via proxy.ts header
 *      forwarding, or recompute here).
 *   4. Compare JWT active_company_id with the host-derived slug's id.
 *   5. Read JWT app_metadata for active_workspace_id, active_role, etc.
 *
 * This is the canonical way for any server-side code to get the tenant
 * context. It is intentionally synchronous-feeling (just an async I/O)
 * so it can be called inside RSCs.
 */
export async function getActiveContext(): Promise<ActiveContext> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims) {
    throw new TenantContextError(
      "No valid auth session.",
      "AUTH_REQUIRED",
    );
  }

  const claims = claimsData.claims as {
    sub: string;
    email?: string;
    app_metadata?: Record<string, unknown>;
  };

  const appMetadata = claims.app_metadata ?? {};
  const activeCompanyId = appMetadata.active_company_id as string | undefined;
  const activeWorkspaceId = appMetadata.active_workspace_id as string | undefined;
  const activeRole = appMetadata.active_role as
    | "owner"
    | "admin"
    | "member"
    | undefined;
  const memberships = (appMetadata.company_memberships as ActiveContext["memberships"]) ?? [];

  if (!activeCompanyId || !activeWorkspaceId || !activeRole) {
    throw new TenantContextError(
      "Session has no active workspace. Call /api/me/switch-workspace first.",
      "WORKSPACE_REQUIRED",
    );
  }

  // Verify the JWT's active company matches the Host header's company.
  // This defends against a user with a valid session navigating to a
  // different subdomain than the one their session was activated in.
  const hdrs = await headers();
  const forwardedCompanyId = hdrs.get("x-company-id");
  const hostHeader = hdrs.get("host");
  const parsedHost = parseHost(hostHeader);
  const hostCompanySlug = parsedHost.companySlug;

  if (forwardedCompanyId && forwardedCompanyId !== activeCompanyId) {
    throw new TenantContextError(
      "Active workspace belongs to a different company than the requested host.",
      "COMPANY_MISMATCH",
    );
  }

  // Even if x-company-id isn't forwarded (e.g. direct invocation),
  // we still verify the membership list contains the active workspace.
  const activeMembership = memberships.find(
    (m) => m.workspace_id === activeWorkspaceId,
  );
  if (!activeMembership) {
    throw new TenantContextError(
      "Active workspace is not in the user's memberships.",
      "WORKSPACE_FORBIDDEN",
    );
  }

  // Build the company slug from the active membership (more reliable than
  // re-parsing the host, which may be apex in some contexts).
  return {
    user: {
      id: claims.sub,
      email: claims.email ?? null,
    },
    company: {
      id: activeCompanyId,
      slug: activeMembership.company_slug,
    },
    workspace: {
      id: activeWorkspaceId,
      slug: activeMembership.workspace_slug,
    },
    role: activeRole,
    memberships,
  };
}

/**
 * Soft variant of getActiveContext(): returns null instead of throwing.
 * Use in pages that should render differently for unauthenticated users
 * (e.g. the dashboard layout falls back to redirect instead of crashing).
 */
export async function tryGetActiveContext(): Promise<ActiveContext | null> {
  try {
    return await getActiveContext();
  } catch (err) {
    if (err instanceof TenantContextError) return null;
    throw err;
  }
}

/**
 * Return the URL to redirect to for the login page on the current host.
 * Used by proxy.ts and the protected layout.
 */
export function buildLoginRedirect(currentPath: string): string {
  const params = new URLSearchParams({ next: currentPath });
  // We don't have the parsed host here, so callers pass it in via the
  // `host` arg below. For most callers, getLoginRedirectFromRequest is
  // more convenient.
  return `/login?${params.toString()}`;
}

/**
 * Convenience: build the login URL using the request's Host header.
 * Always lands on the same subdomain so cookies scope correctly.
 */
export function buildLoginUrlForRequest(
  hostHeader: string | null,
  nextPath: string,
): string {
  const parsed = parseHost(hostHeader);
  const params = new URLSearchParams({ next: nextPath });
  // Build manually since this may run in contexts where env isn't fully
  // resolved (e.g. proxy.ts).
  const rootDomain = env.NEXT_PUBLIC_ROOT_DOMAIN;
  const scheme = env.NEXT_PUBLIC_APP_SCHEME;
  const host = parsed.companySlug ? `${parsed.companySlug}.${rootDomain}` : rootDomain;
  return `${scheme}://${host}/login?${params.toString()}`;
}