import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { PrismaClient } from "@/lib/generated/prisma/client";
import { parseProductGrid, type ProductImportLine } from "@/lib/import-export/products-format";
import { productImportBatchSchema, productImportRowSchema } from "@/lib/products-import-rules";
import { variantGroupKeyOfLine, withVariantGroupSizes, type LocalRowForGroups } from "@/lib/products-import-variant-ui";

/**
 * Cost of ONE group of 200 variants (the cap), measured on the throwaway PostgreSQL database with the real
 * client: wall time, number of SQL statements, where the movement-number reservation sits in the transaction
 * and how long the movement counter is locked. Needs PRISMA_DEBUG_QUERIES=1 (the shared client then logs every
 * statement); same safety gate as the integration test: only the throwaway database `commdis_d2_test`.
 */

const D2 = process.env.D2_TEST_DATABASE_URL;
function isThrowaway(url: string | undefined): boolean {
  if (!url || process.env.DATABASE_URL !== url) return false;
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) && parsed.port === "5432" && parsed.pathname === "/commdis_d2_test";
  } catch {
    return false;
  }
}
const enabled = isThrowaway(D2) && process.env.PRISMA_DEBUG_QUERIES === "1";
const SKIP = enabled ? false : "needs the throwaway database commdis_d2_test and PRISMA_DEBUG_QUERIES=1 (use the wrapper)";

let prisma: PrismaClient;
let classify: typeof import("@/lib/server/products-import").classifyProductImportRows;
let resolveDefaults: typeof import("@/lib/server/products-import").resolveCreationDefaults;
let apply: typeof import("@/lib/server/products-import-apply").applyProductImportBatch;

/** Every statement the client logs, with the moment it was logged. */
const statements: Array<{ at: number; sql: string }> = [];
const realLog = console.log.bind(console);
before(async () => {
  if (!enabled) return;
  console.log = (...args: unknown[]) => {
    const text = String(args[0] ?? "");
    if (text.startsWith("[PRISMA #")) statements.push({ at: performance.now(), sql: text.replace(/^\[PRISMA #\d+ \+\d+ms dur=\d+(?:\.\d+)?ms\] /, "") });
    else realLog(...args);
  };
  ({ prisma } = await import("@/lib/prisma"));
  ({ classifyProductImportRows: classify, resolveCreationDefaults: resolveDefaults } = await import("@/lib/server/products-import"));
  ({ applyProductImportBatch: apply } = await import("@/lib/server/products-import-apply"));
});
after(async () => {
  console.log = realLog;
  if (enabled) await prisma.$disconnect().catch(() => undefined);
});

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);

async function makeOrg() {
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `PERF-${suffix}`.toUpperCase(), name: "Perf" } });
  const user = await prisma.user.create({
    data: { organizationId: organization.id, firstName: "P", lastName: "P", fullName: "Perf", email: `perf-${suffix}@example.invalid`, passwordHash: "x", role: "ADMIN" },
  });
  const depot = await prisma.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Dépôt", address: "-", city: "-" } });
  const location = await prisma.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Dépôt", type: "DEPOT", depotId: depot.id } });
  const supplier = await prisma.supplier.create({ data: { organizationId: organization.id, code: "F1", name: "F1" } });
  return { id: organization.id, userId: user.id, location: location.id, supplierId: supplier.id };
}

function variantsGrid(parent: string, count: number, over: { price?: number; stock?: number } = {}) {
  return Array.from({ length: count }, (_, index) => [parent, "", "Sport", 100, over.price ?? 150, over.stock ?? 5, `TAILLE: T${index}`]);
}

function readFile(grid: unknown[][]) {
  const parsed = parseProductGrid(grid);
  const local: Array<LocalRowForGroups & { values: ProductImportLine }> = parsed.lines.map(({ line, errors }) => ({ values: line, status: errors.length ? "ERROR" : "VALID", message: errors.join(" ; ") }));
  return { local, lines: withVariantGroupSizes(local.filter((row) => row.status === "VALID").map((row) => row.values), local) };
}

async function writeBatch(org: Awaited<ReturnType<typeof makeOrg>>, lines: ProductImportLine[], applyStock = true) {
  const input = productImportBatchSchema.parse({ rows: lines, applyStock, creationDefaults: { supplierId: org.supplierId, taxRate: 20 } });
  const creationDefaults = await resolveDefaults(org.id, input.creationDefaults);
  const classified = await classify(org.id, org.location, input.rows, { applyStock, creationDefaults, requireGroupSize: true });
  statements.length = 0;
  const started = performance.now();
  const outcome = await apply({ organizationId: org.id, userId: org.userId, locationId: org.location, rows: classified.rows });
  const ms = performance.now() - started;
  return { outcome, ms, sql: statements.map((entry) => entry.sql), times: statements.map((entry) => entry.at), classified };
}

const summary: string[] = [];

