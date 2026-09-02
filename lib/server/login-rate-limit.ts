import "server-only";

/**
 * In-process brute-force guard for POST /api/auth/login.
 *
 * Tracks failed attempts per key (see login/route.ts - one bucket for the
 * client IP, one for the attempted email, blocked if either trips) in a
 * plain in-memory Map: no new infrastructure, no schema change, matches
 * "modifications minimales" for this fix.
 *
 * IMPORTANT - single instance only. This Map lives in one Node process's
 * memory. It works correctly today (COMDIS runs as one `next start`
 * process). It will NOT work correctly once COMDIS is deployed across
 * multiple instances/replicas behind a load balancer: each instance keeps
 * its own counters, so an attacker spread across N instances effectively
 * gets N times the allowed attempts before any single instance blocks them
 * (the per-email key still helps some, since it does not depend on which
 * instance the request lands on for *that* dimension - but the per-IP key
 * and the block itself are only ever instance-local). Before/when moving to
 * multiple instances, replace this Map with a shared store every instance
 * reads and writes - either the Postgres database COMDIS already uses
 * (a small AUTH_LOGIN_ATTEMPT-style table, or an atomic counter row) or a
 * shared cache like Redis. The public functions below
 * (isLoginRateLimited/recordLoginFailure/recordLoginSuccess) are the only
 * integration points login/route.ts touches, so swapping the backing store
 * later does not require changing the route.
 */

type Bucket = {
  count: number;
  windowStartedAt: number;
  blockedUntil: number | null;
};

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes to accumulate failures
const MAX_ATTEMPTS = 5; // failures allowed within the window before blocking
const BLOCK_MS = 15 * 60 * 1000; // how long a tripped key stays blocked
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // automatic cleanup of stale buckets

const buckets = new Map<string, Bucket>();

function now() {
  return Date.now();
}

function isExpired(bucket: Bucket, t: number): boolean {
  if (bucket.blockedUntil) return bucket.blockedUntil <= t;
  return t - bucket.windowStartedAt > WINDOW_MS;
}

function getLiveBucket(key: string): Bucket | null {
  const bucket = buckets.get(key);
  if (!bucket) return null;
  if (isExpired(bucket, now())) {
    buckets.delete(key);
    return null;
  }
  return bucket;
}

export function isRateLimited(key: string): { blocked: boolean; retryAfterSeconds: number } {
  const bucket = getLiveBucket(key);
  if (!bucket?.blockedUntil) return { blocked: false, retryAfterSeconds: 0 };
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now()) / 1000)),
  };
}

export function recordFailure(key: string): void {
  const t = now();
  const existing = getLiveBucket(key);
  if (!existing) {
    buckets.set(key, { count: 1, windowStartedAt: t, blockedUntil: null });
    return;
  }
  existing.count += 1;
  if (existing.count >= MAX_ATTEMPTS) {
    existing.blockedUntil = t + BLOCK_MS;
  }
}

/** A successful login clears that key's history - typos before a correct
 * password should never lock a legitimate user out. */
export function recordSuccess(key: string): void {
  buckets.delete(key);
}

// Periodic cleanup so keys that are never touched again (a one-off failed
// attempt, an attacker who moves on) don't sit in memory forever. Guarded on
// globalThis the same way lib/prisma.ts guards its client singleton, so a
// dev-mode hot reload never stacks up duplicate intervals.
const globalForRateLimit = globalThis as unknown as {
  comdisLoginRateLimitSweep?: NodeJS.Timeout;
};

if (!globalForRateLimit.comdisLoginRateLimitSweep) {
  const interval = setInterval(() => {
    const t = now();
    for (const [key, bucket] of buckets) {
      if (isExpired(bucket, t)) buckets.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  interval.unref?.();
  globalForRateLimit.comdisLoginRateLimitSweep = interval;
}
