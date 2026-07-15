/**
 * lib/admin/audit.ts — Append-only audit log helper.
 *
 * Every admin endpoint that mutates data MUST call recordAuditEvent()
 * AFTER the mutation succeeds. The function returns nothing on success
 * and logs failures (but never throws to the caller — auditing should
 * not block the user's action).
 *
 * Why service_role: the audit_events table has no INSERT policy for
 * `authenticated` by design. Members must NOT be able to write audit
 * entries (else the log becomes useless). Only server-side admin code,
 * running as service_role, writes here.
 *
 * Pattern for callers:
 *
 *   const result = await performAdminMutation(...);
 *   if (!result.ok) return result.response;
 *
 *   await recordAuditEvent({
 *     actor: ctx.user,
 *     companyId: targetCompanyId,
 *     workspaceId: targetWorkspaceId,    // optional
 *     eventType: "member.role_changed",
 *     payload: {
 *       target_user_id: targetUserId,
 *       old_role: oldRole,
 *       new_role: newRole,
 *     },
 *   });
 *
 *   return ok(result.data);
 *
 * Reference: supabase/migrations/0006_admin_panel.sql (schema),
 * 0007_rls_admin.sql (policies).
 */

import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

export interface AuditEventInput {
  /** The user who performed the action. From `ctx.user`. */
  actor: { id: string; email: string | null };
  /** Tenant scope. NULL for platform-level events (cross-tenant). */
  companyId?: string | null;
  /** Workspace scope. NULL when the action is at company level. */
  workspaceId?: string | null;
  /**
   * lower_snake_case.dot.notation. Examples:
   *   company.created
   *   company.suspended
   *   company.unsuspended
   *   company.settings_updated
   *   workspace.created
   *   workspace.archived
   *   workspace.unarchived
   *   member.invited
   *   member.role_changed
   *   member.removed
   *   user.promoted_to_super_admin
   *   user.demoted_from_super_admin
   */
  eventType: string;
  /** Structured details. Keep small — IDs and diffs, not full payloads. */
  payload: Record<string, unknown>;
  /** Optional request metadata. */
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Record an audit event. Returns true on success, false on failure.
 * Never throws — the caller should not fail their action because the
 * audit log couldn't be written.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<boolean> {
  try {
    const service = createServiceClient();

    const { error } = await service.from("audit_events").insert({
      actor_user_id: input.actor.id,
      company_id: input.companyId ?? null,
      workspace_id: input.workspaceId ?? null,
      event_type: input.eventType,
      payload: input.payload,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    });

    if (error) {
      // Log server-side but don't throw. The audit log is critical but
      // losing an entry shouldn't fail the user's primary action.
      console.error(
        "[audit] Failed to write event",
        { eventType: input.eventType, error: error.message },
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("[audit] Unexpected error", e);
    return false;
  }
}

/**
 * Convenience: extract client IP and User-Agent from a Request. The
 * admin routes pass their incoming Request to this so the audit log
 * records who called the endpoint.
 */
export function extractRequestMeta(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  // x-forwarded-for is set by Vercel. The first entry is the client IP
  // when the chain is well-formed; we use that. If absent, leave NULL.
  const fwd = request.headers.get("x-forwarded-for");
  const ipAddress = fwd ? fwd.split(",")[0]?.trim() ?? null : null;
  const userAgent = request.headers.get("user-agent") ?? null;
  return { ipAddress, userAgent };
}