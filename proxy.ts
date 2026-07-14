/**
 * proxy.ts — Next.js 16's renamed middleware.ts.
 *
 * Runs on the Edge runtime BEFORE every request that matches the matcher
 * config at the bottom of this file. Responsibilities:
 *
 *   1. Resolve the company from the Host header (subdomain -> company slug).
 *   2. Resolve the workspace from the path (/w/:slug).
 *   3. Refresh the Supabase auth session (calls getClaims, writes cookies
 *      via setAll, applies no-store cache headers).
 *   4. For protected routes: enforce that the user has a valid session,
 *      that the JWT's active company matches the Host's company, and that
 *      the workspace in the URL belongs to that company and the user.
 *   5. Inject x-company-id and x-workspace-id headers so RSC/Routes can
 *      read the validated tenant without re-parsing.
 *
 * What this file does NOT do:
 *   - It does NOT mutate app_metadata. That's /api/me/switch-workspace.
 *   - It does NOT create sessions. That's /api/auth/request-link +
 *     /auth/callback.
 *   - It does NOT touch cookies beyond auth refresh. Anything else (e.g.
 *     theme cookie) lives elsewhere.
 *
 * Edge Runtime caveats (per the deep research):
 *   - No Node APIs, no filesystem.
 *   - We only import what's edge-compatible: next/server, @supabase/ssr,
 *     zod, and our own pure-TS modules.
 *   - Database calls would NOT work here. We only do cookie/JWT math.
 *   - Validation of the workspace_slug against the DB happens in the RSC
 *     layout, not here, because the DB is on Node runtime.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

import { env } from "@/lib/env";
import { parseHost, buildAbsoluteUrl } from "@/lib/tenant/host";

/**
 * Shape of each entry passed to `setAll` by @supabase/ssr. Pinning it
 * here keeps the callback strongly-typed.
 */
type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Routes that are accessible WITHOUT auth. Anything else requires a valid
 * Supabase session. Keep this list conservative.
 */
const PUBLIC_PATH_PREFIXES = [
  "/",
  "/login",
  "/auth/callback",
  "/auth/confirm",
  "/onboarding",
  "/api/auth/request-link",
];

/**
 * Files we never want to touch. Static assets pass through unmodified.
 */
function isPublicPath(pathname: string): boolean {
  // Exact root or one of the public prefixes.
  if (pathname === "/") return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/favicon")) return true;
  if (pathname.startsWith("/public/")) return true;
  if (pathname.match(/\.(ico|png|jpg|jpeg|svg|gif|webp|css|js|map|woff2?)$/)) return true;

  return PUBLIC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/**
 * Parse `/w/:slug` from the pathname. We do this in proxy.ts (not via
 * resolve-workspace.ts) because Edge can't reach the DB.
 */
function parseWorkspaceFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/w\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\/|$)/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

/**
 * Build the login URL with ?next= so the user comes back to where they were.
 * Stays on the same subdomain so cookies scope correctly.
 */
function buildLoginUrl(host: ReturnType<typeof parseHost>, nextPath: string): URL {
  const params = new URLSearchParams({ next: nextPath });
  const hostName = host.companySlug
    ? `${host.companySlug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}`
    : env.NEXT_PUBLIC_ROOT_DOMAIN;
  // Preserve the port for local dev (e.g. :3000).
  const hostWithPort = host.port ? `${hostName}:${host.port}` : hostName;
  return new URL(
    `${env.NEXT_PUBLIC_APP_SCHEME}://${hostWithPort}/login?${params.toString()}`,
  );
}

/**
 * Build a "company not found" page URL. We can't return a custom error page
 * from the Edge runtime easily, so we redirect to the apex domain which
 * renders a generic "this subdomain doesn't exist" page.
 */
function buildCompanyNotFoundUrl(host: ReturnType<typeof parseHost>): URL {
  const hostName = host.port
    ? `${env.NEXT_PUBLIC_ROOT_DOMAIN}:${host.port}`
    : env.NEXT_PUBLIC_ROOT_DOMAIN;
  return new URL(
    `${env.NEXT_PUBLIC_APP_SCHEME}://${hostName}/?company_not_found=${host.companySlug ?? ""}`,
  );
}

/**
 * Main proxy function.
 */
