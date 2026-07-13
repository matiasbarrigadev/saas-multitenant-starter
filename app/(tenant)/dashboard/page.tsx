/**
 * Dashboard page — protected, tenant-scoped.
 *
 * Demonstrates:
 *   - Reading the active tenant context (no extra DB query).
 *   - Querying a tenant-scoped table (notes) where RLS automatically
 *     filters to the active workspace.
 *
 * If the user lands here without an active workspace in their JWT,
 * we redirect them to /settings to pick one.
 */

import { redirect } from "next/navigation";

import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  let ctx;
  try {
    ctx = await getActiveContext();
  } catch {
    redirect("/settings");
  }

  // Query notes. RLS automatically filters by workspace_id, so this
  // returns only notes for the active workspace.
  const supabase = await createClient();
  const { data: notes, error } = await supabase
    .from("notes")
    .select("id, title, body, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <main>
      <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Dashboard</h1>
      <p style={{ color: "#666", marginTop: "0.25rem" }}>
        Welcome to workspace <code>{ctx.workspace.slug}</code>. You have
        access to {ctx.memberships.length} workspace
        {ctx.memberships.length === 1 ? "" : "s"} in total.
      </p>

      <section
        style={{
          marginTop: "2rem",
          padding: "1.25rem",
          background: "white",
          border: "1px solid #eaeaea",
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Recent notes</h2>
        {error ? (
          <p style={{ color: "#991b1b" }}>Failed to load notes: {error.message}</p>
        ) : !notes || notes.length === 0 ? (
          <p style={{ color: "#666" }}>
            No notes yet. Use the API to create one:
            <pre
              style={{
                marginTop: "0.5rem",
                padding: "0.5rem",
                background: "#fafafa",
                borderRadius: 4,
                fontSize: "0.8rem",
                overflow: "auto",
              }}
            >
              {`curl -X POST $HOST/api/notes \\
  -H "Cookie: <your session>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Hello","body":"World"}'`}
            </pre>
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {notes.map((n) => (
              <li key={n.id}>
                <strong>{n.title}</strong>{" "}
                <span style={{ color: "#666", fontSize: "0.875rem" }}>
                  {new Date(n.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p style={{ marginTop: "1.5rem", fontSize: "0.875rem", color: "#666" }}>
        <a href="/settings">Switch workspace or sign out →</a>
      </p>
    </main>
  );
}