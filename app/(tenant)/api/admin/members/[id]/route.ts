/**
 * DELETE /api/admin/members/[id] — Remove a membership.
 *
 * Validations:
 *   - Cannot remove yourself if you're an owner (LAST_OWNER).
 *   - Cannot remove yourself globally via requireCompanyAdmin guard
 *     (you still have the role, but the last-owner check protects).
 */

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";

import { requireCompanyAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { extractRequestMeta, recordAuditEvent } from "@/lib/admin/audit";
import { getActiveContext } from "@/lib/tenant/context";

export const DELETE = withApi(async (request) => {
  const ctx = await getActiveContext();
  const guard = await requireCompanyAdmin(ctx.company.id);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  // /api/admin/members/[id] -> [id] is index 4
  const membershipId = url.pathname.split("/")[4];
  if (!membershipId) {
    return err(ApiErrorCode.VALIDATION_FAILED, "Missing membership id.");
  }

  const service = createServiceClient();

  const { data: target, error: tErr } = await service
    .from("memberships")
    .select("id, company_id, user_id, workspace_id, role")
    .eq("id", membershipId)
    .maybeSingle();
  if (tErr || !target) {
    return err(ApiErrorCode.NOT_FOUND, "Membership not found.");
  }
  if (target.company_id !== ctx.company.id) {
    return err(
      ApiErrorCode.COMPANY_MISMATCH,
      "Membership belongs to another company.",
    );
  }

  // Last-owner check: if we're removing an owner, ensure at least one
  // other owner remains in this workspace.
  if (target.role === "owner") {
    const { data: owners, error: oErr } = await service
      .from("memberships")
      .select("id")
      .eq("workspace_id", target.workspace_id)
      .eq("role", "owner");
    if (oErr) return err(ApiErrorCode.DB_ERROR, oErr.message);
    if ((owners ?? []).length <= 1) {
      return err(
        ApiErrorCode.LAST_OWNER,
        "Cannot remove the last owner of a workspace.",
      );
    }
  }

  const { error } = await service
    .from("memberships")
    .delete()
    .eq("id", membershipId);
  if (error) {
    return err(ApiErrorCode.DB_ERROR, error.message);
  }

  const meta = extractRequestMeta(request);
  await recordAuditEvent({
    actor: ctx.user,
    companyId: ctx.company.id,
    workspaceId: target.workspace_id,
    eventType: "member.removed",
    payload: {
      target_user_id: target.user_id,
      role_at_removal: target.role,
    },
    ...meta,
  });

  return ok({ id: membershipId });
});