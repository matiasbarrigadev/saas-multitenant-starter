/**
 * Catalog of API error codes used by all routes.
 *
 * Every error returned by an API route uses one of these codes. The shape
 * is stable: { code, message, details? }. Adding new codes? Add them here
 * so consumers (frontend error handler, log dashboards) have a single
 * source of truth.
 *
 * Conventions:
 *   - SCREAMING_SNAKE_CASE.
 *   - Group by prefix:
 *     AUTH_* = authentication / session issues
 *     WORKSPACE_* / COMPANY_* = tenancy issues
 *     VALIDATION_* = request body / params
 *     DB_* = database errors
 *     INTERNAL_* = unexpected failures
 */

export const ApiErrorCode = {
  // Auth
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_INVALID: "AUTH_INVALID",
  AUTH_SESSION_EXPIRED: "AUTH_SESSION_EXPIRED",

  // Tenant
  COMPANY_NOT_FOUND: "COMPANY_NOT_FOUND",
  COMPANY_MISMATCH: "COMPANY_MISMATCH",
  WORKSPACE_REQUIRED: "WORKSPACE_REQUIRED",
  WORKSPACE_NOT_FOUND: "WORKSPACE_NOT_FOUND",
  WORKSPACE_FORBIDDEN: "WORKSPACE_FORBIDDEN",

  // Validation
  VALIDATION_FAILED: "VALIDATION_FAILED",
  MISSING_BODY: "MISSING_BODY",
  INVALID_JSON: "INVALID_JSON",

  // Authorization
  FORBIDDEN: "FORBIDDEN",
  ROLE_INSUFFICIENT: "ROLE_INSUFFICIENT",

  // Not found / conflict
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  ALREADY_EXISTS: "ALREADY_EXISTS",

  // Admin / RBAC
  SUPER_ADMIN_REQUIRED: "SUPER_ADMIN_REQUIRED",
  COMPANY_ADMIN_REQUIRED: "COMPANY_ADMIN_REQUIRED",
  CANNOT_DEMOTE_SELF: "CANNOT_DEMOTE_SELF",
  ALREADY_MEMBER: "ALREADY_MEMBER",
  LAST_OWNER: "LAST_OWNER",
  ARCHIVED_WORKSPACE: "ARCHIVED_WORKSPACE",
  PLATFORM_ROLE_INVALID: "PLATFORM_ROLE_INVALID",

  // Server-side
  DB_ERROR: "DB_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/**
 * Map a TenantContextError code (from lib/tenant/context) to an API code.
 * Kept here (not in context.ts) to avoid a circular import: api depends
 * on tenant types, but tenant context doesn't need API types.
 */
export function tenantContextErrorToApiCode(
  code:
    | "AUTH_REQUIRED"
    | "COMPANY_MISMATCH"
    | "WORKSPACE_REQUIRED"
    | "WORKSPACE_FORBIDDEN",
): ApiErrorCode {
  // For now the codes happen to align. If we ever diverge, the mapping
  // lives here.
  return code as ApiErrorCode;
}