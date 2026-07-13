"use server";

/**
 * Server action: sign out the current user.
 *
 * Server actions can be imported directly into a form's `action` prop.
 * Next.js wires the form submission to this function on the server.
 */

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { parseHost } from "@/lib/tenant/host";
import { headers } from "next/headers";

import { env } from "@/lib/env";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Redirect to /login on the same subdomain.
  const host = parseHost(headers().get("host"));
  const hostName = host.companySlug
    ? `${host.companySlug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}`
    : env.NEXT_PUBLIC_ROOT_DOMAIN;
  const portSuffix = host.port ? `:${host.port}` : "";
  const scheme = env.NEXT_PUBLIC_APP_SCHEME;
  redirect(`${scheme}://${hostName}${portSuffix}/login?signed_out=1`);
}