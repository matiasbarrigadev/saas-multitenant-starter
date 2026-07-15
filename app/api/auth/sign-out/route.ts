/**
 * POST /api/auth/sign-out — server-side sign out.
 *
 * Used by the admin layout's <form action="/api/auth/sign-out">.
 * Clears cookies via supabase.auth.signOut(), then redirects to /login.
 */

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { parseHost } from "@/lib/tenant/host";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const host = parseHost(request.headers.get("host"));
  const hostName = host.companySlug
    ? `${host.companySlug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}`
    : env.NEXT_PUBLIC_ROOT_DOMAIN;
  const portSuffix = host.port ? `:${host.port}` : "";
  const scheme = env.NEXT_PUBLIC_APP_SCHEME;
  return NextResponse.redirect(
    `${scheme}://${hostName}${portSuffix}/login?signed_out=1`,
  );
}