test("200 variants in one group: time, statements, and the movement counter is locked only at the very end", { skip: SKIP }, async (t) => {
  const org = await makeOrg();
  const { lines } = readFile(variantsGrid("Perf", 200));
  assert.equal(lines.length, 200);
  const run = await writeBatch(org, lines);

  assert.equal(run.outcome.groupsWritten, 1);
  assert.equal(run.outcome.results.filter((result) => result.status === "CREATED").length, 200);
  assert.equal(await prisma.product.count({ where: { organizationId: org.id } }), 200);
  assert.equal(await prisma.stockMovement.count({ where: { organizationId: org.id } }), 200);

  const productInserts = run.sql.map((sql, index) => (/INSERT INTO "public"."Product"/.test(sql) ? index : -1)).filter((index) => index >= 0);
  const sequenceStatements = run.sql.map((sql, index) => (/DocumentSequence/.test(sql) ? index : -1)).filter((index) => index >= 0);
  const lastProductInsert = Math.max(...productInserts);
  const movementReservation = sequenceStatements.filter((index) => index > lastProductInsert);
  const commit = run.sql.findIndex((sql, index) => index > lastProductInsert && /^COMMIT/.test(sql));

  // (a) the counter is touched after every product and level was written, and ONCE for all 200 movements
  assert.equal(productInserts.length, 200);
  assert.equal(movementReservation.length, 1, "one reservation for the whole block of 200 numbers");
  assert.equal(sequenceStatements.filter((index) => index < lastProductInsert).length, 1, "the only earlier use is the category code");
  // (b) how long is it locked? from that statement to the commit
  const lockedMs = commit >= 0 ? run.times[commit] - run.times[movementReservation[0]] : NaN;
  const spanMs = run.times[run.times.length - 1] - run.times[0];
  assert.ok(Number.isFinite(lockedMs), "the commit was observed");
  assert.ok(lockedMs < spanMs / 4, `the counter row is locked ${lockedMs.toFixed(0)} ms of a ${spanMs.toFixed(0)} ms transaction`);

  const line = `GROUP-200 create: ${run.ms.toFixed(0)} ms for the write, ${run.sql.length} SQL statements (${(run.sql.length / 200).toFixed(1)} per variant), movement counter locked ${lockedMs.toFixed(1)} ms of ${spanMs.toFixed(0)} ms`;
  summary.push(line);
  t.diagnostic(line);
  realLog("PERF " + line);
  realLog(`PERF extrapolation, same statements over a network with a round trip of 2 / 5 / 10 / 20 ms: ${[2, 5, 10, 20].map((rtt) => `${((run.ms + run.sql.length * rtt) / 1000).toFixed(1)} s`).join(" / ")} (transaction limit: 30 s)`);
});

test("200 ordinary lines (the historical path, one transaction each) for comparison, and the same 200 variants updated / re-imported", { skip: SKIP }, async (t) => {
  const org = await makeOrg();
  // historical: no variants
  const ordinary = Array.from({ length: 200 }, (_, index) => productImportRowSchema.parse({
    excelRow: index + 1, reference: `ORD-${index}`, name: `Ordinaire ${index}`, categoryName: "Sport", supplierCode: "F1", purchasePriceTTC: 100, salePriceTTC: 150, taxRate: 20, targetStock: 5,
  }));
  const { classifyProductImportRows } = await import("@/lib/server/products-import");
  const classified = await classifyProductImportRows(org.id, org.location, ordinary, { applyStock: true });
  statements.length = 0;
  const started = performance.now();
  const outcome = await apply({ organizationId: org.id, userId: org.userId, locationId: org.location, rows: classified.rows });
  const ordinaryMs = performance.now() - started;
  assert.equal(outcome.results.filter((result) => result.status === "CREATED").length, 200);
  const ordinarySql = statements.length;

  // variants: create, then price update of all 200, then identical re-import
  const grid = variantsGrid("Perf2", 200);
  const created = await writeBatch(org, readFile(grid).lines);
  const updated = await writeBatch(org, readFile(variantsGrid("Perf2", 200, { price: 180 })).lines);
  assert.equal(updated.outcome.results.filter((result) => result.status === "UPDATED").length, 200);
  const movementsBefore = await prisma.stockMovement.count({ where: { organizationId: org.id } });
  const same = await writeBatch(org, readFile(variantsGrid("Perf2", 200, { price: 180 })).lines);
  assert.equal(same.outcome.results.filter((result) => result.status === "UNCHANGED").length, 200);
  assert.equal(same.outcome.groupsWritten, 1, "a group of unchanged lines needs no transaction");
  assert.equal(same.sql.length, 0, "not one SQL statement for an unchanged group");
  assert.equal(await prisma.stockMovement.count({ where: { organizationId: org.id } }), movementsBefore);

  const lines = [
    `200 ordinary lines, 200 transactions: ${ordinaryMs.toFixed(0)} ms, ${ordinarySql} statements`,
    `200 variants, 1 transaction (create): ${created.ms.toFixed(0)} ms, ${created.sql.length} statements`,
    `200 variants, 1 transaction (price update, stock unchanged -> no movement): ${updated.ms.toFixed(0)} ms, ${updated.sql.length} statements`,
    `200 variants re-imported unchanged: ${same.ms.toFixed(0)} ms, ${same.sql.length} statements`,
  ];
  for (const line of lines) {
    summary.push(line);
    t.diagnostic(line);
    realLog("PERF " + line);
  }
});

test("201 variants in one group: refused before any write (the cap is not raised)", { skip: SKIP }, async () => {
  const org = await makeOrg();
  const { lines } = readFile(variantsGrid("TooMany", 201));
  const input = productImportBatchSchema.parse({ rows: lines.slice(0, 201), applyStock: true, creationDefaults: { supplierId: org.supplierId, taxRate: 20 } });
  const creationDefaults = await resolveDefaults(org.id, input.creationDefaults);
  const { rows, groups } = await classify(org.id, org.location, input.rows, { applyStock: true, creationDefaults, requireGroupSize: true });
  assert.equal(groups[0].blocked, true);
  assert.ok(rows.every((row) => row.status === "ERROR" || row.status === "CONFLICT"));
  const outcome = await apply({ organizationId: org.id, userId: org.userId, locationId: org.location, rows });
  assert.equal(outcome.groupsRefused, 1);
  assert.equal(await prisma.product.count({ where: { organizationId: org.id } }), 0);
  assert.equal(variantGroupKeyOfLine(lines[0]) !== null, true);
});
