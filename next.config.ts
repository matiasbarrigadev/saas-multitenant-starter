import type { NextConfig } from "next";

/**
 * Next.js configuration for the multitenant template.
 *
 * Notes:
 * - We intentionally rely on the default Node.js runtime. Edge runtime is not
 *   the right default for a backend-heavy SaaS (no native node_modules, no
 *   filesystem, no ISR). If you ever need Edge for a specific route, set
 *   `export const runtime = 'edge'` in that route file explicitly.
 * - `serverActions` body size limit is kept small; raise it if you upload
 *   files directly via Server Actions, but prefer a dedicated Edge Function
 *   or Supabase Storage for anything beyond trivial payloads.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
};

export default nextConfig;