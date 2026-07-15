/**
 * app/(tenant)/admin/settings/page.tsx — Company settings (owner-only).
 *
 * Allows editing the company name. Logo URL and billing contact email live
 * in companies.settings jsonb; future forks can extend by adding fields.
 */

import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";

export default async function CompanySettingsPage() {
  const ctx = await getActiveContext().catch(() => null);
  if (!ctx) redirect("/login");
  // Owner-only enforced by layout.

  const supabase = await createClient();
  const { data: company, error } = await supabase
    .from("companies")
    .select("id, slug, name, settings, created_at")
    .eq("id", ctx.company.id)
    .maybeSingle();

  if (error || !company) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>{error?.message ?? "Company not found."}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const settings = (company.settings ?? {}) as Record<string, unknown>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company settings</CardTitle>
        <CardDescription>
          Changes here apply company-wide. Slug is locked (changing it would
          break every existing subdomain).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Slug</dt>
          <dd><code>{company.slug}</code></dd>
          <dt className="text-muted-foreground">Name</dt>
          <dd>{company.name}</dd>
          <dt className="text-muted-foreground">Suspended</dt>
          <dd>{settings.suspended ? "yes" : "no"}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd className="text-muted-foreground">
            {new Date(company.created_at).toLocaleString()}
          </dd>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          Settings edits via the API route at{" "}
          <code>PATCH /api/admin/company</code> (form-based; see the admin
          API endpoints).
        </p>
      </CardContent>
    </Card>
  );
}