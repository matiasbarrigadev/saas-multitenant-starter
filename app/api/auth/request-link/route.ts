/**
 * POST /api/auth/request-link — start the magic-link sign-in flow.
 *
 * Body: { email: string }
 * Returns: { ok: true, data: { sent: true } } on success.
 *
 * We deliberately DO NOT reveal whether the email exists. Both "sent" and
 * "user doesn't exist" return the same response. This prevents account
 * enumeration.
 *
 * Why a separate route handler and not a server action:
 *   - Easier to test (curl from any client).
 *   - Documented API surface for non-Next.js clients (mobile apps, etc.).
 *   - Easier rate-limiting at the edge.
 */

import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { ok, warn } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { parseHost, buildAbsoluteUrl } from "@/lib/tenant/host";
import { env } from "@/lib/env";

const RequestBody = z.object({
  email: z.string().email("A valid email is required."),
  /** Optional override for where to redirect after sign-in. */
  next: z.string().optional(),
});

export const POST = withApi(async (request) => {
  let body: z.infer<typeof RequestBody>;
  try {
    const json = await request.json();
    body = RequestBody.parse(json);
  } catch {
    return {
      ok: false,
      error: {
        code: ApiErrorCode.VALIDATION_FAILED,
        message: "Body must be JSON with a valid email.",
      },
      requestId: "validation",
    };
  }

  const supabase = await createClient();

  // Build the emailRedirectTo so it points at /auth/callback on the
  // SAME subdomain (so cookies scope correctly). For local dev with
  // /etc/hosts entries like 127.0.0.1 acme.tuapp.local, this matters.
  const host = parseHost(request.headers.get("host"));
  const redirectTo = buildAbsoluteUrl(
    host.companySlug,
    `/auth/callback${body.next ? `?next=${encodeURIComponent(body.next)}` : ""}`,
  );

  const { error } = await supabase.auth.signInWithOtp({
    email: body.email,
    options: {
      emailRedirectTo: redirectTo,
      // For local dev with Inbucket, this just works. In production,
      // Supabase uses your configured email templates.
      shouldCreateUser: true,
    },
  });

  if (error) {
    // Rate limiting surfaces as a Supabase Auth error. Treat it as a
    // warning, not a failure, so the UI can show a friendly retry hint.
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return warn(
        { sent: false },
        {
          code: "RATE_LIMITED",
          message: "Too many requests. Try again in a minute.",
        },
      );
    }

    // Don't leak the specific Supabase error to the client. Log it.
    console.error("[api/auth/request-link] signInWithOtp failed:", error);
    return {
      ok: false,
      error: {
        code: ApiErrorCode.UPSTREAM_ERROR,
        message: "Could not send sign-in email. Try again shortly.",
      },
      requestId: "upstream",
    };
  }

  return ok({ sent: true });
});

// Note: this endpoint intentionally returns 200 in both "email sent" and
// "user does not exist" cases, so attackers can't enumerate accounts.
// The frontend just shows "Check your inbox".