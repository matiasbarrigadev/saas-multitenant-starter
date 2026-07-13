"use client";

/**
 * Client form for the magic-link sign-in flow.
 *
 * Submitting POSTs to /api/auth/request-link, which calls
 * supabase.auth.signInWithOtp under the hood. On success the user sees
 * "Check your inbox". On rate-limit they see a warning. On validation
 * failure they see an inline error.
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent" }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

export function LoginForm() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");
  const nextParam = searchParams.get("next") ?? "";

  const [state, setState] = useState<State>({ kind: "idle" });
  const [email, setEmail] = useState("");

  const callbackErrorMessage = (() => {
    switch (callbackError) {
      case "missing_code":
        return "The sign-in link is invalid or expired. Please request a new one.";
      case "exchange_failed":
        return "We couldn't complete the sign-in. Please request a new link.";
      case "no_claims":
        return "Sign-in succeeded but we couldn't read your session. Please try again.";
      default:
        return null;
    }
  })();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "submitting" });

    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, next: nextParam || undefined }),
      });
      const body = await res.json();

      if (body.ok) {
        setState({ kind: "sent" });
      } else if (body.warning) {
        setState({ kind: "warning", message: body.warning.message });
      } else {
        setState({
          kind: "error",
          message: body.error?.message ?? "Something went wrong.",
        });
      }
    } catch (err) {
      console.error("[LoginForm] submit error:", err);
      setState({
        kind: "error",
        message: "Network error. Please try again.",
      });
    }
  }

  if (state.kind === "sent") {
    return (
      <div
        role="status"
        style={{
          marginTop: "1.25rem",
          padding: "0.75rem",
          background: "#ecfdf5",
          border: "1px solid #10b981",
          borderRadius: 6,
          color: "#065f46",
          fontSize: "0.9rem",
        }}
      >
        <strong>Check your inbox.</strong>
        <p style={{ margin: "0.25rem 0 0" }}>
          We sent a sign-in link to <strong>{email}</strong>. Click it to
          finish signing in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ marginTop: "1.25rem" }}>
      {callbackErrorMessage && (
        <div
          role="alert"
          style={{
            marginBottom: "1rem",
            padding: "0.75rem",
            background: "#fef2f2",
            border: "1px solid #ef4444",
            borderRadius: 6,
            color: "#991b1b",
            fontSize: "0.875rem",
          }}
        >
          {callbackErrorMessage}
        </div>
      )}

      <label
        htmlFor="email"
        style={{ display: "block", fontSize: "0.875rem", fontWeight: 600 }}
      >
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={state.kind === "submitting"}
        style={{
          width: "100%",
          marginTop: "0.4rem",
          padding: "0.5rem 0.6rem",
          fontSize: "1rem",
          border: "1px solid #d4d4d4",
          borderRadius: 6,
        }}
      />

      <button
        type="submit"
        disabled={state.kind === "submitting"}
        style={{
          width: "100%",
          marginTop: "1rem",
          padding: "0.6rem",
          fontSize: "0.95rem",
          fontWeight: 600,
          background: state.kind === "submitting" ? "#999" : "#111",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: state.kind === "submitting" ? "not-allowed" : "pointer",
        }}
      >
        {state.kind === "submitting" ? "Sending…" : "Send magic link"}
      </button>

      {state.kind === "warning" && (
        <p
          role="status"
          style={{
            marginTop: "0.75rem",
            fontSize: "0.875rem",
            color: "#92400e",
          }}
        >
          {state.message}
        </p>
      )}

      {state.kind === "error" && (
        <p
          role="alert"
          style={{
            marginTop: "0.75rem",
            fontSize: "0.875rem",
            color: "#991b1b",
          }}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}