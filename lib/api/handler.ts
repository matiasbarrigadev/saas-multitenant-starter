/**
 * withApi(): wraps a Route Handler with try/catch + uniform error mapping.
 *
 * Without this, every route handler has to repeat:
 *   1. Wrap body in try/catch.
 *   2. Catch TenantContextError and map to a 401/403/404.
 *   3. Catch ZodError and map to 400.
 *   4. Catch everything else and return 500 (with logging, never to client).
 *
 * `withApi(handler)` collapses all that into one line:
 *
 *   export const GET = withApi(async (req, ctx) => {
 *     const user = await getActiveContext();   // may throw TenantContextError
 *     const data = await someQuery(user);
 *     return ok(data);
 *   });
 *
 * The handler can return:
 *   - `ok(data)`, `warn(data, ...)`, `err(code, message)` -> passed through.
 *   - A plain object -> wrapped as `ok(plainObject)` (handy for simple GETs).
 *   - `undefined` / `null` -> wrapped as `ok(null)`.
 *   - A thrown error -> caught and mapped to a 500 (or to its API code if it's
 *     a TenantContextError / ZodError).
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ApiErrorCode } from "@/lib/api/errors";
import { err, ok } from "@/lib/api/response";
import { TenantContextError } from "@/lib/tenant/context";

type RouteHandler<TCtx = unknown> = (
  request: Request,
  context: TCtx,
) => Promise<NextResponse | Response | unknown>;

export function withApi<TCtx = unknown>(handler: RouteHandler<TCtx>) {
  return async (request: Request, context: TCtx): Promise<NextResponse> => {
    const requestId =
      request.headers.get("x-request-id") ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`);

    try {
      const result = await handler(request, context);

      // Already a Response: pass through (after adding headers).
      if (result instanceof Response) {
        const enriched = new NextResponse(result.body, {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
        });
        applyCacheHeaders(enriched);
        enriched.headers.set("x-request-id", requestId);
        return enriched;
      }

      // Plain value: wrap as ok().
      const response = ok(result);
      applyCacheHeaders(response);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (caught) {
      return mapError(caught, requestId);
    }
  };
}

/**
 * Map any thrown error to a uniform JSON failure response. Logs the
 * full error server-side; the client only sees the safe code + message.
 */
function mapError(caught: unknown, requestId: string): NextResponse {
  // Tenant context errors: 401 / 403 / 404 depending on the specific code.
  if (caught instanceof TenantContextError) {
    return err(caught.code as ApiErrorCode, caught.message, { requestId });
  }

  // Zod validation errors.
  if (caught instanceof ZodError) {
    return err(
      ApiErrorCode.VALIDATION_FAILED,
      "Request validation failed.",
      { requestId, details: caught.flatten() },
    );
  }

  // Supabase errors (PostgrestError, AuthError, etc.) — they all expose
  // .message and sometimes .code. We log and return a generic 500 unless
  // the caller has already turned the error into a typed ApiError.
  if (
    caught &&
    typeof caught === "object" &&
    "code" in caught &&
    typeof (caught as { code: unknown }).code === "string"
  ) {
    const code = (caught as { code: string }).code;
    // Common PostgREST error codes we want to surface as 4xx.
    if (code === "PGRST116") {
      // No rows returned for .single() — caller likely meant .maybeSingle().
      return err(ApiErrorCode.NOT_FOUND, "Resource not found.", { requestId });
    }
  }

  // Anything else: log full error and return generic 500.
  console.error(`[withApi] Unhandled error (requestId=${requestId}):`, caught);
  return err(
    ApiErrorCode.INTERNAL_ERROR,
    "An unexpected error occurred.",
    { requestId },
  );
}

/**
 * Apply Cache-Control: no-store to all API responses.
 *
 * Why: per the deep research on Supabase multitenant safety, the #1
 * risk is Vercel's CDN caching an authenticated response and serving
 * it to a different tenant. Setting no-store here is the canonical
 * Supabase recommendation. See docs/AUTH.md.
 */
function applyCacheHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
}