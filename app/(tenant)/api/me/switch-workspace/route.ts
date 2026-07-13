/**
 * POST /api/me/switch-workspace — change the user's active workspace.
 *
 * Body: { workspaceId: string }
 * Effect: updates the user's `app_metadata.active_*` fields, which causes
 *         the custom_access_token_hook to stamp those values into the next
 *         JWT issued. The endpoint then refreshes the session so the
 *         caller immediately sees the new active workspace.
 *
 * IMPORTANT: this endpoint uses the SERVICE ROLE client to update
 * app_metadata. Regular users are not allowed to set arbitrary fields
 * in their own app_metadata (that's a security control), so we go
 * through the admin API. The membership check ensures the user
 * actually has access to the requested workspace.
 */

import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const RequestBody = z.object({
  workspaceId: z.string().uuid("workspaceId must be a UUID."),
});

export const POST = withApi(async (request) => {
  // 1. Validate the body.
  let body: z.infer<typeof RequestBody>;
  try {
    body = RequestBody.parse(await request.json());
  } catch {
    return err(ApiErrorCode.VALIDATION_FAILED, "Body must be { workspaceId: uuid }.");
  }

  // 2. Confirm the caller has a valid session.
  const ctx = await getActiveContext();

  // 3. Look up the workspace and verify the user is a member.
  // We use the regular server client — RLS lets us see workspaces in our
  // active company. We also check that the workspace belongs to a company
  // the user has access to (membership in any workspace of the company).
  const supabase = await createClient();
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, slug, company_id, name")
    .eq("id", body.workspaceId)
    .maybeSingle();

  if (workspaceError || !workspace) {
    return err(
      ApiErrorCode.WORKSPACE_NOT_FOUND,
      "Workspace not found.",
    );
  }

  // Cross-tenant defense: the workspace's company must be in the user's
  // membership list. Even though RLS already protects the read, this
  // belt-and-suspenders check avoids a tiny edge case where the user
  // happened to have a JWT with a different active_company_id than the
  // one the workspace actually belongs to.
  const membership = ctx.memberships.find(
    (m) => m.workspace_id === body.workspaceId,
  );
  if (!membership) {
    return err(
      ApiErrorCode.WORKSPACE_FORBIDDEN,
      "You don't have access to that workspace.",
    );
  }

  // 4. Update app_metadata via service role. This requires bypassing RLS
  // because regular users can't write to their own app_metadata directly.
  //
  // Why this is safe: we just verified the membership above. The user
  // is asking to switch to a workspace they have access to.
  const service = createServiceClient();
  const { error: updateError } = await service.auth.admin.updateUserById(
    ctx.user.id,
    {
      app_metadata: {
        // Preserve existing app_metadata fields (company_memberships is
        // refreshed by the hook, but we need to keep token_version if
        // we ever introduce forced-logout).
        active_company_id: workspace.company_id,
        active_workspace_id: workspace.id,
        active_role: membership.role,
        active_workspace_slug: workspace.slug,
      },
    },
  );

  if (updateError) {
    console.error(
      "[api/me/switch-workspace] updateUserById failed:",
      updateError,
    );
    return err(
      ApiErrorCode.DB_ERROR,
      "Could not update active workspace.",
    );
  }

  // 5. Refresh the session so the user's next request sees the new
  // active_* values. We do this by calling getClaims again — the
  // underlying @supabase/ssr client refreshes tokens automatically
  // when they're stale. If the token was just refreshed, the next
  // getClaims will return the new claims.
  //
  // For an immediate update we call refreshSession, which writes fresh
  // cookies via setAll.
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    // Non-fatal: the new active_* will take effect on the next natural
    // token refresh (within ~1h). We warn but don't fail.
    console.warn(
      "[api/me/switch-workspace] refreshSession warning:",
      refreshError,
    );
  }

  return ok({
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      company_id: workspace.company_id,
    },
    role: membership.role,
  });
});