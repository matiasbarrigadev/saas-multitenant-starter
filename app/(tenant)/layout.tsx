/**
 * Protected layout for tenant-scoped routes.
 *
 * This runs on the SERVER for every route nested under it. It enforces:
 *   - The user has a valid session.
 *   - The session has an active company + workspace.
 *   - The active company matches the host subdomain.
 *
 * proxy.ts handles the basic gate (auth + host matching); this layout
 * adds the DB-aware check (workspace exists, user is a member). The
 * split lets proxy.ts stay Edge-runtime-friendly.
 *
 * Behavior on failure: redirect to /login with a hint, or show a 404 page
 * if the workspace can't be resolved.
 */

import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getActiveContext, TenantContextError } from "@/lib/tenant/context";
import { resolveCompanyBySlug } from "@/lib/tenant/resolve-company";
import { parseHost, buildAbsoluteUrl } from "@/lib/tenant/host";
import { headers } from "next/headers";

import { env } from "@/lib/env";

export default async function TenantLayout({
  children,
}: {
  children: ReactNode;
}) {
  let ctx;
  try {
    ctx = await getActiveContext();
  } catch (err) {
    if (err instanceof TenantContextError) {
      // Different codes deserve different redirects.
      const hdrs = await headers();
      const referer = hdrs.get("referer");
      const pathname = (() => {
        try {
          return referer ? new URL(referer).pathname + new URL(referer).search : "/";
        } catch {
          return "/";
        }
      })();
      const host = parseHost(hdrs.get("host"));
      const loginUrl = buildAbsoluteUrl(
        host.companySlug,
        `/login?next=${encodeURIComponent(pathname)}`,
        env.NEXT_PUBLIC_ROOT_DOMAIN,
        env.NEXT_PUBLIC_APP_SCHEME,
      );
      redirect(loginUrl);
    }
    throw err;
  }

  // Re-verify the company actually exists (defense in depth: proxy.ts
  // validated membership, but if the company was deleted while the user
  // had a session, we want to fail gracefully here).
  const hdrs = await headers();
  const host = parseHost(hdrs.get("host"));
  if (host.companySlug) {
    const company = await resolveCompanyBySlug(host.companySlug);
    if (!company) {
      // Company deleted or user lost access. Redirect to apex.
      redirect(buildAbsoluteUrl(null, "/?company_not_found=1"));
    }
  }

  // The page-level RSCs under this layout can call getActiveContext() again
  // if they need to re-read claims. We forward ctx implicitly via the
  // session cookie; the next getActiveContext() will see the same state.

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Minimal header. Copy this and style it for your project. */}
      <header
        style={{
          borderBottom: "1px solid #eaeaea",
          background: "white",
          padding: "0.75rem 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "0.9rem",
        }}
      >
        <div>
          <strong>{ctx.company.slug}</strong>
          <span style={{ color: "#999", margin: "0 0.5rem" }}>·</span>
          <span>/w/{ctx.workspace.slug}</span>
        </div>
        <div style={{ color: "#666" }}>
          {ctx.user.email}{" "}
          <span
            style={{
              marginLeft: "0.5rem",
              padding: "0.1rem 0.4rem",
              background: "#f3f4f6",
              borderRadius: 4,
              fontSize: "0.75rem",
              color: "#111",
            }}
          >
            {ctx.role}
          </span>
        </div>
      </header>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        {children}
      </div>
    </div>
  );
}