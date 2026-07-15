/**
 * app/(tenant)/admin/members/page.tsx — List + manage company members.
 *
 * Shows every unique user with at least one membership in the company,
 * across all workspaces. Lists workspaces each member is in and the
 * highest role they hold.
 *
 * RLS note: this query runs through the regular server client (no
 * service_role). Members listing is gated by RLS — only company-mates
 * can see each other (0002_rls_policies.sql: profiles_select_company_mates).
 * For super_admins, the existing company-membership is enough; for a
 * pure super_admin viewing an unrelated company, the guard at the
 * layout level redirects them to /admin (the platform admin panel)
 * where they use service_role directly.
 */

import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";

const roleRank: Record<string, number> = { owner: 3, admin: 2, member: 1 };

export default async function CompanyMembersPage() {
  const ctx = await getActiveContext().catch(() => null);
  if (!ctx) redirect("/login");

  const supabase = await createClient();

  // Pull memberships + profiles via RLS. The service client bypasses
  // membership filters only when explicitly required; here RLS gives us
  // exactly the right scope (company-mates only).
  const [membershipsRes, profilesRes] = await Promise.all([
    supabase
      .from("memberships")
      .select("user_id, role, workspace_id")
      .eq("company_id", ctx.company.id),
    supabase
      .from("profiles")
      .select("id, email, full_name"),
  ]);

  if (membershipsRes.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>{membershipsRes.error.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const memberships = membershipsRes.data ?? [];
  const profiles = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));

  const byUser = new Map<
    string,
    { userId: string; roles: Set<string>; workspaces: Set<string> }
  >();
  for (const m of memberships) {
    const entry = byUser.get(m.user_id) ?? {
      userId: m.user_id,
      roles: new Set<string>(),
      workspaces: new Set<string>(),
    };
    entry.roles.add(m.role);
    entry.workspaces.add(m.workspace_id);
    byUser.set(m.user_id, entry);
  }

  const rows = [...byUser.values()]
    .map((e) => {
      const highest = [...e.roles].sort(
        (a, b) => (roleRank[b] ?? 0) - (roleRank[a] ?? 0),
      )[0];
      return {
        userId: e.userId,
        highestRole: highest,
        workspaceCount: e.workspaces.size,
        profile: profiles.get(e.userId) ?? null,
      };
    })
    .sort((a, b) => {
      const aEmail = a.profile?.email ?? "";
      const bEmail = b.profile?.email ?? "";
      return aEmail.localeCompare(bEmail);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          {rows.length} unique member{rows.length === 1 ? "" : "s"} in{" "}
          <code>{ctx.company.slug}</code>. Click a member to change their role
          or remove them.
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No members yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.userId}>
                  <TableCell className="font-mono text-xs">
                    {r.profile?.email ?? r.userId}
                  </TableCell>
                  <TableCell>{r.profile?.full_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={r.highestRole === "owner" ? "default" : "secondary"}
                    >
                      {r.highestRole}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{r.workspaceCount}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}