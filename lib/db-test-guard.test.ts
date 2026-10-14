import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { assertDevDatabaseOnly, assertLoopbackServer, checkDevDatabaseTarget } from "@/lib/db-test-guard";
import { KNOWN_PRODUCTION_ENDPOINT_SUBSTRING } from "@/lib/production-endpoint";

/**
 * No database is contacted here: the verdict is a pure function of an environment object, and the server check
 * runs against a fake client. The static tests at the end read the sources of every test that connects to the .env database.
 */

const LOCAL = "postgresql://dev:pw@localhost:5432/commdis";

test("a local development database is accepted", () => {
  for (const url of [LOCAL, "postgresql://dev:pw@127.0.0.1:5433/commdis?schema=public", "postgres://dev@[::1]:5432/commdis?sslmode=disable"]) {
    assert.deepEqual(checkDevDatabaseTarget({ DATABASE_URL: url, APP_ENV: "development" }), { ok: true }, url);
  }
  assert.deepEqual(checkDevDatabaseTarget({}), { ok: true }, "no URL at all: nothing to connect to");
});

test("production is refused: APP_ENV, Vercel environments and the known production endpoint (DATABASE_URL or DIRECT_URL)", () => {
  assert.equal(checkDevDatabaseTarget({ DATABASE_URL: LOCAL, APP_ENV: "production" }).ok, false);
  assert.equal(checkDevDatabaseTarget({ DATABASE_URL: LOCAL, VERCEL_ENV: "production" }).ok, false);
  assert.equal(checkDevDatabaseTarget({ DATABASE_URL: LOCAL, VERCEL_ENV: "preview" }).ok, false);
  const endpoint = `postgresql://u:p@${KNOWN_PRODUCTION_ENDPOINT_SUBSTRING}.eu-central-1.aws.neon.tech/db`;
  assert.equal(checkDevDatabaseTarget({ DATABASE_URL: endpoint }).ok, false);
  const viaDirect = checkDevDatabaseTarget({ DATABASE_URL: LOCAL, DIRECT_URL: endpoint });
  assert.equal(viaDirect.ok, false);
  assert.match(viaDirect.ok ? "" : viaDirect.reason, /DIRECT_URL/);
});

test("hosted / non-local hosts and unusable URLs are refused", () => {
  for (const url of [
    "postgresql://u:p@ep-x-123.eu-central-1.aws.neon.tech/db",
    "postgresql://u:p@10.0.0.5:5432/db",
    "postgresql://u:p@LOCALHOST:5432/db",
    "postgresql://u:p@localhost,ep-x.neon.tech:5432/db",
    "postgresql://localhost@ep-x.neon.tech/db",
    "mysql://u:p@localhost/db",
    "not a url",
  ]) {
    assert.equal(checkDevDatabaseTarget({ DATABASE_URL: url }).ok, false, url);
  }
});

test("connection parameters that could redirect the connection are refused", () => {
  for (const suffix of ["?host=ep-x.neon.tech", "?hostaddr=10.0.0.5", "?service=prod", "?options=-c%20search_path%3Dx", "?port=6543", "?dbname=other"]) {
    const verdict = checkDevDatabaseTarget({ DATABASE_URL: LOCAL + suffix });
    assert.equal(verdict.ok, false, suffix);
  }
});

test("without a URL the PG* variables may not point away from this machine", () => {
  assert.equal(checkDevDatabaseTarget({ PGHOST: "db.example.neon.tech" }).ok, false);
  assert.equal(checkDevDatabaseTarget({ PGHOSTADDR: "10.0.0.5" }).ok, false);
  assert.equal(checkDevDatabaseTarget({ PGHOST: "localhost" }).ok, true);
  assert.equal(checkDevDatabaseTarget({ PGHOST: "/var/run/postgresql" }).ok, true);
});

test("assertDevDatabaseOnly throws a message naming the file and stating that nothing was touched", () => {
  assert.doesNotThrow(() => assertDevDatabaseOnly("x.db.test.ts", { DATABASE_URL: LOCAL }));
  assert.throws(() => assertDevDatabaseOnly("lib/x.db.test.ts", { DATABASE_URL: "postgresql://u:p@db.neon.tech/db" }), /lib\/x\.db\.test\.ts[\s\S]*hosted[\s\S]*Nothing was connected to/);
});

const fakePrisma = (behaviour: () => Promise<Array<{ addr: string | null }>>) =>
  ({ $queryRaw: (() => behaviour()) as unknown as Parameters<typeof assertLoopbackServer>[0]["$queryRaw"] }) as Parameters<typeof assertLoopbackServer>[0];

test("assertLoopbackServer: a local server passes, a non-local server (e.g. a forwarded hosted port) is refused", async () => {
  for (const addr of ["::1", "127.0.0.1", "127.0.1.1", "unix-socket"]) await assert.doesNotReject(assertLoopbackServer(fakePrisma(async () => [{ addr }]), "t"), addr);
  for (const addr of ["10.1.2.3", "172.20.0.4", "203.0.113.9", "fe80::1"]) {
    await assert.rejects(assertLoopbackServer(fakePrisma(async () => [{ addr }]), "lib/x.db.test.ts"), /not a local address/, addr);
  }
  await assert.rejects(assertLoopbackServer(fakePrisma(async () => []), "t"), /unknown address/);
});

