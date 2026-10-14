import type { PrismaClient } from "@/lib/generated/prisma/client";
import { KNOWN_PRODUCTION_ENDPOINT_SUBSTRING, connectionTargetsKnownProduction } from "@/lib/production-endpoint";

/**
 * Guard of the database tests that connect to the DEVELOPMENT database of `.env` (the `*.db.test.ts` files).
 * They write only inside transactions that are always rolled back, but they must never even be pointed at a production
 * or hosted database: locks, load and any failure of the rollback would be real there.
 *
 * Why not lib/server/env-guard.ts: it starts with `import "server-only"`, a package that is not installed and that Next
 * aliases at build time, so it cannot be loaded by a plain `tsx --test`. This module is free of it and reuses the same
 * source of truth for the production endpoint (lib/production-endpoint.ts) and the same two signals (APP_ENV, endpoint),
 * then goes further: the database host must be local (loopback), the URL may carry no parameter that redirects the
 * connection, and - once connected - the PostgreSQL server itself must answer from a local address.
 *
 * Nothing here touches a database except the one read-only `assertLoopbackServer` query.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ALLOWED_PARAMS = new Set(["schema", "sslmode", "connect_timeout", "connection_limit", "pool_timeout"]);

export type DevDatabaseVerdict = { ok: true } | { ok: false; reason: string };

function isLocalPgHost(value: string): boolean {
  return value.startsWith("/") || LOOPBACK_HOSTS.has(value);
}

/** Pure decision: may the database tests run against the database described by this environment? */
export function checkDevDatabaseTarget(env: Record<string, string | undefined> = process.env): DevDatabaseVerdict {
  if (env.APP_ENV === "production") return { ok: false, reason: "APP_ENV=production" };
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") return { ok: false, reason: `VERCEL_ENV=${env.VERCEL_ENV}` };
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    if (connectionTargetsKnownProduction(env[key])) {
      return { ok: false, reason: `${key} targets the known production endpoint (${KNOWN_PRODUCTION_ENDPOINT_SUBSTRING})` };
    }
  }

  const raw = env.DATABASE_URL?.trim();
  if (!raw) {
    // No URL: the driver would fall back to the PG* variables - they must not point away from this machine.
    for (const key of ["PGHOST", "PGHOSTADDR"] as const) {
      const value = env[key];
      if (value && !isLocalPgHost(value)) return { ok: false, reason: `DATABASE_URL is empty and ${key} points to a non-local host` };
    }
    return { ok: true };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a valid URL" };
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return { ok: false, reason: "DATABASE_URL is not a postgresql:// URL" };
  if (!LOOPBACK_HOSTS.has(url.hostname)) return { ok: false, reason: `DATABASE_URL points to a non-local (hosted) database host (${url.hostname})` };
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) return { ok: false, reason: `DATABASE_URL carries the connection parameter "${key}", which could redirect the connection` };
  }
  return { ok: true };
}

/** Throws if the environment points the tests at a production or hosted database. Call it before creating any PrismaClient. */
export function assertDevDatabaseOnly(context: string, env: Record<string, string | undefined> = process.env): void {
  const verdict = checkDevDatabaseTarget(env);
  if (!verdict.ok) {
    throw new Error(
      `[db-test-guard] Refusing to run "${context}": ${verdict.reason}. ` +
        "These tests only run against a local development database. Nothing was connected to and nothing was written.",
    );
  }
}

/**
 * After the client exists: the PostgreSQL server must answer from a loopback address (a local port forwarded to a hosted
 * server passes the URL check but not this one). A server that cannot be reached is not an error here - there is nothing
 * to protect, and the test's own reachability check skips itself.
 */
export async function assertLoopbackServer(prisma: Pick<PrismaClient, "$queryRaw">, context: string, timeoutMs = 20_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addr: string;
  try {
    const rows = await Promise.race([
      prisma.$queryRaw<Array<{ addr: string | null }>>`select coalesce(host(inet_server_addr()), 'unix-socket') as addr`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    addr = rows[0]?.addr ?? "";
  } catch {
    return;
  } finally {
    clearTimeout(timer);
  }
  if (!(addr.startsWith("127.") || addr === "::1" || addr === "unix-socket")) {
    throw new Error(
      `[db-test-guard] Refusing to run "${context}": the PostgreSQL server answered from ${addr || "an unknown address"}, which is not a local address. ` +
        "The tests stopped before any statement other than this read-only check.",
    );
  }
}
