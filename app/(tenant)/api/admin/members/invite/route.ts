/**
 * POST /api/admin/members/invite — Invite a user to a workspace.
 *
 * Creates a membership row for an existing user. If the user has never
 * signed in, this returns ALREADY_MEMBER_NOT_FOUND (NOT_FOUND) — the
 * invitee needs to sign in once via magic link so auth.users gets a row.
 *
 * Justification for service_role:
 *   - memberships has no INSERT policy for `authenticated`.
 *   - We need to look up the invitee across all companies (auth.users
 *     RLS doesn't apply, so we use service_role for the lookup too).
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
  email: z.string().email(),
  workspaceId: z.string().uuid(),
  role: z.enum(["admin", "member"]).default("member"),
});

export const POST = withApi(async (request) => {
  const ctx = await getActiveContext();
  const guard = await requireCompanyAdmin(ctx.company.id);
  if (!guard.ok) return guard.response;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return err(
      ApiErrorCode.VALIDATION_FAILED,
      "Body must be { email, workspaceId, role: 'admin'|'member' }.",
    );
  }

  const service = createServiceClient();

  // Confirm workspace belongs to this company.
  const { data: ws, error: wsErr } = await service
    .from("workspaces")
    .select("id, company_id")
    .eq("id", body.workspaceId)
    .maybeSingle();
  if (wsErr || !ws) {
    return err(ApiErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found.");
  }
  if (ws.company_id !== ctx.company.id) {
    return err(
      ApiErrorCode.COMPANY_MISMATCH,
      "Workspace belongs to another company.",
    );
  }

  // Look up the invitee. Supabase's admin.listUsers doesn't support
  // email filter directly; we fetch the first page (default 50) and
  // match in code. For larger user bases add a dedicated lookup.
  const { data: userList } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
  const invitee = userList?.users?.find(
    (u) => u.email?.toLowerCase() === body.email.toLowerCase(),
  );
  if (!invitee) {
    return err(
      ApiErrorCode.NOT_FOUND,
      "Invitee has no account yet. Ask them to sign in once.",
    );
  }

  // Check not already a member.
  const { data: existing } = await service
    .from("memberships")
    .select("id")
    .eq("workspace_id", body.workspaceId)
    .eq("user_id", invitee.id)
    .maybeSingle();
  if (existing) {
    return err(
      ApiErrorCode.ALREADY_MEMBER,
      "This user is already a member of this workspace.",
    );
  }

  const { data, error } = await service
    .from("memberships")
    .insert({
      workspace_id: body.workspaceId,
      company_id: ctx.company.id,
      user_id: invitee.id,
      role: body.role,
    })
    .select()
    .single();
  if (error) {
    return err(ApiErrorCode.DB_ERROR, error.message);
  }

  const meta = extractRequestMeta(request);
  await recordAuditEvent({
    actor: ctx.user,
    companyId: ctx.company.id,
    workspaceId: body.workspaceId,
    eventType: "member.invited",
    payload: {
      invited_email: body.email,
      role: body.role,
    },
    ...meta,
  });

  return ok(data, { status: 201 });
});