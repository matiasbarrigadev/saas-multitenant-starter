/**
 * GET /api/me — current user + active tenant context.
 *
 * Use this as the "who am I" endpoint for client components that need
 * to know the user's active workspace, role, and membership list.
 *
 * The data comes from the JWT (claims.app_metadata), NOT a fresh DB
 * query, so this endpoint is essentially free and safe to call often.
 */

import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";

export const GET = withApi(async () => {
  const ctx = await getActiveContext();

  // Profile lookup uses the regular server client (RLS allows reading
  // your own profile).
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url")
    .eq("id", ctx.user.id)
    .maybeSingle();

  return ok({
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      profile: profile ?? null,
    },
    company: ctx.company,
    workspace: ctx.workspace,
    role: ctx.role,
    memberships: ctx.memberships,
  });
});