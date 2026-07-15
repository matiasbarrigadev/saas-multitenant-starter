/**
 * app/admin/layout.tsx — Platform-level admin layout.
 *
 * Gates everything under /admin on super_admin privileges. NOT under
 * the (tenant) group because super_admins don't have a meaningful
 * workspace context.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { getActiveContext } from "@/lib/tenant/context";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await getActiveContext().catch(() => null);

  if (!ctx) {
    // Unauthenticated. Redirect to /login (on the apex domain).
    redirect("/login?next=/admin");
  }

  if (ctx.platformRole !== "super_admin") {
    // Authenticated but not a super_admin. Send to their tenant.
    // (The dashboard layout will then decide what to render.)
    redirect("/w/" + ctx.workspace.slug + "/dashboard");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="font-semibold">
              Platform admin
            </Link>
            <Badge>super_admin</Badge>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin" className="text-muted-foreground hover:text-foreground">
              Companies
            </Link>
            <Link
              href="/admin/audit"
              className="text-muted-foreground hover:text-foreground"
            >
              Audit log
            </Link>
            <span className="text-muted-foreground">{ctx.user.email}</span>
            <form action="/api/auth/sign-out" method="post">
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}