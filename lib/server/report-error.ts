import "server-only";

import * as Sentry from "@sentry/nextjs";

export type ReportErrorContext = {
  /**
   * Static route label, e.g. `"GET /api/brands"`. NEVER interpolate ids,
   * query params or any request-derived value into this.
   */
  route: string;
  /** Coarse functional area, e.g. `"driver"`, `"stock"`, `"sales"`. */
  area?: string;
  /** Service operation name, e.g. `"createCounterSale"`. */
  op?: string;
};

// P2002 (unique constraint - numbering/idempotency races, pre-checked
// uniqueness), P2003 (FK - surfaced as 404/409), P2025 (row not found -
// surfaced as 404) are expected and handled.
//
// P2034 (write conflict / deadlock) is deliberately NOT here (4Q.4C): every
// Serializable transaction in lib/server is wrapped in a local
// `withSerializableRetry` that retries P2034 up to 40 times with backoff and
// only rethrows it once *fully exhausted*. So a P2034 that actually reaches a
// route catch is a genuine, persistent contention incident worth an alert -
// not a transient race.
const BENIGN_PRISMA_CODES = new Set(["P2002", "P2003", "P2025"]);
const BUSINESS_ERROR_NAMES = new Set([
  "AuthServiceError",
  "OperationsServiceError",
  "ProductServiceError",
]);

/** Matches a Prisma error code like `P2034`, `P1001` - safe, non-sensitive. */
const PRISMA_CODE_RE = /^P\d{4}$/;

/**
 * `true` for errors that are an expected part of normal operation and must
 * never reach Sentry:
 *   - domain errors (`AuthServiceError` / `OperationsServiceError` /
 *     `ProductServiceError`) - they carry a 4xx `status`;
 *   - any other object that already carries a 4xx `status`;
 *   - Prisma races / lookups the app already handles: `P2002` (unique /
 *     numbering race), `P2025` / `P2003` (missing / dangling row -> surfaced
 *     as 404 / 409).
 *
 * `P2034` is NOT treated as benign (4Q.4C): `withSerializableRetry` absorbs
 * the transient ones, so one that reaches here is retry-exhausted.
 *
 * See PHASE-4Q.3 for the full classification.
 */
export function isExpectedBusinessError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; status?: unknown; code?: unknown };
  if (
    typeof candidate.status === "number" &&
    candidate.status >= 400 &&
    candidate.status < 500
  ) {
    return true;
  }
  if (typeof candidate.name === "string" && BUSINESS_ERROR_NAMES.has(candidate.name)) {
    return true;
  }
  if (typeof candidate.code === "string" && BENIGN_PRISMA_CODES.has(candidate.code)) {
    return true;
  }
  return false;
}

/**
 * Report a genuinely unexpected server error to Sentry. A no-op for expected
 * business errors (see `isExpectedBusinessError`) and whenever Sentry is not
 * enabled (no DSN / not a Vercel deployment).
 *
 * Deliberately accepts only a small static `context` object - never a
 * `Request`, body, headers or cookies - so no call site can leak PII through
 * it. The `beforeSend` scrubber is the second line of defence.
 */
export function reportUnexpected(error: unknown, context: ReportErrorContext): void {
  if (isExpectedBusinessError(error)) return;

  // Non-sensitive Prisma error code (`P2034`, `P1001`, `P2028`, ...) as a tag,
  // to triage infra failures without any SQL, query or row data.
  const code =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  const prismaCode = code && PRISMA_CODE_RE.test(code) ? code : undefined;

  Sentry.captureException(error, {
    tags: {
      route: context.route,
      ...(context.area ? { area: context.area } : {}),
      ...(context.op ? { op: context.op } : {}),
      ...(prismaCode ? { prisma_code: prismaCode } : {}),
    },
  });
}
