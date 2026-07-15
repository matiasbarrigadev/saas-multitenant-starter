/**
 * app/admin/audit/page.tsx — Read-only audit log viewer for super_admin.
 */

import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { requireSuperAdmin } from "@/lib/admin/guards";
import { createServiceClient } from "@/lib/supabase/service";

export default async function AdminAuditPage() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Forbidden</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("audit_events")
    .select(
      "id, actor_user_id, company_id, event_type, payload, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

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

  const events = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>
          Most recent {events.length} events across all companies. Read-only;
          audit entries are immutable.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Payload</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No events yet.
                </TableCell>
              </TableRow>
            ) : (
              events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.actor_user_id ?? <span className="text-muted-foreground">system</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{e.event_type}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.company_id ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-md truncate">
                    {JSON.stringify(e.payload)}
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