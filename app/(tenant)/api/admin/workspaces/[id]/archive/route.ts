/**
 * POST /api/admin/workspaces/[id]/archive — Toggle workspace archive status.
 *
 * Soft-archive via `archived_at`. Archived workspaces are hidden from
 * /w/<slug> resolution (proxy.ts checks archived_at) but their data is
 * preserved.
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireCompanyAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { extractRequestMeta, recordAuditEvent } from "@/lib/admin/audit";
import { getActiveContext } from "@/lib/tenant/context";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getActiveContext();
  const guard = await requireCompanyAdmin(ctx.company.id);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const service = createServiceClient();

  // Confirm the workspace belongs to this company (cross-tenant defense).
  const { data: ws, error: readErr } = await service
    .from("workspaces")
    .select("id, company_id, archived_at")
    .eq("id", id)
    .maybeSingle();
  if (readErr || !ws) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Workspace not found." } },
      { status: 404 },
    );
  }
  if (ws.company_id !== ctx.company.id) {
    return NextResponse.json(
      { ok: false, error: { code: "COMPANY_MISMATCH", message: "Workspace belongs to another company." } },
      { status: 403 },
    );
  }

  const willArchive = !ws.archived_at;
  const { error: updateErr } = await service
    .from("workspaces")
    .update({ archived_at: willArchive ? new Date().toISOString() : null })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json(
      { ok: false, error: { code: "DB_ERROR", message: updateErr.message } },
      { status: 500 },
    );
  }

  const meta = extractRequestMeta(request);
  await recordAuditEvent({
    actor: ctx.user,
    companyId: ctx.company.id,
    workspaceId: id,
    eventType: willArchive ? "workspace.archived" : "workspace.unarchived",
    payload: {},
    ...meta,
  });

  return NextResponse.json({ ok: true, data: { id, archived: willArchive } });
}