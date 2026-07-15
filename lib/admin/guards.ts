/**
 * lib/admin/guards.ts — Authorization guards for admin endpoints.
 *
 * Three guards cover the three levels of the RBAC model:
 *
 *   - requireSuperAdmin(): only platform operators (the SaaS vendor).
 *     Returns 403 SUPER_ADMIN_REQUIRED otherwise. Used by routes under
 *     app/admin/api/*.
 *
 *   - requireCompanyAdmin(companyId): company owners/admins OR super_admins.
 *     Returns 403 COMPANY_ADMIN_REQUIRED if not, or 403 COMPANY_MISMATCH
 *     if the companyId arg doesn't match the caller's active company.
 *     Used by routes under app/(tenant)/api/admin/*.
 *
 *   - requireRole(...): the existing role check for the current workspace.
 *     Thin wrapper that delegates to getActiveContext().role. Optional —
 *     the new admin guards above are preferred because they handle
 *     super_admin bypass uniformly.
 *
 * Each guard returns either { ok: true, ctx } or { ok: false, response }.
 * The handler is responsible for returning `response` when ok is false.
 *
 * Pattern for callers:
 *
 *   const guard = await requireCompanyAdmin(targetCompanyId);
 *   if (!guard.ok) return guard.response;
 *   const { ctx } = guard;
 *   // ... business logic ...
 *
 * Why the result-type split: it forces callers to handle the failure
 * case before reading `ctx`. Easier for type-checker to catch missing
 * branches than returning a union of (ActiveContext | NextResponse).
 */

import "server-only";

import { err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { getActiveContext, type ActiveContext } from "@/lib/tenant/context";
import type { NextResponse } from "next/server";

export type GuardResult =
  | { ok: true; ctx: ActiveContext }
  | { ok: false; response: NextResponse };

/**
 * Require the caller to be a super_admin. Cross-tenant by design:
 * super_admins can hit this from any host (no /w/:slug path required).
 *
 * Implementation note: this still calls getActiveContext() under the hood
 * because we want to use the standard cookie/JWT machinery. The
 * difference is that for a super_admin, the `ctx.workspace` and `ctx.role`
 * fields will be the first membership's (or default if none) — they may
 * not correspond to anything in the URL. Admin routes should branch on
 * `ctx.platformRole === 'super_admin'` and NOT trust `ctx.workspace.id`
 * for scoping queries. Use `targetCompanyId` from the URL/body instead.
 */
export async function requireSuperAdmin(): Promise<GuardResult> {
  let ctx: ActiveContext;
  try {
    ctx = await getActiveContext();
  } catch {
    // We still want to return a uniform API response, not a thrown error.
    // Map the TenantContextError to the appropriate API error.
    return {
      ok: false,
      response: err(
        ApiErrorCode.AUTH_REQUIRED,
        "Authentication required.",
      ),
    };
  }

  if (ctx.platformRole !== "super_admin") {
    return {
      ok: false,
      response: err(
        ApiErrorCode.SUPER_ADMIN_REQUIRED,
        "This endpoint requires platform super_admin privileges.",
      ),
    };
  }

  return { ok: true, ctx };
}

/**
 * Require the caller to be an owner or admin of `targetCompanyId`,
 * OR to be a super_admin.
 *
 * Used by routes that mutate data scoped to a single company (members,
 * workspaces, settings) where the target company may differ from the
 * caller's currently-active company. This guard is the right choice
 * for cross-workspace-within-company operations.
 *
 * Returns 403 COMPANY_MISMATCH if `targetCompanyId` is not the caller's
 * active company (and the caller is not a super_admin). The mismatch
 * happens BEFORE the role check, so users can't probe role membership
 * across companies.
 */
export async function requireCompanyAdmin(
  targetCompanyId: string,
): Promise<GuardResult> {
  let ctx: ActiveContext;
  try {
    ctx = await getActiveContext();
  } catch {
    return {
      ok: false,
      response: err(
        ApiErrorCode.AUTH_REQUIRED,
        "Authentication required.",
      ),
    };
  }

  // super_admin bypasses everything.
  if (ctx.platformRole === "super_admin") {
    return { ok: true, ctx };
  }

  // Regular users can only act on their own active company.
  if (ctx.company.id !== targetCompanyId) {
    return {
      ok: false,
      response: err(
        ApiErrorCode.COMPANY_MISMATCH,
        "You can only administer your own company.",
      ),
    };
  }

  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return {
      ok: false,
      response: err(
        ApiErrorCode.COMPANY_ADMIN_REQUIRED,
        "This endpoint requires owner or admin role.",
      ),
    };
  }

  return { ok: true, ctx };
}

/**
 * Require the caller to be the owner (NOT admin) of `targetCompanyId`,
 * OR a super_admin.
 *
 * Used for the most sensitive operations: changing company settings,
 * removing the last owner, promoting other users. Admins can NOT do
 * these — only owners.
 */
export async function requireCompanyOwner(
  targetCompanyId: string,
): Promise<GuardResult> {
  let ctx: ActiveContext;
  try {
    ctx = await getActiveContext();
  } catch {
    return {
      ok: false,
      response: err(
        ApiErrorCode.AUTH_REQUIRED,
        "Authentication required.",
      ),
    };
  }

  if (ctx.platformRole === "super_admin") {
    return { ok: true, ctx };
  }

  if (ctx.company.id !== targetCompanyId) {
    return {
      ok: false,
      response: err(
        ApiErrorCode.COMPANY_MISMATCH,
        "You can only act on your own company.",
      ),
    };
  }

  if (ctx.role !== "owner") {
    return {
      ok: false,
      response: err(
        ApiErrorCode.ROLE_INSUFFICIENT,
        "This action requires the owner role.",
      ),
    };
  }

  return { ok: true, ctx };
}