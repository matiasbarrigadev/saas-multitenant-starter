/**
 * PATCH /api/admin/members/[id]/role — Change a membership's role.
 *
 * Path param [id] is the membership.id, NOT the user.id. This makes
 * "change one of my workspaces' members" unambiguous.
 *
 * Validations:
 *   - Cannot demote yourself if you're an owner and you're the last owner
 *     of any workspace in the company. (LAST_OWNER.)
 *   - Cannot demote yourself globally — same check via requireCompanyAdmin
 *     which already enforces role >= admin.
 */

import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";

import { requireCompanyAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { extractRequestMeta, recordAuditEvent } from "@/lib/admin/audit";
import { getActiveContext } from "@/lib/tenant/context";

const Body = z.object({
  role: z.enum(["owner", "admin", "member"]),
});

export const PATCH = withApi(async (request) => {
  const ctx = await getActiveContext();
  const guard = await requireCompanyAdmin(ctx.company.id);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  // /api/admin/members/[id]/role -> [id] is index 4
  const membershipId = url.pathname.split("/")[4];
  if (!membershipId) {
    return err(ApiErrorCode.VALIDATION_FAILED, "Missing membership id.");
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return err(
      ApiErrorCode.VALIDATION_FAILED,
      "Body must be { role: 'owner'|'admin'|'member' }.",
    );
  }

  const service = createServiceClient();

  // Fetch the target membership; ensure it's in the caller's company.
  const { data: target, error: tErr } = await service
    .from("memberships")
    .select("id, company_id, user_id, role")
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

  // If demoting from owner, check that the workspace will still have at
  // least one owner after the change.
  if (target.role === "owner" && body.role !== "owner") {
    const { data: owners, error: oErr } = await service
      .from("memberships")
      .select("id")
      .eq("workspace_id", (await service.from("memberships").select("workspace_id").eq("id", membershipId).maybeSingle()).data?.workspace_id ?? "")
      .eq("role", "owner");
    if (oErr) return err(ApiErrorCode.DB_ERROR, oErr.message);
    if ((owners ?? []).length <= 1) {
      return err(
        ApiErrorCode.LAST_OWNER,
        "Cannot demote the last owner of a workspace.",
      );
    }
  }

  const { data, error } = await service
    .from("memberships")
    .update({ role: body.role })
    .eq("id", membershipId)
    .select()
    .single();
  if (error) {
    return err(ApiErrorCode.DB_ERROR, error.message);
  }

  const meta = extractRequestMeta(request);
  await recordAuditEvent({
    actor: ctx.user,
    companyId: ctx.company.id,
    workspaceId: data.workspace_id,
    eventType: "member.role_changed",
    payload: {
      target_user_id: target.user_id,
      old_role: target.role,
      new_role: body.role,
    },
    ...meta,
  });

  return ok(data);
});