test("assertLoopbackServer: an unreachable server is not an error (nothing to protect; the test skips itself) and never leaves a timer behind", async () => {
  await assert.doesNotReject(assertLoopbackServer(fakePrisma(async () => Promise.reject(new Error("ECONNREFUSED"))), "t"));
  await assert.doesNotReject(assertLoopbackServer(fakePrisma(() => new Promise(() => undefined)), "t", 50), "a hung server times out quietly");
});

// ---------- static: every test that connects to the .env database calls the guard before it uses Prisma ----------

const NINE_DB_TESTS = [
  "lib/forecasting/product-daily-sales.db.test.ts",
  "lib/forecasting/purchase-forecast-cache.db.test.ts",
  "lib/forecasting/purchase-recommendation.db.test.ts",
  "lib/forecasting/sales-forecast.db.test.ts",
  "lib/modules/module-access.db.test.ts",
  "lib/server/import-export.db.test.ts",
  "lib/server/products-import-variants.db.test.ts",
  "lib/server/truck-loading-stock.db.test.ts",
  "lib/table-columns/preferences.db.test.ts",
];

const SEVEN_OTHER_TESTS = [
  "lib/server/assistant-pos-draft-tool.test.ts",
  "lib/server/assistant-purchase-tool.test.ts",
  "lib/server/client-portal-core.test.ts",
  "lib/server/commercial-analysis.test.ts",
  "lib/server/pos-product-ranking.test.ts",
  "lib/server/receivables.test.ts",
  "lib/server/sales-discount-indicator.test.ts",
];

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (/\.test\.tsx?$/.test(entry)) found.push(path.relative(process.cwd(), full).split(path.sep).join("/"));
  }
  return found;
}

/** The guard is imported, runs BEFORE the client exists, nothing uses Prisma between the two, and the server check opens the setup hook. */
function assertGuardedBeforeFirstPrismaUse(file: string): void {
  const source = readFileSync(path.join(process.cwd(), file), "utf8");
  assert.match(source, /import \{[^}]*assertDevDatabaseOnly[^}]*\} from "@\/lib\/db-test-guard"/, `${file}: imports the guard`);
  assert.match(source, /import \{[^}]*assertLoopbackServer[^}]*\} from "@\/lib\/db-test-guard"/, `${file}: imports the server check`);
  assert.equal(source.split("new PrismaClient(").length - 1, 1, `${file}: a single client`);
  const guard = source.indexOf("assertDevDatabaseOnly(");
  const client = source.indexOf("new PrismaClient(");
  assert.ok(guard > -1 && guard < client, `${file}: assertDevDatabaseOnly(...) runs before new PrismaClient(...)`);
  assert.equal(source.split("assertDevDatabaseOnly(").length - 1, 1, `${file}: the guard is called once`);
  assert.ok(source.includes(`assertDevDatabaseOnly("${file}")`), `${file}: the guard names its own file`);

  const hook = source.search(/before\(async \(\) => \{\s*await assertLoopbackServer\(prisma, "/);
  assert.ok(hook > client, `${file}: the setup hook starts with the server check`);
  assert.equal(source.split("assertLoopbackServer(prisma").length - 1, 1, `${file}: the server check is called once`);

  // Between the creation of the client and the setup hook, no statement may use Prisma (the hook runs before every test).
  const afterConstruct = source.indexOf("\n", client);
  const between = source.slice(afterConstruct, hook);
  assert.ok(!/\bprisma\b/.test(between), `${file}: Prisma is not used before the setup hook`);
  // Before the client is created nothing connects either (only imports and constants precede the guard).
  assert.ok(!/\bprisma\s*\./.test(source.slice(0, guard)), `${file}: Prisma is not used before the guard`);
}

test("static: the nine *.db.test.ts files, the seven other env-database tests and any future *.db.test.ts are guarded before their first use of Prisma", () => {
  const discovered = walk(path.join(process.cwd(), "lib")).filter((file) => file.endsWith(".db.test.ts"));
  for (const expected of [...NINE_DB_TESTS, ...SEVEN_OTHER_TESTS]) {
    assert.ok(readFileSync(path.join(process.cwd(), expected), "utf8").length > 0, `${expected} exists`);
  }
  for (const file of new Set([...NINE_DB_TESTS, ...SEVEN_OTHER_TESTS, ...discovered])) assertGuardedBeforeFirstPrismaUse(file);
});

test("static: no other test builds its own PrismaClient without the guard or the throwaway-database gate (no exceptions list)", () => {
  const covered = new Set([...NINE_DB_TESTS, ...SEVEN_OTHER_TESTS]);
  for (const file of walk(path.join(process.cwd(), "lib"))) {
    if (covered.has(file) || file === "lib/db-test-guard.test.ts") continue;
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    if (!source.includes("new PrismaClient(")) continue;
    assert.ok(
      source.includes("assertDevDatabaseOnly(") || source.includes("D2_TEST_DATABASE_URL"),
      `${file}: builds a PrismaClient without any guard (add assertDevDatabaseOnly + assertLoopbackServer, or gate it on the throwaway database)`,
    );
  }
});