export async function proxy(request: NextRequest) {
  const { nextUrl } = request;
  const pathname = nextUrl.pathname;
  const host = parseHost(request.headers.get("host"));

  // -- Public paths: pass through with no-store headers.
  if (isPublicPath(pathname)) {
    const res = NextResponse.next({ request });
    applyNoStore(res);
    return res;
  }

  // -- Apex domain (tuapp.com itself): pass through.
  //    Public marketing pages don't need auth. Only do the no-store dance
  //    for paths that look like they might be authenticated (anything
  //    inside /w/ for example).
  if (!host.companySlug && !host.isPreview) {
    const res = NextResponse.next({ request });
    // Only mark no-store for /w/* on apex (rare but possible if the user
    // navigates to apex/w/foo). For /, /login, etc. leave caching alone.
    if (pathname.startsWith("/w/")) {
      applyNoStore(res);
    }
    return res;
  }

  // -- From here on, we're on a subdomain (acme.tuapp.local) or a
  //    preview deployment. We need a valid Supabase session.

  // Create a response object we can mutate for cookie forwarding.
  let response = NextResponse.next({ request });

  // Create a Supabase client wired to the request/response cookies.
  // `setAll` receives cookies from getClaims() and writes them back.
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          // Write to BOTH the incoming request (so the rest of this
          // function sees refreshed cookies) and the outgoing response
          // (so the browser persists them).
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Validate / refresh the session. getClaims() reads the JWT, validates
  // its signature, and (if expired) triggers a refresh. The refresh writes
  // new cookies via setAll above.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims) {
    // Not signed in (or session invalid). Redirect to login on the SAME
    // subdomain so cookies scope correctly after they sign in.
    const loginUrl = buildLoginUrl(host, pathname + nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const claims = claimsData.claims as {
    sub: string;
    email?: string;
    app_metadata?: Record<string, unknown>;
  };
  const appMetadata = claims.app_metadata ?? {};
  const activeCompanyId = appMetadata.active_company_id as string | undefined;
  const activeWorkspaceId = appMetadata.active_workspace_id as string | undefined;
  const memberships = (appMetadata.company_memberships as Array<{
    company_id: string;
    company_slug: string;
    workspace_id: string;
    workspace_slug: string;
    role: string;
  }>) ?? [];

  // -- Validate that the user has access to the company of the current host.
  if (host.companySlug) {
    const companyMatch = memberships.find(
      (m) => m.company_slug === host.companySlug,
    );
    if (!companyMatch) {
      // User is signed in, but their session has no membership in this
      // company. Redirect to the apex to avoid leaking info about
      // subdomain existence.
      return NextResponse.redirect(buildCompanyNotFoundUrl(host));
    }
    // Forward the company_id so server-side code can skip re-parsing.
    response.headers.set("x-company-id", companyMatch.company_id);
    response.headers.set("x-company-slug", companyMatch.company_slug);

    // -- Validate that the path's /w/:slug matches a real workspace
    //    in this company AND that the user's active workspace either
    //    IS that workspace OR they have a membership in it.
    const requestedWorkspaceSlug = parseWorkspaceFromPath(pathname);
    if (requestedWorkspaceSlug) {
      const workspaceInCompany = memberships.find(
        (m) =>
          m.company_slug === host.companySlug &&
          m.workspace_slug === requestedWorkspaceSlug,
      );
      if (!workspaceInCompany) {
        // Path asks for /w/<slug> but the user has no membership in any
        // workspace with that slug in this company.
        // 404-style response. We redirect to the dashboard of their active
        // workspace (or to /login if they have none).
        const fallback = memberships.find(
          (m) => m.company_slug === host.companySlug,
        );
        const fallbackUrl = fallback
          ? buildAbsoluteUrl(
              host.companySlug,
              `/w/${fallback.workspace_slug}/dashboard`,
              env.NEXT_PUBLIC_ROOT_DOMAIN,
              env.NEXT_PUBLIC_APP_SCHEME,
            )
          : buildLoginUrl(host, pathname + nextUrl.search).toString();
        return NextResponse.redirect(new URL(fallbackUrl));
      }
      // If the requested workspace differs from the active one, we still
      // allow access (membership check passed). The page may decide to
      // sync the active workspace via /api/me/switch-workspace.
      response.headers.set("x-workspace-id", workspaceInCompany.workspace_id);
      response.headers.set("x-workspace-slug", workspaceInCompany.workspace_slug);
    } else {
      // Path is inside the company but not /w/<slug> (e.g. /settings, /api/...)
      // We require that the user has an active workspace. If they don't,
      // force them to pick one.
      if (!activeWorkspaceId) {
        const firstMembership = memberships.find(
          (m) => m.company_slug === host.companySlug,
        );
        if (firstMembership) {
          const targetUrl = buildAbsoluteUrl(
            host.companySlug,
            `/w/${firstMembership.workspace_slug}/dashboard`,
            env.NEXT_PUBLIC_ROOT_DOMAIN,
            env.NEXT_PUBLIC_APP_SCHEME,
          );
          return NextResponse.redirect(new URL(targetUrl));
        }
        // No memberships at all -> onboarding or login.
        return NextResponse.redirect(buildLoginUrl(host, pathname + nextUrl.search));
      }
      // Forward the active workspace id for convenience.
      const activeMembership = memberships.find(
        (m) => m.workspace_id === activeWorkspaceId,
      );
      if (activeMembership) {
        response.headers.set("x-workspace-id", activeMembership.workspace_id);
        response.headers.set("x-workspace-slug", activeMembership.workspace_slug);
      }
    }
  } else {
    // Preview deployment (Vercel): no company slug in the host. We still
    // require auth but don't enforce company matching. The user could be
    // testing across companies.
    if (pathname.startsWith("/w/")) {
      // Forward the workspace from the path if any.
      const slug = parseWorkspaceFromPath(pathname);
      const match = memberships.find((m) => m.workspace_slug === slug);
      if (match) {
        response.headers.set("x-workspace-id", match.workspace_id);
        response.headers.set("x-workspace-slug", match.workspace_slug);
        response.headers.set("x-company-id", match.company_id);
      }
    }
  }

  // Inject the user id for server-side code.
  response.headers.set("x-user-id", claims.sub);
  if (claims.email) {
    response.headers.set("x-user-email", claims.email);
  }

  applyNoStore(response);
  return response;
}

/**
 * Apply Cache-Control: no-store to all responses. Critical for
 * multi-tenant safety on shared CDN edges.
 */
function applyNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
}

/**
 * Matcher: which requests run the proxy.
 *
 * We exclude static assets explicitly via `isPublicPath` anyway, but
 * tightening the matcher here saves an Edge invocation per static asset.
 *
 * Reference: https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - _next/static (build assets)
     *  - _next/image (image optimization)
     *  - favicon.ico
     *  - public files served from /public
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?)$).*)",
  ],
};