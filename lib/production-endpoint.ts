/**
 * The known production Neon compute endpoint (hostname fragment only: it
 * identifies an endpoint but grants no access by itself) and the check built on
 * it. Kept free of "server-only" so that both lib/server/env-guard.ts and the
 * build guard (lib/build-plan.ts, run by tsx at build time) share ONE source of truth.
 */
export const KNOWN_PRODUCTION_ENDPOINT_SUBSTRING = "ep-old-block-aebwqtri";

export function connectionTargetsKnownProduction(value: string | undefined): boolean {
  return Boolean(value && value.includes(KNOWN_PRODUCTION_ENDPOINT_SUBSTRING));
}
