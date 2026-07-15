/**
 * app/admin/companies/[id]/page.tsx — Single company detail for super_admin.
 *
 * Shows members across all the company's workspaces + the workspaces
 * themselves. Read-only on this page; mutations live in dedicated
 * API routes (app/admin/api/companies/[id]/suspend etc).
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { requireSuperAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Justification for service_role: see app/admin/page.tsx. Same pattern.
 */

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CompanyDetailPage({ params }: PageProps) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    notFound();
  }

  const { id } = await params;
  const service = createServiceClient();

  const [companyRes, workspacesRes, membershipsRes] = await Promise.all([
    service
      .from("companies")
      .select("id, slug, name, settings, created_at")
      .eq("id", id)
      .maybeSingle(),
    service
      .from("workspaces")
      .select("id, slug, name, created_at, archived_at")
      .eq("company_id", id)
      .order("created_at", { ascending: false }),
    service
      .from("memberships")
      .select("id, user_id, role, workspace_id")
      .eq("company_id", id),
  ]);

  if (companyRes.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>{companyRes.error.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!companyRes.data) {
    notFound();
  }

  const company = companyRes.data;
  const workspaces = workspacesRes.data ?? [];
  const memberships = membershipsRes.data ?? [];

  // Get profile data for each member. Profile RLS doesn't restrict reads
  // for self + company-mates, but super_admin viewing another company
  // still needs service_role.
  const userIds = [...new Set(memberships.map((m) => m.user_id))];
  const profilesRes = userIds.length
    ? await service
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds)
    : { data: [], error: null };
  const profiles = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));

  // Group memberships by user so we get one row per member with the
  // workspaces they're in (and the highest role they hold).
  const membersByUser = new Map<string, { userId: string; roles: Set<string>; workspaces: Set<string> }>();
  for (const m of memberships) {
    const entry = membersByUser.get(m.user_id) ?? {
      userId: m.user_id,
      roles: new Set<string>(),
      workspaces: new Set<string>(),
    };
    entry.roles.add(m.role);
    entry.workspaces.add(m.workspace_id);
    membersByUser.set(m.user_id, entry);
  }

  // Highest-role wins for display.
  const roleRank: Record<string, number> = { owner: 3, admin: 2, member: 1 };
  const memberRows = [...membersByUser.values()].map((entry) => {
    const rolesArr = [...entry.roles];
    const highestRole = rolesArr.sort(
      (a, b) => (roleRank[b] ?? 0) - (roleRank[a] ?? 0),
    )[0];
    return {
      userId: entry.userId,
      highestRole,
      workspaceCount: entry.workspaces.size,
      profile: profiles.get(entry.userId) ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{company.name}</h1>
          <p className="text-muted-foreground">
            <code className="text-xs">{company.slug}.tuapp.local</code>
            {" · "}
            Created {formatDistanceToNow(new Date(company.created_at), { addSuffix: true })}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`http://${company.slug}.tuapp.local:3000/w/${workspaces[0]?.slug ?? ""}/dashboard`}>
            <Button variant="outline">Visit as subdomain</Button>
          </Link>
          <form
            action={`/admin/api/companies/${company.id}/suspend`}
            method="post"
          >
            <Button variant="destructive" type="submit">
              Suspend company
            </Button>
          </form>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workspaces</CardTitle>
          <CardDescription>
            {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}.
            Archived workspaces are flagged.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No workspaces yet.
                  </TableCell>
                </TableRow>
              ) : (
                workspaces.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell><code className="text-xs">{w.slug}</code></TableCell>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>
                      {w.archived_at ? (
                        <Badge variant="secondary">archived</Badge>
                      ) : (
                        <Badge variant="default">active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDistanceToNow(new Date(w.created_at), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {memberRows.length} unique member{memberRows.length === 1 ? "" : "s"} across
            all workspaces. "Highest role" is the strongest role the user holds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Highest role</TableHead>
                <TableHead className="text-right">Workspaces</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No members yet.
                  </TableCell>
                </TableRow>
              ) : (
                memberRows.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell className="font-mono text-xs">
                      {m.profile?.email ?? m.userId}
                    </TableCell>
                    <TableCell>{m.profile?.full_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={m.highestRole === "owner" ? "default" : "secondary"}>
                        {m.highestRole}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{m.workspaceCount}</TableCell>
                    <TableCell>
                      <form
                        action={`/admin/api/users/${m.userId}/promote`}
                        method="post"
                      >
                        <input
                          type="hidden"
                          name="platform_role"
                          value={m.profile?.email && isSuperAdmin(m.userId, profiles) ? "" : "super_admin"}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          type="submit"
                        >
                          {isSuperAdmin(m.userId, profiles)
                            ? "Demote"
                            : "Promote to super_admin"}
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// TODO: track which users are super_admin. Simplest: check their
// raw_app_meta_data via service role. For now we render a button that
// always sends 'super_admin'; the API endpoint should refuse to demote self.
function isSuperAdmin(_userId: string, _profiles: Map<string, unknown>): boolean {
  return false;
}