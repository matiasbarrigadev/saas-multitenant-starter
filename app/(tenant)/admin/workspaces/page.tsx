/**
 * app/(tenant)/admin/workspaces/page.tsx — Manage workspaces in the company.
 *
 * Lists all workspaces (including archived) and a button to create new ones.
 * Mutations go through app/(tenant)/api/admin/workspaces/* endpoints.
 */

import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";

export default async function CompanyWorkspacesPage() {
  const ctx = await getActiveContext().catch(() => null);
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  const { data: workspaces, error } = await supabase
    .from("workspaces")
    .select("id, slug, name, archived_at, created_at")
    .eq("company_id", ctx.company.id)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>{error.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspaces</CardTitle>
        <CardDescription>
          {(workspaces ?? []).length} workspace
          {(workspaces ?? []).length === 1 ? "" : "s"} in{" "}
          <code>{ctx.company.slug}</code>. Archived workspaces are kept for
          historical data; their slug can be reused after archival.
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
            {(workspaces ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No workspaces yet.
                </TableCell>
              </TableRow>
            ) : (
              (workspaces ?? []).map((w) => (
                <TableRow key={w.id}>
                  <TableCell><code className="text-xs">{w.slug}</code></TableCell>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell>
                    {w.archived_at ? (
                      <Badge variant="secondary">archived</Badge>
                    ) : (
                      <Badge>active</Badge>
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
  );
}