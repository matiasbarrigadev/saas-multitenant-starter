"use client";

/**
 * Workspace switcher. Calls POST /api/me/switch-workspace which updates
 * the user's active workspace in app_metadata and refreshes the JWT.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";

interface Membership {
  company_id: string;
  company_slug: string;
  workspace_id: string;
  workspace_slug: string;
  role: "owner" | "admin" | "member";
}

export function Switcher({
  currentWorkspaceId,
  memberships,
}: {
  currentWorkspaceId: string;
  memberships: Membership[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSwitch(workspaceId: string, workspaceSlug: string) {
    startTransition(async () => {
      const res = await fetch("/api/me/switch-workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const body = await res.json();
      if (body.ok) {
        // Reload the page so all server components re-read the new JWT.
        // router.refresh() re-fetches RSCs but doesn't update cookies, which
        // is fine here because the cookies were already updated by the
        // switch endpoint.
        router.refresh();
        // Navigate to the new workspace's dashboard.
        window.location.href = `/w/${workspaceSlug}/dashboard`;
      } else {
        alert(body.error?.message ?? "Could not switch workspace.");
      }
    });
  }

  if (memberships.length === 0) {
    return <p style={{ color: "#666" }}>You aren&apos;t a member of any workspace yet.</p>;
  }

  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
      {memberships.map((m) => {
        const isActive = m.workspace_id === currentWorkspaceId;
        return (
          <li
            key={m.workspace_id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.6rem 0",
              borderTop: "1px solid #f0f0f0",
            }}
          >
            <div>
              <code>{m.company_slug}</code> / <code>{m.workspace_slug}</code>
              <span
                style={{
                  marginLeft: "0.5rem",
                  padding: "0.05rem 0.35rem",
                  background: "#f3f4f6",
                  borderRadius: 4,
                  fontSize: "0.7rem",
                  color: "#111",
                }}
              >
                {m.role}
              </span>
              {isActive && (
                <span
                  style={{
                    marginLeft: "0.5rem",
                    color: "#10b981",
                    fontSize: "0.8rem",
                  }}
                >
                  ● active
                </span>
              )}
            </div>
            {!isActive && (
              <button
                onClick={() => onSwitch(m.workspace_id, m.workspace_slug)}
                disabled={pending}
                style={{
                  padding: "0.3rem 0.7rem",
                  fontSize: "0.8rem",
                  background: "white",
                  border: "1px solid #d4d4d4",
                  borderRadius: 4,
                  cursor: pending ? "not-allowed" : "pointer",
                }}
              >
                Switch
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}