/**
 * PATCH /api/admin/company — Update the active company's name.
 *
 * Owner-only (gate enforced by requireCompanyOwner).
 *
 * Justification for service_role:
 *   - companies has no UPDATE policy for `authenticated` (only service_role
 *     writes to it; see 0002_rls_policies.sql).
 *   - Guard before bypass: requireCompanyOwner() verified the caller is
 *     super_admin OR has 'owner' role in this company.
 */

import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";

import { requireCompanyOwner } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { extractRequestMeta, recordAuditEvent } from "@/lib/admin/audit";
import { getActiveContext } from "@/lib/tenant/context";

const Body = z.object({
  name: z.string().min(1).max(120).optional(),
});

export const PATCH = withApi(async (request) => {
  const ctx = await getActiveContext();
  const guard = await requireCompanyOwner(ctx.company.id);
  if (!guard.ok) return guard.response;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return err(
      ApiErrorCode.VALIDATION_FAILED,
      "Body must be { name?: string }.",
    );
  }
  if (body.name === undefined) {
    return err(ApiErrorCode.VALIDATION_FAILED, "No fields to update.");
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("companies")
    .update({ name: body.name })
    .eq("id", ctx.company.id)
    .select()
    .single();
  if (error) {
    return err(ApiErrorCode.DB_ERROR, error.message);
  }

  const meta = extractRequestMeta(request);
  await recordAuditEvent({
    actor: ctx.user,
    companyId: ctx.company.id,
    eventType: "company.settings_updated",
    payload: { changed_fields: ["name"] },
    ...meta,
  });

  return ok(data);
});