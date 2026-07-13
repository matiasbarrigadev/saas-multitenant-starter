/**
 * Uniform API response shape.
 *
 * Every endpoint returns one of three shapes:
 *   - { ok: true,  data: T,         meta? }      -> success
 *   - { ok: true,  data: T, warning:{...}, meta? } -> success with a soft warning
 *   - { ok: false, error: { code, message, details? }, requestId } -> failure
 *
 * Why this shape:
 *   - `ok` lets the client distinguish success/failure without HTTP-only heuristics.
 *     (We DO use HTTP status codes too, but a 200 with `ok:false` is allowed for
 *     "logical" failures that don't deserve a non-2xx status, e.g. validation.)
 *   - `requestId` makes log triage possible — the server logs include the same id.
 *   - `warning` lets endpoints return partial success (e.g. "notes saved, but
 *     email notification failed"). Clients can choose to surface or ignore.
 *
 * HTTP status conventions:
 *   - 200: success (ok:true or ok:false for logical errors)
 *   - 201: resource created
 *   - 400: validation
 *   - 401: auth required
 *   - 403: forbidden
 *   - 404: not found
 *   - 409: conflict
 *   - 500: internal
 *
 * IMPORTANT: do not return the raw error message from Supabase / Postgres
 * to the client. Always map to a friendly message; keep details in logs.
 */

import { NextResponse } from "next/server";

import { ApiErrorCode } from "@/lib/api/errors";

export interface ApiSuccessMeta {
  /** Total count for paginated responses. */
  count?: number;
  /** Current page (1-indexed). */
  page?: number;
  /** Items per page. */
  pageSize?: number;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: ApiSuccessMeta;
}

export interface ApiWarning<T> {
  ok: true;
  data: T;
  warning: { code: string; message: string };
  meta?: ApiSuccessMeta;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: ApiErrorCode;
    /** Human-readable, user-safe message. NEVER raw DB errors. */
    message: string;
    /** Optional structured details (e.g. validation field errors). */
    details?: unknown;
  };
  /** Correlates the response with server logs. */
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiWarning<T> | ApiFailure;

/**
 * Status code mapping for failure cases. Defaults are conservative; pass
 * `status` to override.
 */
const STATUS_FOR_CODE: Partial<Record<ApiErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  AUTH_SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  ROLE_INSUFFICIENT: 403,
  COMPANY_MISMATCH: 403,
  WORKSPACE_FORBIDDEN: 403,
  VALIDATION_FAILED: 400,
  MISSING_BODY: 400,
  INVALID_JSON: 400,
  NOT_FOUND: 404,
  COMPANY_NOT_FOUND: 404,
  WORKSPACE_NOT_FOUND: 404,
  CONFLICT: 409,
  ALREADY_EXISTS: 409,
  DB_ERROR: 500,
  INTERNAL_ERROR: 500,
  UPSTREAM_ERROR: 502,
};

/**
 * Build a successful response.
 *
 * Use this when the operation completed cleanly. For partial successes,
 * use `warn()` instead.
 */
export function ok<T>(data: T, init?: { status?: number; meta?: ApiSuccessMeta }) {
  const body: ApiSuccess<T> = { ok: true, data };
  if (init?.meta) body.meta = init.meta;
  return NextResponse.json(body, { status: init?.status ?? 200 });
}

/**
 * Build a "success with warning" response.
 *
 * Use this when the primary operation succeeded but a non-critical side
 * effect failed (e.g. sending an email, updating a cache). The client can
 * decide whether to surface the warning to the user.
 */
export function warn<T>(
  data: T,
  warning: { code: string; message: string },
  init?: { status?: number; meta?: ApiSuccessMeta },
) {
  const body: ApiWarning<T> = { ok: true, data, warning };
  if (init?.meta) body.meta = init.meta;
  return NextResponse.json(body, { status: init?.status ?? 200 });
}

/**
 * Build a failure response.
 *
 * Always log the error server-side before returning. The `message` here
 * is what the client sees — keep it user-safe.
 */
export function err(
  code: ApiErrorCode,
  message: string,
  init?: {
    status?: number;
    details?: unknown;
    requestId?: string;
  },
) {
  const requestId = init?.requestId ?? generateRequestId();
  const body: ApiFailure = {
    ok: false,
    error: { code, message, details: init?.details },
    requestId,
  };
  const status = init?.status ?? STATUS_FOR_CODE[code] ?? 500;
  return NextResponse.json(body, { status });
}

/**
 * Generate a request id for log correlation. Uses crypto.randomUUID when
 * available; falls back to a base36 timestamp + random string.
 */
function generateRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}