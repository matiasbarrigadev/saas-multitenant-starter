/**
 * POST /admin/api/companies/[id]/suspend — Toggle company suspension.
 *
 * Justification for service_role:
 *   - We need to write to companies.settings.suspended (a JSONB field)
 *     for any company, regardless of membership.
 *   - The route is gated by requireSuperAdmin() which checks the JWT's
 *     platform_role claim (server-controlled, cannot be forged by users).
 *
 * Body (form-encoded for native form submission, JSON for fetch):
 *   suspended: "true" | "false"
 *
 * Audit: writes a company.suspended or company.unsuspended event.
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireSuperAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { extractRequestMeta, recordAuditEvent } from "@/lib/admin/audit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  // Read body — accept both form-encoded and JSON.
  let suspended = true;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await request.json();
      suspended = Boolean(body.suspended);
    } catch {
      // default true if body missing
    }
  } else {
    const form = await request.formData();
    suspended = form.get("suspended") !== "false";
  }

  const service = createServiceClient();

  // Fetch existing settings to merge (don't clobber other keys).
  const { data: company, error: readErr } = await service
    .from("companies")
    .select("id, settings")
    .eq("id", id)
    .maybeSingle();
  if (readErr || !company) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Company not found." } },
      { status: 404 },
    );
  }

  const prev = (company.settings ?? {}) as Record<string, unknown>;
  const nextSettings = { ...prev, suspended };

  const { error: updateErr } = await service
    .from("companies")
    .update({ settings: nextSettings })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json(
      { ok: false, error: { code: "DB_ERROR", message: updateErr.message } },
      { status: 500 },
    );
  }

  const meta = extractRequestMeta(request);
  await recordAuditEvent({
    actor: guard.ctx.user,
    companyId: id,
    eventType: suspended ? "company.suspended" : "company.unsuspended",
    payload: {
      previous: prev.suspended ?? false,
      next: suspended,
    },
    ...meta,
  });

  // If form submission, redirect back to the company page.
  if (!contentType.includes("application/json")) {
    return NextResponse.redirect(
      new URL(`/admin/companies/${id}`, request.url),
    );
  }

  return NextResponse.json({
    ok: true,
    data: { companyId: id, suspended },
  });
}