/**
 * POST /admin/api/users/[id]/promote — Toggle super_admin on a user.
 *
 * Justification for service_role:
 *   - We update auth.users.raw_app_meta_data, which is server-controlled
 *     and requires admin privileges. Regular users cannot write here
 *     even if they had a magic-link role.
 *   - The change has immediate security implications (the user becomes
 *     a platform operator on their next sign-in). Guard before bypass:
 *     requireSuperAdmin() ensures the caller is already a super_admin.
 *
 * Body:
 *   platform_role: "super_admin" to grant, "" or null to revoke
 *
 * Critical: a super_admin CANNOT revoke their own platform_role.
 * Self-demotion is blocked server-side.
 *
 * Audit: writes user.promoted_to_super_admin or user.demoted_from_super_admin.
 */

import { ApiErrorCode } from "@/lib/api/errors";
import { err, ok } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";

import { requireSuperAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { extractRequestMeta, recordAuditEvent } from "@/lib/admin/audit";

export const POST = withApi(
  async (request: Request, _ctx) => {
    const guard = await requireSuperAdmin();
    if (!guard.ok) return guard.response;

    // The URL has the target user id; the path is /admin/api/users/[id]/promote.
    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    // .../admin/api/users/[id]/promote  -> index 5 is [id]
    const targetUserId = segments[5];
    if (!targetUserId) {
      return err(ApiErrorCode.VALIDATION_FAILED, "Missing user id.");
    }

    // Read body.
    let platformRole: string | null;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = await request.json();
        platformRole = body.platform_role ?? null;
      } catch {
        platformRole = null;
      }
    } else {
      const form = await request.formData();
      platformRole = (form.get("platform_role") as string | null) ?? null;
    }

    // Normalize: empty string means revoke.
    const granting = platformRole === "super_admin";
    const revoking = !granting;

    // Self-demotion block.
    if (revoking && targetUserId === guard.ctx.user.id) {
      return err(
        ApiErrorCode.CANNOT_DEMOTE_SELF,
        "You cannot revoke your own super_admin role.",
      );
    }

    const service = createServiceClient();

    // Read current to preserve any other fields.
    const { data: target, error: readErr } = await service.auth.admin.getUserById(targetUserId);
    if (readErr || !target?.user) {
      return err(ApiErrorCode.NOT_FOUND, "User not found.");
    }
    const prevRaw = (target.user.app_metadata ?? {}) as Record<string, unknown>;
    const nextRaw = granting
      ? { ...prevRaw, platform_role: "super_admin" }
      : Object.fromEntries(
          Object.entries(prevRaw).filter(([k]) => k !== "platform_role"),
        );

    const { error: updateErr } = await service.auth.admin.updateUserById(
      targetUserId,
      { app_metadata: nextRaw },
    );
    if (updateErr) {
      return err(ApiErrorCode.DB_ERROR, updateErr.message);
    }

    const meta = extractRequestMeta(request);
    await recordAuditEvent({
      actor: guard.ctx.user,
      companyId: null,
      eventType: granting
        ? "user.promoted_to_super_admin"
        : "user.demoted_from_super_admin",
      payload: {
        target_user_id: targetUserId,
        target_email: target.user.email,
      },
      ...meta,
    });

    return ok({
      userId: targetUserId,
      platformRole: granting ? "super_admin" : null,
    });
  },
);