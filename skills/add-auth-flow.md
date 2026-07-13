<!--
add-auth-flow.md — Vendor-neutral skill for adding a sign-in method.
-->

# Skill: Add a new auth flow

## Pre-flight

1. Read `AGENTS.md` § 1.2 (Auth rules).
2. Read `docs/AUTH.md` (full magic-link flow with sequence diagram).
3. Read `app/api/auth/request-link/route.ts` and
   `app/auth/callback/route.ts` as worked examples.

## When NOT to use this skill

- You're changing how the **email magic link** flow itself works (e.g.
  customizing the email template, adding rate limits). Edit the existing
  files; do not create new ones.
- You need third-party identity providers with claims mapped through the
  JWT. That requires changes to `supabase/migrations/0003_auth_hook.sql`
  and is part of a bigger refactor; consult `docs/AUTH.md` first.

## Output

The agent produces:

1. `app/api/auth/<flow-name>/route.ts` — initiate.
2. `app/auth/<flow-name>-callback/route.ts` — exchange + redirect.
3. (UI) `app/(auth)/<flow-name>/page.tsx` — entry point.
4. Optionally update `app/(auth)/login/page.tsx` to add a button.

## Step 1 — Pick the provider

Supabase supports many providers (Google, GitHub, Apple, Azure, etc.).
Pick one and document why. For OAuth providers, the flow is:

1. **Initiate**: `supabase.auth.signInWithOAuth({ provider, options })`. The
   library returns a URL to redirect the user to. Redirect the browser
   there.
2. **Callback**: Supabase calls back to `/auth/v1/callback` (or your
   configured redirect URL). It exchanges the code and sets cookies.
   You don't need a custom callback unless you have post-login logic
   beyond landing in the right place.

For SMS / phone OTPs / email-passwordless / webauthn, the pattern is
similar but uses the matching Supabase method.

## Step 2 — Write the initiator

```ts
/**
 * Initiates a <flow-name> sign-in.
 *
 * For OAuth, this redirects the browser to the provider. For OTP / link,
 * it sends the message and waits for the user to act elsewhere.
 */

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { parseHost, buildAbsoluteUrl } from "@/lib/tenant/host";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  const supabase = await createClient();
  const host = parseHost(request.headers.get("host"));
  const redirectTo = buildAbsoluteUrl(
    host.companySlug,
    "/auth/<flow-name>-callback",
  );

  // OAuth example:
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "<provider>",
    options: { redirectTo },
  });

  if (error) {
    return NextResponse.redirect(
      buildAbsoluteUrl(host.companySlug, "/login?error=oauth_failed"),
    );
  }

  return NextResponse.redirect(data.url);
}
```

For non-OAuth flows (e.g. SMS OTP), the pattern is similar but you POST
a phone number first, then verify the OTP in a second endpoint.

## Step 3 — Write the callback (if non-OAuth)

```ts
/**
 * /auth/<flow-name>-callback — exchange the OTP for a session and
 * redirect to the user's first workspace.
 */
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { buildAbsoluteUrl } from "@/lib/tenant/host";
import { parseHost } from "@/lib/tenant/host";
import { env } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  // Re-use the post-login redirect logic (consider extracting to a
  // helper if you grow more flows).
  const host = parseHost(request.headers.get("host"));
  const { data: claims } = await supabase.auth.getClaims();
  const memberships = (claims?.claims?.app_metadata as any)
    ?.company_memberships as Array<{ company_slug: string; workspace_slug: string }> | undefined;
  const first = memberships?.[0];
  if (first) {
    return NextResponse.redirect(
      buildAbsoluteUrl(
        first.company_slug,
        `/w/${first.workspace_slug}/dashboard`,
      ),
    );
  }
  return NextResponse.redirect(`${origin}/onboarding`);
}
```

## Step 4 — Add UI

In `app/(auth)/login/page.tsx` (or the existing place), add a button:

```tsx
import Link from "next/link";

<Link
  href="/api/auth/<flow-name>"
  style={{
    display: "block",
    textAlign: "center",
    marginTop: "0.75rem",
    padding: "0.5rem",
    border: "1px solid #d4d4d4",
    borderRadius: 6,
  }}
>
  Continue with <Provider>
</Link>
```

## Step 5 — Update env + Supabase config

If using OAuth, in your Supabase project dashboard:

- Authentication → Providers → enable `<provider>`.
- Add the client ID and secret (or copy from your dev console).
- Add `https://<your-domain>/auth/<flow-name>-callback` to "Additional
  redirect URLs".

For local dev, also add the same URLs but with the local root domain.

Document new env vars in `.env.example` and add them to `lib/env.ts`.

## VERIFY

- [ ] Button on `/login` clicks through to the provider.
- [ ] After provider auth, lands on `/w/<slug>/dashboard`.
- [ ] Coexists with magic-link flow (both work).
- [ ] No new env vars were forgotten in `.env.example` and `lib/env.ts`.
- [ ] If OAuth, redirect URLs added in Supabase dashboard.

## Rollback

- Delete the new files.
- If using OAuth, disable the provider in Supabase dashboard.
- Revert env additions.
