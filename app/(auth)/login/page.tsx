/**
 * Magic-link sign-in page.
 *
 * Renders on company subdomains (acme.tuapp.local) and on the apex domain.
 * After submitting, the user receives an email; clicking the link lands on
 * /auth/callback which establishes the session.
 *
 * The page also handles the case where the user has been redirected back
 * after a failed callback (e.g. expired magic link). The `?error=` param
 * carries the reason and we show it as a warning.
 */

import { Suspense } from "react";

import { LoginForm } from "./LoginForm";

/**
 * The page itself is a Server Component that just renders the client form.
 * We use Suspense because the form needs to read searchParams, which in
 * Next.js 15 must be wrapped in <Suspense> at the page boundary.
 */
export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          padding: "2rem",
          background: "white",
          border: "1px solid #eaeaea",
          borderRadius: 8,
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Sign in</h1>
        <p style={{ marginTop: "0.5rem", color: "#666" }}>
          Enter your email and we&apos;ll send you a magic link.
        </p>

        <Suspense fallback={<p>Loading…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}