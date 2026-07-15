/**
 * Root layout for the entire app.
 *
 * Minimal by design: this template doesn't impose a UI framework. We render
 * plain HTML with a system font stack so the template works without Tailwind
 * or any CSS-in-JS dependency. Copy this layout into your project and add
 * your own design system on top.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Multitenant Template",
    template: "%s · Multitenant Template",
  },
  description:
    "Multitenant SaaS starter template. Company + Workspace, Supabase auth, RLS, magic link.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
          color: "#111",
          backgroundColor: "#fafafa",
          lineHeight: 1.5,
        }}
      >
        {children}
      </body>
    </html>
  );
}