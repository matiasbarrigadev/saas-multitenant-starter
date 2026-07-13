/**
 * Landing page rendered at the apex domain (tuapp.local, tuapp.com).
 *
 * This page is PUBLIC — no auth required. It exists to give the platform
 * a home for marketing, pricing, etc. Company subdomains (acme.tuapp.com)
 * have their own tenant-scoped routes.
 */

import Link from "next/link";

import { env } from "@/lib/env";

export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "4rem 1.5rem",
      }}
    >
      <h1 style={{ fontSize: "2rem", margin: 0, letterSpacing: "-0.02em" }}>
        Multitenant Starter Template
      </h1>
      <p style={{ color: "#555", marginTop: "0.5rem" }}>
        Company + Workspace tenancy on Supabase + Next.js + Vercel.
      </p>

      <div
        style={{
          marginTop: "2.5rem",
          padding: "1.25rem",
          background: "white",
          border: "1px solid #eaeaea",
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Quick links</h2>
        <ul style={{ marginBottom: 0, paddingLeft: "1.25rem" }}>
          <li>
            <Link href="/login">Sign in with magic link</Link>
          </li>
          <li>
            <a
              href={`http://acme.${env.NEXT_PUBLIC_ROOT_DOMAIN}:3000/login`}
              style={{ color: "#0066cc" }}
            >
              Demo: Acme Corp workspace
            </a>
          </li>
        </ul>
      </div>

      <p style={{ marginTop: "2.5rem", fontSize: "0.875rem", color: "#666" }}>
        See <code>docs/ARCHITECTURE.md</code> for the full design.
      </p>
    </main>
  );
}