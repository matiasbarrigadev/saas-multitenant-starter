/**
 * app/(tenant)/admin/layout.tsx — Company-level admin layout.
 *
 * Gates everything under /w/<slug>/admin on company_admin privileges
 * (owner OR admin role in the active company, OR super_admin).
 *
 * Lives INSIDE the (tenant) group so the layout inherits the auth +
 * workspace validation from app/(tenant)/layout.tsx.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { getActiveContext } from "@/lib/tenant/context";

export default async function CompanyAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await getActiveContext().catch(() => null);

  if (!ctx) {
    redirect("/login?next=/admin");
  }

  const isOwner = ctx.role === "owner";
  const isAdmin = ctx.role === "admin" || ctx.role === "owner";
  const isSuper = ctx.platformRole === "super_admin";

  if (!isAdmin && !isSuper) {
    redirect("/w/" + ctx.workspace.slug + "/dashboard");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Company admin</h2>
        <Badge>
          {isSuper ? "super_admin" : ctx.role}
        </Badge>
        {isOwner && !isSuper && (
          <Badge variant="outline">owner</Badge>
        )}
      </div>
      <nav className="flex gap-1 border-b text-sm">
        <Link
          href="/admin/members"
          className="rounded-t-md px-3 py-2 hover:bg-muted"
        >
          Members
        </Link>
        <Link
          href="/admin/workspaces"
          className="rounded-t-md px-3 py-2 hover:bg-muted"
        >
          Workspaces
        </Link>
        {isOwner && (
          <Link
            href="/admin/settings"
            className="rounded-t-md px-3 py-2 hover:bg-muted"
          >
            Settings
          </Link>
        )}
      </nav>
      <div>{children}</div>
      {/* Re-use the sign-out form from the tenant layout via the api */}
      <form action="/api/auth/sign-out" method="post">
        <Button variant="ghost" size="sm" type="submit">
          Sign out
        </Button>
      </form>
    </div>
  );
}