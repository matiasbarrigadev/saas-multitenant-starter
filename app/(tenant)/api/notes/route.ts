/**
 * GET /api/notes   — list the most recent notes in the active workspace.
 * POST /api/notes  — create a new note in the active workspace.
 *
 * Both rely entirely on RLS for tenancy:
 *   - GET returns rows where workspace_id = current_workspace_id().
 *   - POST inserts with workspace_id = current_workspace_id() and
 *     author_id = auth.uid() (enforced by the policy in 0005_notes).
 *
 * If the user has no active workspace in their JWT, getActiveContext
 * throws TenantContextError.WORKSPACE_REQUIRED, which withApi maps to a
 * uniform 403 response.
 */

import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, err } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";

export const GET = withApi(async () => {
  const ctx = await getActiveContext();
  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("notes")
    .select("id, title, body, author_id, created_at, updated_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[api/notes GET] DB error:", error);
    return err(ApiErrorCode.DB_ERROR, "Could not load notes.");
  }

  return ok(data ?? [], { meta: { count: count ?? data?.length ?? 0 } });
});

const CreateBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(10_000).default(""),
});

export const POST = withApi(async (request) => {
  const ctx = await getActiveContext();
  const supabase = await createClient();

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await request.json());
  } catch {
    return err(
      ApiErrorCode.VALIDATION_FAILED,
      "Body must be { title: string (1-200), body?: string }.",
    );
  }

  const { data, error } = await supabase
    .from("notes")
    .insert({
      workspace_id: ctx.workspace.id,
      author_id: ctx.user.id,
      title: body.title,
      body: body.body,
    })
    .select()
    .single();

  if (error) {
    // RLS rejects -> 403-ish (RLS errors come through as 401/403 from PostgREST).
    if (error.code === "42501" /* insufficient_privilege */) {
      return err(
        ApiErrorCode.WORKSPACE_FORBIDDEN,
        "Cannot create notes in this workspace.",
      );
    }
    console.error("[api/notes POST] DB error:", error);
    return err(ApiErrorCode.DB_ERROR, "Could not create note.");
  }

  return ok(data, { status: 201 });
});