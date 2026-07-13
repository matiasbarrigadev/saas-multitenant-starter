/**
 * Settings page: switch active workspace + view memberships + sign out.
 *
 * The switcher uses a server action to call /api/me/switch-workspace.
 * We expose it as a server action here so the form is fully progressive-
 * enhancement friendly.
 */

import { redirect } from "next/navigation";

import { getActiveContext } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

import { Switcher } from "./Switcher";

export default async function SettingsPage() {
  let ctx;
  try {
    ctx = await getActiveContext();
  } catch {
    redirect("/login");
  }

  // Fetch profile for the user. RLS allows reading your own profile.
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url")
    .eq("id", ctx.user.id)
    .maybeSingle();

  return (
    <main>
      <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Settings</h1>

      <section
        style={{
          marginTop: "2rem",
          padding: "1.25rem",
          background: "white",
          border: "1px solid #eaeaea",
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Profile</h2>
        <dl
          style={{
            margin: 0,
            display: "grid",
            gridTemplateColumns: "8rem 1fr",
            gap: "0.4rem 1rem",
            fontSize: "0.9rem",
          }}
        >
          <dt style={{ color: "#666" }}>Email</dt>
          <dd style={{ margin: 0 }}>{profile?.email ?? ctx.user.email}</dd>
          <dt style={{ color: "#666" }}>Name</dt>
          <dd style={{ margin: 0 }}>{profile?.full_name ?? "—"}</dd>
        </dl>
      </section>

      <section
        style={{
          marginTop: "1.5rem",
          padding: "1.25rem",
          background: "white",
          border: "1px solid #eaeaea",
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Your workspaces</h2>
        <Switcher
          currentWorkspaceId={ctx.workspace.id}
          memberships={ctx.memberships}
        />
      </section>

      <section style={{ marginTop: "2rem" }}>
        <form action={signOut}>
          <button
            type="submit"
            style={{
              padding: "0.5rem 1rem",
              background: "white",
              border: "1px solid #d4d4d4",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}