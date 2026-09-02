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

const BENIGN_PRISMA_CODES = new Set(["P2002", "P2003", "P2025", "P2034"]);
const BUSINESS_ERROR_NAMES = new Set([
  "AuthServiceError",
  "OperationsServiceError",
  "ProductServiceError",
]);

/**
 * `true` for errors that are an expected part of normal operation and must
 * never reach Sentry:
 *   - domain errors (`AuthServiceError` / `OperationsServiceError` /
 *     `ProductServiceError`) - they carry a 4xx `status`;
 *   - any other object that already carries a 4xx `status`;
 *   - Prisma races / lookups the app already handles: `P2002` / `P2034`
 *     (retried by `withSerializableRetry`), `P2025` / `P2003` (missing /
 *     dangling row -> surfaced as 404 / 409).
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
  Sentry.captureException(error, {
    tags: {
      route: context.route,
      ...(context.area ? { area: context.area } : {}),
      ...(context.op ? { op: context.op } : {}),
    },
  });
}
