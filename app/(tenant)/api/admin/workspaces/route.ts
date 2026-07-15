/**
 * POST /api/admin/workspaces — Create a new workspace in the active company.
 *
 * Justification for service_role:
 *   - workspaces has no INSERT policy for `authenticated` (see 0002).
 *   - Guard before bypass: requireCompanyAdmin() verified the caller.
 */

import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";

import { requireCompanyAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { extractRequestMeta, recordAuditEvent } from "@/lib/admin/audit";
import { getActiveContext } from "@/lib/tenant/context";

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const Body = z.object({
  slug: z.string().regex(SLUG_RE, "Slug must match /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/"),
  name: z.string().min(1).max(120),
});

export const POST = withApi(async (request) => {
  const ctx = await getActiveContext();
  const guard = await requireCompanyAdmin(ctx.company.id);
  if (!guard.ok) return guard.response;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    return err(
      ApiErrorCode.VALIDATION_FAILED,
      "Body must be { slug: string (kebab-case), name: string }.",
    );
  }

  const service = createServiceClient();

  // Check for slug collision within the company.
  const { data: existing } = await service
    .from("workspaces")
    .select("id, archived_at")
    .eq("company_id", ctx.company.id)
    .eq("slug", body.slug)
    .maybeSingle();
  if (existing && !existing.archived_at) {
    return err(
      ApiErrorCode.ALREADY_EXISTS,
      `Workspace slug '${body.slug}' already exists in this company.`,
    );
  }

  const { data, error } = await service
    .from("workspaces")
    .insert({
      company_id: ctx.company.id,
      slug: body.slug,
      name: body.name,
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
    workspaceId: data.id,
    eventType: "workspace.created",
    payload: { slug: body.slug, name: body.name },
    ...meta,
  });

  return ok(data, { status: 201 });
});