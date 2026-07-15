/**
 * GET /admin/api/audit — List audit events.
 *
 * Justification for service_role:
 *   - The query is filtered by RLS, but super_admin needs to see ALL
 *     events across ALL companies for incident investigation.
 *   - For non-super_admin requests this endpoint should be hidden by the
 *     route group — guard enforces that.
 *
 * Query params (all optional):
 *   company_id:    filter to one company
 *   event_type:    exact-match filter
 *   since:         ISO timestamp; only events after this time
 *   limit:         default 100, max 500
 */

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";

import { requireSuperAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export const GET = withApi(async (request: Request) => {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const companyId = url.searchParams.get("company_id");
  const eventType = url.searchParams.get("event_type");
  const since = url.searchParams.get("since");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(limitRaw ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );

  if (since && Number.isNaN(Date.parse(since))) {
    return err(ApiErrorCode.VALIDATION_FAILED, "`since` must be an ISO timestamp.");
  }

  const service = createServiceClient();

  let query = service
    .from("audit_events")
    .select(
      "id, actor_user_id, company_id, workspace_id, event_type, payload, ip_address, user_agent, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (companyId) query = query.eq("company_id", companyId);
  if (eventType) query = query.eq("event_type", eventType);
  if (since) query = query.gt("created_at", since);

  const { data, error } = await query;
  if (error) {
    return err(ApiErrorCode.DB_ERROR, error.message);
  }

  return ok(data ?? [], { meta: { count: data?.length ?? 0 } });
});