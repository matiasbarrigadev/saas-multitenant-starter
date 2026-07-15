/**
 * app/admin/page.tsx — Platform admin landing. Lists all companies.
 *
 * The list query uses the service role client (RLS-bypassed, justified
 * in lib/admin/audit.ts comment) because the regular user (even
 * super_admin) cannot enumerate companies they have no membership in
 * via RLS alone — that's the whole point of the bypass.
 */

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import { requireSuperAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Justification for service_role:
 *   - We need to list ALL companies in the platform, not just ones the
 *     caller has membership in.
 *   - Even for super_admins, RLS is currently scoped to membership. The
 *     policies could be extended to bypass for super_admin, but listing
 *     requires aggregation (member counts) that's cleaner via service.
 *   - Guard before bypass: requireSuperAdmin() verified the caller's
 *     JWT carries platform_role = 'super_admin'. The platform_role claim
 *     is server-controlled (set via service_role, never via user input).
 */

interface CompanyListRow {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  member_count: number;
  workspace_count: number;
}

export default async function AdminHomePage() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    // Layout already enforces super_admin; this is defense in depth.
    // Show the error inline rather than redirecting (helps debugging).
    return (
      <Card>
        <CardHeader>
          <CardTitle>Forbidden</CardTitle>
          <CardDescription>{await guard.response.text()}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const service = createServiceClient();

  // Fetch companies + aggregate counts in parallel.
  const [companiesRes, membersRes, workspacesRes] = await Promise.all([
    service.from("companies").select("id, slug, name, created_at").order("created_at", { ascending: false }),
    service.from("memberships").select("company_id"),
    service.from("workspaces").select("company_id"),
  ]);

  if (companiesRes.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error loading companies</CardTitle>
          <CardDescription>{companiesRes.error.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const memberCounts = countBy(membersRes.data ?? [], "company_id");
  const workspaceCounts = countBy(workspacesRes.data ?? [], "company_id");

  const rows: CompanyListRow[] = (companiesRes.data ?? []).map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    created_at: c.created_at,
    member_count: memberCounts.get(c.id) ?? 0,
    workspace_count: workspaceCounts.get(c.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Companies</CardTitle>
          <CardDescription>
            {rows.length} {rows.length === 1 ? "company" : "companies"} on the platform.
            Click any to manage its members, workspaces, and settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Workspaces</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No companies yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <code className="text-xs">{c.slug}</code>
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right">{c.workspace_count}</TableCell>
                    <TableCell className="text-right">{c.member_count}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/companies/${c.id}`}
                        className="text-sm font-medium underline-offset-4 hover:underline"
                      >
                        Manage
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="text-sm text-muted-foreground">
        Signed in as <Badge variant="outline">{guard.ctx.user.email}</Badge>
      </div>
    </div>
  );
}

/** Group rows by a string field and count. */
function countBy<T extends Record<K, string>, K extends keyof T>(
  rows: T[],
  field: K,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = r[field];
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}