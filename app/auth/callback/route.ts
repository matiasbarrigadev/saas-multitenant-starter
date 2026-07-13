/**
 * Magic-link callback handler.
 *
 * Flow:
 *   1. User submits email on /login.
 *   2. Supabase sends an email with a link containing `?code=...`.
 *   3. User clicks. Browser hits this route.
 *   4. We exchange the code for a session (Supabase sets cookies via setAll).
 *   5. We look at the user's memberships in the JWT to find their first
 *      company + workspace.
 *   6. We redirect to the appropriate subdomain + path.
 *
 * Errors:
 *   - Missing code: redirect to /login with an error param.
 *   - Code exchange fails: redirect to /login with an error param.
 *   - User has no memberships: redirect to /onboarding (placeholder).
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { parseHost, buildAbsoluteUrl } from "@/lib/tenant/host";
import { env } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(buildLoginRedirect(origin, "missing_code"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error);
    return NextResponse.redirect(buildLoginRedirect(origin, "exchange_failed"));
  }

  // Session is set. Read claims to find the user's first membership.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims) {
    return NextResponse.redirect(buildLoginRedirect(origin, "no_claims"));
  }

  const claims = claimsData.claims as {
    sub: string;
    app_metadata?: Record<string, unknown>;
  };
  const memberships = (claims.app_metadata?.company_memberships as Array<{
    company_slug: string;
    workspace_slug: string;
  }>) ?? [];

  // If the user already has an active workspace, honor it (rare path:
  // they were mid-session and re-confirmed).
  const activeCompanyId = claims.app_metadata?.active_company_id as
    | string
    | undefined;
  const activeWorkspaceSlug = claims.app_metadata?.active_workspace_slug as
    | string
    | undefined;

  // Pick the destination: prefer ?next= if it's same-origin and safe.
  const host = parseHost(request.headers.get("host"));
  if (nextParam && isSafeNext(nextParam)) {
    return NextResponse.redirect(new URL(nextParam, request.url));
  }

  // If the user already has active_company_id set in JWT, redirect to
  // that company's subdomain + workspace.
  if (activeCompanyId && activeWorkspaceSlug) {
    const targetMember = memberships.find(
      (m) => m.workspace_slug === activeWorkspaceSlug,
    );
    if (targetMember) {
      const target = buildAbsoluteUrl(
        targetMember.company_slug,
        `/w/${targetMember.workspace_slug}/dashboard`,
      );
      return NextResponse.redirect(target);
    }
  }

  // Otherwise: pick the first membership.
  const first = memberships[0];
  if (first) {
    const target = buildAbsoluteUrl(
      first.company_slug,
      `/w/${first.workspace_slug}/dashboard`,
    );
    return NextResponse.redirect(target);
  }

  // User has no memberships yet -> onboarding placeholder.
  const onboardingUrl = host.companySlug
    ? buildAbsoluteUrl(host.companySlug, "/onboarding")
    : `${origin}/onboarding`;
  return NextResponse.redirect(onboardingUrl);
}

/**
 * Build a redirect URL to the login page, staying on the same subdomain.
 */
function buildLoginRedirect(origin: string, reason: string): URL {
  const params = new URLSearchParams({ error: reason });
  return new URL(`/login?${params.toString()}`, origin);
}

/**
 * Defense against open-redirect: only allow same-origin paths.
 */
function isSafeNext(next: string): boolean {
  // Must start with "/" and not "//" (which would be a protocol-relative URL).
  return next.startsWith("/") && !next.startsWith("//");
}