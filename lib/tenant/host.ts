/**
 * Host header parsing.
 *
 * Given a Host header value and a configured root domain, extract the
 * subdomain (which is the company slug). Handles local dev, preview
 * deployments, and production uniformly.
 *
 * Examples:
 *   host="acme.tuapp.local"   rootDomain="tuapp.local" -> "acme"
 *   host="tuapp.local"        rootDomain="tuapp.local" -> null (apex)
 *   host="marketing.tuapp.com" rootDomain="tuapp.com"  -> "marketing"
 *   host="tuapp.com"          rootDomain="tuapp.com"  -> null (apex)
 *
 *   Preview deployments (Vercel):
 *   host="acme-git-feat-x.vercel.app"  -> we DON'T use these for tenancy;
 *                                          the wildcard is on the production
 *                                          apex only. Preview URLs are
 *                                          accessed directly without a
 *                                          company subdomain.
 *
 *   Local dev with /etc/hosts entry like "127.0.0.1 acme.tuapp.local":
 *   host="acme.tuapp.local:3000" -> strip the port first, then parse.
 */

import { env } from "@/lib/env";

/**
 * Result of parsing a host header.
 *
 * `companySlug` is the subdomain component (e.g. "acme"). `null` means
 * the request is to the apex domain (e.g. tuapp.com), where no company
 * context applies — typically used for marketing pages or login.
 */
export interface ParsedHost {
  /** The original Host header (preserved for redirects). */
  raw: string;
  /** Hostname with port stripped, lowercased. */
  hostname: string;
  /** Port if explicitly set, else null. */
  port: string | null;
  /** The company slug from the subdomain, or null for apex / preview hosts. */
  companySlug: string | null;
  /** True if the host is a Vercel preview deployment (*.vercel.app). */
  isPreview: boolean;
}

/**
 * Parse a Host header value.
 *
 * @param host - The raw Host header (may include port).
 * @param rootDomain - The configured root domain (defaults to env).
 *
 * Behavior:
 * - Lowercases the hostname for case-insensitive matching.
 * - Strips the port if present (Host headers include it on local dev).
 * - If hostname equals rootDomain exactly -> apex, no slug.
 * - If hostname ends with `.${rootDomain}` -> the part before is the slug.
 * - Otherwise (e.g. localhost, *.vercel.app) -> no slug, isPreview if vercel.
 */
export function parseHost(
  host: string | null | undefined,
  rootDomain: string = env.NEXT_PUBLIC_ROOT_DOMAIN,
): ParsedHost {
  if (!host) {
    return { raw: "", hostname: "", port: null, companySlug: null, isPreview: false };
  }

  // Split hostname and port.
  const lastColon = host.lastIndexOf(":");
  let hostname: string;
  let port: string | null = null;
  if (lastColon !== -1 && host.indexOf(":") === lastColon) {
    // Exactly one colon -> "host:port" form. Could still be IPv6 but in
    // practice Host headers are IPv4/hostnames. Defensive: only treat the
    // trailing colon as a port delimiter if what follows is digits.
    const candidatePort = host.slice(lastColon + 1);
    if (/^\d+$/.test(candidatePort)) {
      hostname = host.slice(0, lastColon);
      port = candidatePort;
    } else {
      hostname = host;
    }
  } else {
    hostname = host;
  }

  const lowerHost = hostname.toLowerCase();
  const lowerRoot = rootDomain.toLowerCase();

  // Vercel preview deployments: <branch>-<scope>--<project>.vercel.app or
  // simpler forms like <branch>.<project>.vercel.app. We treat any
  // *.vercel.app as preview and never assign it a companySlug.
  const isPreview = lowerHost.endsWith(".vercel.app");

  // Apex: hostname equals root domain exactly.
  if (lowerHost === lowerRoot) {
    return { raw: host, hostname: lowerHost, port, companySlug: null, isPreview };
  }

  // Subdomain: must end with `.${rootDomain}` to avoid false matches like
  // "tuapp.com.evil.com".
  const suffix = `.${lowerRoot}`;
  if (lowerHost.endsWith(suffix)) {
    const slug = lowerHost.slice(0, -suffix.length);
    // Defensive: a valid slug must not be empty and must not contain dots.
    // If it does (e.g. multi-level subdomains we don't support), bail.
    if (slug && !slug.includes(".")) {
      return { raw: host, hostname: lowerHost, port, companySlug: slug, isPreview: false };
    }
  }

  // localhost / 127.0.0.1 / vercel.app / unknown hosts -> no slug.
  return { raw: host, hostname: lowerHost, port, companySlug: null, isPreview };
}

/**
 * Build an absolute URL for a given host + path. Used by the auth callback
 * to construct the emailRedirectTo URL.
 */
export function buildAbsoluteUrl(
  companySlug: string | null,
  path: string,
  rootDomain: string = env.NEXT_PUBLIC_ROOT_DOMAIN,
  scheme: "http" | "https" = env.NEXT_PUBLIC_APP_SCHEME,
): string {
  const host = companySlug ? `${companySlug}.${rootDomain}` : rootDomain;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${scheme}://${host}${normalizedPath}`;
}