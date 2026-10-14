import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import type { PrismaClient } from "@/lib/generated/prisma/client";
import { parseProductGrid, type ProductImportLine } from "@/lib/import-export/products-format";
import { runBatchedImport, type BatchResponse } from "@/lib/products-import-batches";
import { productImportBatchSchema, productImportRowSchema } from "@/lib/products-import-rules";
import {
  externalErrorsForBatch,
  externalVariantErrors,
  selectLinesToWrite,
  variantGroupKeyOfLine,
  withVariantGroupSizes,
  type LocalRowForGroups,
} from "@/lib/products-import-variant-ui";
import { deriveVariantReference } from "@/lib/products-import-variants";

/**
 * REAL write of products with variants - the real Prisma client, the real classification, the real group
 * transaction, the real movement numbering - against a THROWAWAY PostgreSQL database.
 *
 * Safety: the file does nothing unless D2_TEST_DATABASE_URL names the local database `commdis_d2_test` AND
 * DATABASE_URL (what the shared Prisma client uses) is that very URL. It never reads .env's database.
 * Run it with the wrapper that creates the database, applies the 57 migrations and ALWAYS drops it.
 * Each test makes its own organisation, so tests do not depend on each other.
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
const enabled = isThrowaway(D2);
const SKIP = enabled ? false : "D2_TEST_DATABASE_URL is not the throwaway database commdis_d2_test (use the wrapper)";

type Server = {
  prisma: PrismaClient;
  classifyProductImportRows: typeof import("@/lib/server/products-import").classifyProductImportRows;
  resolveCreationDefaults: typeof import("@/lib/server/products-import").resolveCreationDefaults;
  applyProductImportBatch: typeof import("@/lib/server/products-import-apply").applyProductImportBatch;
};
let server: Server;

before(async () => {
  if (!enabled) return;
  const { prisma } = await import("@/lib/prisma");
  const imports = await import("@/lib/server/products-import");
  const apply = await import("@/lib/server/products-import-apply");
  server = {
    prisma,
    classifyProductImportRows: imports.classifyProductImportRows,
    resolveCreationDefaults: imports.resolveCreationDefaults,
    applyProductImportBatch: apply.applyProductImportBatch,
  };
  const row = await prisma.$queryRaw<Array<{ db: string }>>`select current_database() as db`;
  assert.equal(row[0].db, "commdis_d2_test", "connected to the throwaway database");
});

after(async () => {
  if (enabled) await server.prisma.$disconnect().catch(() => undefined);
});

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);

// ---- fixtures -----------------------------------------------------------------------------------------

type Org = Awaited<ReturnType<typeof makeOrg>>;

async function makeOrg(label: string) {
  const { prisma } = server;
  const suffix = uid();
  const organization = await prisma.organization.create({ data: { code: `D2-${label}-${suffix}`.toUpperCase(), name: `D2 ${label}` } });
  const user = await prisma.user.create({
    data: { organizationId: organization.id, firstName: "A", lastName: label, fullName: `Admin ${label}`, email: `d2-${suffix}@example.invalid`, passwordHash: "x", role: "ADMIN" },
  });
  const make = async (code: string) => {
    const depot = await prisma.depot.create({ data: { organizationId: organization.id, code: `${code}-${suffix}`, name: `Dépôt ${code}`, address: "-", city: "-" } });
    return prisma.stockLocation.create({ data: { organizationId: organization.id, code: `${code}-${suffix}`, name: `Dépôt ${code}`, type: "DEPOT", depotId: depot.id } });
  };
  const [depotA, depotB] = [await make("A"), await make("B")];
  const supplier = await prisma.supplier.create({ data: { organizationId: organization.id, code: "F1", name: "Fournisseur 1" } });
  const category = await prisma.category.create({ data: { organizationId: organization.id, name: "Autre" } });
  return { id: organization.id, userId: user.id, locationA: depotA.id, locationB: depotB.id, supplierId: supplier.id, otherCategoryId: category.id };
}

const cells = (parent: string, attrs: string, over: Partial<Record<number, unknown>> = {}) => {
  const row: unknown[] = [parent, "", "Sport", 100, 150, 5, attrs];
  for (const [index, value] of Object.entries(over)) row[Number(index)] = value;
  return row;
};
const ARSENAL = [cells("Arsenal", "TAILLE: S | COULEUR: NOIR"), cells("Arsenal", "TAILLE: M | COULEUR: NOIR"), cells("Arsenal", "TAILLE: L | COULEUR: NOIR")];
const SHORT = [cells("Short Nike", "TAILLE: S"), cells("Short Nike", "TAILLE: M")];

// ---- the pipeline, as the page and the routes run it -------------------------------------------------

type Local = LocalRowForGroups & { values: ProductImportLine };

function readFile(grid: unknown[][]) {
  const parsed = parseProductGrid(grid);
  assert.equal(parsed.fatal, undefined);
  const local: Local[] = parsed.lines.map(({ line, errors }) => ({ values: line, status: errors.length ? "ERROR" : "VALID", message: errors.join(" ; ") || "Valide" }));
  const valid = local.filter((row) => row.status === "VALID").map((row) => row.values);
  return { local, lines: withVariantGroupSizes(valid, local) };
}

type Options = {
  org: Org;
  location?: string;
  applyStock?: boolean;
  supplierId?: string | null;
  taxRate?: number;
  batchSize?: number;
  /** Runs between the classification and the write of a batch (to race another writer into the gap). */
  afterClassify?: () => Promise<void>;
  /** The lines of the file the browser "hides": removed before sending, not reported as refused. */
  hide?: (line: ProductImportLine) => boolean;
};

/** What POST /api/produits/import does for ONE batch (same calls, same options as the route). */
async function routeBatch(options: Options, local: Local[], batch: ProductImportLine[]) {
  const { org } = options;
  const location = options.location ?? org.locationA;
  const input = productImportBatchSchema.parse({
    rows: batch,
    applyStock: options.applyStock === true,
    creationDefaults: { ...(options.supplierId !== null ? { supplierId: options.supplierId ?? org.supplierId } : {}), taxRate: options.taxRate ?? 20 },
    externalErrors: externalErrorsForBatch(batch, local),
  });
  const creationDefaults = await server.resolveCreationDefaults(org.id, input.creationDefaults);
  const { rows } = await server.classifyProductImportRows(org.id, location, input.rows, {
    applyStock: input.applyStock === true,
    creationDefaults,
    externalErrors: input.externalErrors,
    requireGroupSize: true,
  });
  await options.afterClassify?.();
  return server.applyProductImportBatch({ organizationId: org.id, userId: org.userId, locationId: location, rows });
}

/** The page: preview the whole file, pick the whole groups to write, send them in group-safe batches. */
async function importFile(grid: unknown[][], options: Options) {
  const { org } = options;
  const location = options.location ?? org.locationA;
  const { local, lines } = readFile(grid);
  const rows = lines.map((line) => productImportRowSchema.parse(line));
  const creationDefaults = await server.resolveCreationDefaults(org.id, {
    ...(options.supplierId !== null ? { supplierId: options.supplierId ?? org.supplierId } : {}),
    taxRate: options.taxRate ?? 20,
  });
  const preview = await server.classifyProductImportRows(org.id, location, rows, {
    applyStock: options.applyStock === true,
    creationDefaults,
    externalErrors: externalVariantErrors(local),
  });
  const answers = new Map(preview.rows.map((row) => [row.excelRow, { status: row.status, groupBlocked: row.groupBlocked }]));
  const toWrite = selectLinesToWrite(lines, answers).filter((line) => !options.hide?.(line));
  const totals = { created: 0, updated: 0, unchanged: 0, conflicts: 0, errors: 0, groupsWritten: 0, groupsRolledBack: 0, groupsRefused: 0, movements: 0, categories: 0 };
  const results: Array<{ excelRow: number; status: string; message: string }> = [];
  const run = await runBatchedImport({
    rows: toWrite,
    groupOf: variantGroupKeyOfLine,
    batchSize: options.batchSize,
    sendBatch: async (batch): Promise<BatchResponse> => {
      const outcome = await routeBatch(options, local, batch);
      totals.groupsWritten += outcome.groupsWritten;
      totals.groupsRolledBack += outcome.groupsRolledBack;
      totals.groupsRefused += outcome.groupsRefused;
      totals.movements += outcome.stockMovementsCreated;
      totals.categories += outcome.categoriesCreated;
      for (const result of outcome.results) {
        results.push(result);
        if (result.status === "CREATED") totals.created += 1;
        else if (result.status === "UPDATED") totals.updated += 1;
        else if (result.status === "UNCHANGED") totals.unchanged += 1;
        else if (result.status === "CONFLICT") totals.conflicts += 1;
        else totals.errors += 1;
      }
      return { rows: outcome.results, deferred: outcome.deferred };
    },
  });
  return { preview, toWrite, totals, results, run, local, lines };
}

// ---- observing the database --------------------------------------------------------------------------

async function state(org: Org) {
  const { prisma } = server;
  const where = { organizationId: org.id };
  const [products, levels, movements, categories, suppliers, sequences] = await Promise.all([
    prisma.product.count({ where }),
    prisma.stockLevel.count({ where }),
    prisma.stockMovement.count({ where }),
    prisma.category.count({ where }),
    prisma.supplier.count({ where }),
    prisma.documentSequence.findMany({ where, orderBy: [{ documentType: "asc" }, { scopeKey: "asc" }], select: { documentType: true, scopeKey: true, currentValue: true } }),
  ]);
  return { products, levels, movements, categories, suppliers, sequences: sequences.map((row) => `${row.documentType}/${row.scopeKey}=${row.currentValue}`) };
}

const productsOf = (org: Org) => server.prisma.product.findMany({ where: { organizationId: org.id }, orderBy: { reference: "asc" } });
const stockOf = async (org: Org, reference: string, location: string) => {
  const product = await server.prisma.product.findFirst({ where: { organizationId: org.id, reference }, select: { id: true } });
  if (!product) return undefined;
  return (await server.prisma.stockLevel.findFirst({ where: { productId: product.id, locationId: location }, select: { quantity: true } }))?.quantity;
};
const referenceOf = (parent: string, attrs: Array<[string, string]>, category = "Sport") =>
  deriveVariantReference({ parentName: parent, categoryName: category, attributes: attrs.map(([name, value]) => ({ name, value })) }).reference;

// ---- tests ---------------------------------------------------------------------------------------------

test("a group is written: four variant columns, stock target, one movement per variant, numbers contiguous", { skip: SKIP }, async () => {
  const org = await makeOrg("write");
  const outcome = await importFile(ARSENAL, { org, applyStock: true });

  assert.deepEqual(outcome.results.map((result) => result.status), ["CREATED", "CREATED", "CREATED"]);
  assert.deepEqual([outcome.totals.groupsWritten, outcome.totals.groupsRolledBack, outcome.totals.groupsRefused], [1, 0, 0]);

  const products = await productsOf(org);
  assert.equal(products.length, 3);
  const first = products.find((product) => product.reference === referenceOf("Arsenal", [["TAILLE", "S"], ["COULEUR", "NOIR"]]))!;
  assert.equal(first.name, "Arsenal - S / NOIR");
  assert.equal(first.variantParentName, "Arsenal");
  assert.equal(first.variantGroupKey, "arsenal");
  assert.equal(first.variantKey, "couleur=noir;taille=s");
  assert.deepEqual(first.variantAttributes, [{ name: "TAILLE", value: "S" }, { name: "COULEUR", value: "NOIR" }]);
  assert.equal(first.defaultSupplierId, org.supplierId);
  assert.equal(Number(first.taxRate), 20);
  assert.equal(Number(first.purchasePrice), 83.33, "TTC 100 at 20 % -> HT");
  assert.equal(first.unit, "unité");

  for (const product of products) assert.equal(await stockOf(org, product.reference, org.locationA), 5, "the file's stock is the target of the importer's depot");
  assert.equal(await server.prisma.stockLevel.count({ where: { organizationId: org.id, locationId: org.locationB } }), 0, "the other depot has no level");

  const movements = await server.prisma.stockMovement.findMany({ where: { organizationId: org.id }, orderBy: { movementNumber: "asc" } });
  assert.equal(movements.length, 3);
  assert.deepEqual(movements.map((movement) => [movement.type, movement.quantity, movement.destinationLocationId, movement.referenceType]), Array(3).fill(["INVENTORY_ADJUSTMENT", 5, org.locationA, "PRODUCT_IMPORT"]));
  const numbers = movements.map((movement) => Number(movement.movementNumber.replace(/\D/g, "")));
  assert.deepEqual(numbers, [numbers[0], numbers[0] + 1, numbers[0] + 2], "reserved as ONE block of consecutive numbers");
  assert.equal(outcome.totals.categories, 1);
  assert.equal(await server.prisma.category.count({ where: { organizationId: org.id, name: "Sport" } }), 1);
});

test("a failure on the THIRD line rolls the whole group back - products, stock, movements, category, numbers", { skip: SKIP }, async () => {
  const org = await makeOrg("rollback");
  // the barcode of the third variant will be taken by another product between the classification and the write
  const grid = [cells("Short", "TAILLE: S"), cells("Short", "TAILLE: M"), cells("Short", "TAILLE: L", { 1: "611777" })];
  const before = await state(org);
  const outcome = await importFile(grid, {
    org,
    applyStock: true,
    afterClassify: async () => {
      await server.prisma.product.create({
        data: { organizationId: org.id, categoryId: org.otherCategoryId, reference: "AUTRE", barcode: "611777", name: "Autre", purchasePrice: 1, salePrice: 1, taxRate: 20, unit: "u" },
      });
    },
  });
  const after = await state(org);

  assert.deepEqual(outcome.results.map((result) => result.status).sort(), ["CONFLICT", "ERROR", "ERROR"]);
  assert.deepEqual([outcome.totals.groupsWritten, outcome.totals.groupsRolledBack], [0, 1]);
  assert.match(outcome.results.find((result) => result.status === "CONFLICT")!.message, /Code-barres déjà utilisé/);
  assert.deepEqual(after, { ...before, products: before.products + 1 }, "only the other writer's product exists; the group left no trace (levels, movements, category, supplier, sequences)");
  assert.equal(await server.prisma.category.count({ where: { organizationId: org.id, name: "Sport" } }), 0);
  assert.equal(outcome.totals.movements, 0);
  assert.equal(outcome.totals.categories, 0);
});

test("importing the same file again writes nothing: no transaction, no product, no movement, no number consumed", { skip: SKIP }, async () => {
  const org = await makeOrg("idem");
  await importFile([...ARSENAL, ...SHORT], { org, applyStock: true });
  const afterFirst = await state(org);
  const stamps = (await productsOf(org)).map((product) => product.updatedAt.getTime());

  const second = await importFile([...ARSENAL, ...SHORT], { org, applyStock: true });
  assert.ok(second.preview.rows.every((row) => row.status === "EXISTING_UNCHANGED"));
  assert.equal(second.toWrite.length, 0, "nothing is even sent");
  assert.deepEqual(await state(org), afterFirst);
  assert.deepEqual((await productsOf(org)).map((product) => product.updatedAt.getTime()), stamps, "not one product was touched");
});

test("stock stays a TARGET at the chosen depot: movement only when it changes, the other depot is never touched", { skip: SKIP }, async () => {
  const org = await makeOrg("stock");
  await importFile(SHORT, { org, applyStock: true });
  const reference = referenceOf("Short Nike", [["TAILLE", "S"]]);
  const product = (await server.prisma.product.findFirst({ where: { organizationId: org.id, reference } }))!;
  await server.prisma.stockLevel.create({ data: { organizationId: org.id, productId: product.id, locationId: org.locationB, quantity: 40 } });
  const movementsAfterFirst = await server.prisma.stockMovement.count({ where: { organizationId: org.id } });

  // same stock (5) and a new price: updated, no movement
  await importFile([cells("Short Nike", "TAILLE: S", { 4: 180 }), cells("Short Nike", "TAILLE: M")], { org, applyStock: true });
  assert.equal(await server.prisma.stockMovement.count({ where: { organizationId: org.id } }), movementsAfterFirst);
  assert.equal(await stockOf(org, reference, org.locationA), 5);

  // target 8: +3 (never 5 + 8), a single movement; depot B untouched
  await importFile([cells("Short Nike", "TAILLE: S", { 5: 8 }), cells("Short Nike", "TAILLE: M")], { org, applyStock: true });
  assert.equal(await stockOf(org, reference, org.locationA), 8);
  assert.equal(await stockOf(org, reference, org.locationB), 40);
  const last = (await server.prisma.stockMovement.findMany({ where: { organizationId: org.id, productId: product.id }, orderBy: { movementNumber: "desc" }, take: 1 }))[0];
  assert.deepEqual([last.quantity, last.destinationLocationId, last.sourceLocationId], [3, org.locationA, null]);

  // a stock in the file while "apply stock" is off: reported, not written
  const off = await importFile([cells("Short Nike", "TAILLE: S", { 5: 99 }), cells("Short Nike", "TAILLE: M")], { org, applyStock: false });
  assert.equal(await stockOf(org, reference, org.locationA), 8);
  assert.equal(off.toWrite.length, 0);

  // another depot as the target: that depot is brought to the target (-28), depot A keeps 8
  await importFile([cells("Short Nike", "TAILLE: S", { 5: 12 }), cells("Short Nike", "TAILLE: M")], { org, applyStock: true, location: org.locationB });
  assert.equal(await stockOf(org, reference, org.locationB), 12);
  assert.equal(await stockOf(org, reference, org.locationA), 8);
  const removal = (await server.prisma.stockMovement.findMany({ where: { organizationId: org.id, productId: product.id }, orderBy: { movementNumber: "desc" }, take: 1 }))[0];
  assert.deepEqual([removal.quantity, removal.sourceLocationId, removal.destinationLocationId], [28, org.locationB, null]);
});

test("organisations are isolated: the same file in two organisations gives two independent sets, and identities do not collide", { skip: SKIP }, async () => {
  const [one, two] = [await makeOrg("iso1"), await makeOrg("iso2")];
  await importFile(ARSENAL, { org: one, applyStock: true });
  await importFile(ARSENAL, { org: two, applyStock: true });
  assert.equal((await productsOf(one)).length, 3);
  assert.equal((await productsOf(two)).length, 3);
  const twoBefore = (await productsOf(two)).map((product) => product.updatedAt.getTime());
  const twoState = await state(two);

  // a price change in organisation one touches organisation one only
  await importFile([cells("Arsenal", "TAILLE: S | COULEUR: NOIR", { 4: 210 }), ARSENAL[1], ARSENAL[2]], { org: one, applyStock: true });
  assert.equal(Number((await server.prisma.product.findFirst({ where: { organizationId: one.id, reference: referenceOf("Arsenal", [["TAILLE", "S"], ["COULEUR", "NOIR"]]) } }))!.salePrice), 175);
  assert.deepEqual(await state(two), twoState);
  assert.deepEqual((await productsOf(two)).map((product) => product.updatedAt.getTime()), twoBefore);
});

test("an ordinary product joins the group only when reference, designation and category match EXACTLY and its variant fields are NULL", { skip: SKIP }, async () => {
  const org = await makeOrg("attach");
  const reference = referenceOf("Short", [["TAILLE", "S"]]);
  const sport = await server.prisma.category.create({ data: { organizationId: org.id, name: "Sport" } });
  const base = { organizationId: org.id, reference, purchasePrice: 1, salePrice: 1, taxRate: 20, unit: "unité", categoryId: sport.id, defaultSupplierId: org.supplierId };
  const ordinary = await server.prisma.product.create({ data: { ...base, name: "Short - S" } });

  const grid = [cells("Short", "TAILLE: S"), cells("Short", "TAILLE: M")];
  const joined = await importFile(grid, { org, applyStock: true });
  assert.deepEqual(joined.results.map((result) => result.status).sort(), ["CREATED", "UPDATED"]);
  const attached = (await server.prisma.product.findUnique({ where: { id: ordinary.id } }))!;
  assert.equal(attached.variantKey, "taille=s");
  assert.equal(attached.variantParentName, "Short");
  assert.equal(attached.variantGroupKey, "short");
  assert.equal((await productsOf(org)).length, 2, "no duplicate: the same product, now a variant");

  // not an exact match -> conflict, and the WHOLE group is blocked: nothing is written
  const other = await makeOrg("attach2");
  const sport2 = await server.prisma.category.create({ data: { organizationId: other.id, name: "Sport" } });
  const mismatch = await server.prisma.product.create({
    data: { organizationId: other.id, reference, purchasePrice: 1, salePrice: 1, taxRate: 20, unit: "unité", categoryId: sport2.id, name: "Un autre nom" },
  });
  const blocked = await importFile(grid, { org: other, applyStock: true });
  assert.ok(blocked.preview.rows.every((row) => row.status === "CONFLICT" || row.status === "ERROR"));
  assert.match(blocked.preview.rows.find((row) => row.status === "CONFLICT")!.message, /déjà utilisée par un autre produit \(désignation « Un autre nom »\)/);
  assert.equal(blocked.toWrite.length, 0);
  assert.equal((await productsOf(other)).length, 1);
  assert.equal((await server.prisma.product.findUnique({ where: { id: mismatch.id } }))!.variantKey, null);

  // another category -> conflict too
  const third = await makeOrg("attach3");
  const plage = await server.prisma.category.create({ data: { organizationId: third.id, name: "Plage" } });
  await server.prisma.category.create({ data: { organizationId: third.id, name: "Sport" } });
  await server.prisma.product.create({ data: { organizationId: third.id, reference, purchasePrice: 1, salePrice: 1, taxRate: 20, unit: "unité", categoryId: plage.id, name: "Short - S" } });
  const wrongCategory = await importFile(grid, { org: third, applyStock: true });
  assert.match(wrongCategory.preview.rows.find((row) => row.status === "CONFLICT")!.message, /catégorie « Plage »/);
  assert.equal((await productsOf(third)).length, 1);
});

test("a variant identity that already exists under ANOTHER reference is a conflict - nothing is created next to it", { skip: SKIP }, async () => {
  const org = await makeOrg("identity");
  // first import: no barcode, so the references are generated
  await importFile([cells("Short", "TAILLE: S"), cells("Short", "TAILLE: M")], { org, applyStock: true });
  const before = await state(org);
  // second file gives the first variant a barcode: its reference would now be the barcode
  const second = await importFile([cells("Short", "TAILLE: S", { 1: "611999" }), cells("Short", "TAILLE: M")], { org, applyStock: true });
  assert.match(second.preview.rows.find((row) => row.status === "CONFLICT")!.message, /existe déjà sous la référence/);
  assert.ok(second.preview.rows.every((row) => row.status !== "NEW"));
  assert.equal(second.toWrite.length, 0);
  assert.deepEqual(await state(org), before);
});

test("the variant columns are protected by the database too: unique identity, all-or-none, non-blank", { skip: SKIP }, async () => {
  const org = await makeOrg("db");
  await importFile(SHORT, { org, applyStock: true });
  const product = (await productsOf(org))[0];
  const duplicate = (reference: string, over: Record<string, unknown> = {}) =>
    server.prisma.product.create({
      data: {
        organizationId: org.id, categoryId: product.categoryId, reference, name: reference, purchasePrice: 1, salePrice: 1, taxRate: 20, unit: "u",
        variantParentName: product.variantParentName, variantGroupKey: product.variantGroupKey, variantKey: product.variantKey, variantAttributes: product.variantAttributes ?? [],
        ...over,
      },
    });
  await assert.rejects(duplicate("DUP-1"), (error: { code?: string }) => error.code === "P2002");
  await assert.rejects(duplicate("DUP-2", { variantKey: "taille=xl", variantParentName: null }), /Product_variant_all_or_none_check/);
  await assert.rejects(duplicate("DUP-3", { variantKey: "   " }), /Product_variant_values_check/);
});

test("a group the browser did not send complete is refused whole - even if the batches are cut by hand", { skip: SKIP }, async () => {
  const org = await makeOrg("incomplete");
  const before = await state(org);

  // 1. a line "hidden" by a modified browser: the group is short
  const hidden = await importFile(ARSENAL, { org, applyStock: true, hide: (line) => line.excelRow === 3 });
  assert.ok(hidden.results.every((result) => result.status === "ERROR" && /Groupe incomplet : 2 ligne\(s\) reçue\(s\) sur 3/.test(result.message)));
  assert.deepEqual(await state(org), before);

  // 2. a group cut into two requests by hand: each half is refused
  const { local, lines } = readFile(ARSENAL);
  const first = await routeBatch({ org, applyStock: true }, local, lines.slice(0, 2));
  const second = await routeBatch({ org, applyStock: true }, local, lines.slice(2));
  assert.ok([...first.results, ...second.results].every((result) => result.status === "ERROR" && /Groupe incomplet/.test(result.message)));
  assert.deepEqual(first.groupsWritten + second.groupsWritten, 0);
  assert.deepEqual(await state(org), before);

  // 3. a line the browser reports as refused: the group is blocked, the other lines are not written
  const withBad = [ARSENAL[0], ARSENAL[1], cells("Arsenal", "TAILLE L COULEUR NOIR")];
  const reported = await importFile(withBad, { org, applyStock: true });
  assert.equal(reported.toWrite.length, 0, "the page does not send a blocked group");
  const { local: badLocal, lines: goodLines } = readFile(withBad);
  const forced = await routeBatch({ org, applyStock: true }, badLocal, goodLines);
  assert.ok(forced.results.every((result) => result.status === "ERROR" && /Groupe bloqué|Groupe incomplet|ligne 3/.test(result.message)));
  assert.deepEqual(await state(org), before);

  // 4. sizes missing altogether: the write requires them
  const noSizes = await routeBatch({ org, applyStock: true }, local, lines.map((line) => {
    const withoutSize = { ...line };
    delete withoutSize.variantGroupSize;
    return withoutSize;
  }));
  assert.ok(noSizes.results.every((result) => result.status === "ERROR" && /Taille du groupe manquante/.test(result.message)));
  assert.deepEqual(await state(org), before);
});

test("without the page's supplier and VAT the new variants are refused - nothing is written", { skip: SKIP }, async () => {
  const org = await makeOrg("nodefaults");
  const before = await state(org);
  const outcome = await importFile(ARSENAL, { org, applyStock: true, supplierId: null });
  assert.equal(outcome.toWrite.length, 0);
  assert.ok(outcome.preview.rows.every((row) => row.status === "ERROR" && /fournisseur \(à choisir sur la page\)/.test(row.message)));
  assert.deepEqual(await state(org), before);
  // a supplier of ANOTHER organisation is refused as unknown
  const stranger = await makeOrg("stranger");
  await assert.rejects(server.resolveCreationDefaults(org.id, { supplierId: stranger.supplierId, taxRate: 20 }), /introuvable dans votre organisation/);
});

test("two submissions of the same file at the same time write the group ONCE - no duplicate, no extra movement", { skip: SKIP }, async (t) => {
  const org = await makeOrg("double");
  const { local, lines } = readFile(ARSENAL);
  // both requests classify the group as NEW before either one writes
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const barrier = async () => {
    arrived += 1;
    if (arrived === 2) release();
    await gate;
  };
  const outcomes = await Promise.all([
    routeBatch({ org, applyStock: true, afterClassify: barrier }, local, lines),
    routeBatch({ org, applyStock: true, afterClassify: barrier }, local, lines),
  ]);
  const statuses = outcomes.flatMap((outcome) => outcome.results.map((result) => result.status)).sort();
  assert.deepEqual(statuses.filter((status) => status === "CREATED"), ["CREATED", "CREATED", "CREATED"], "exactly one of the two wrote the group");
  assert.equal(outcomes.reduce((sum, outcome) => sum + outcome.groupsWritten, 0), 1);
  assert.equal((await productsOf(org)).length, 3);
  assert.equal(await server.prisma.stockMovement.count({ where: { organizationId: org.id } }), 3);
  assert.equal(await server.prisma.stockLevel.count({ where: { organizationId: org.id } }), 3);
  // the loser says why: either it saw the group already there, or its write was refused as a conflict to preview again
  const loser = outcomes.find((outcome) => outcome.groupsWritten === 0)!;
  t.diagnostic(`the loser says: ${JSON.stringify([...new Set(loser.results.map((r) => `${r.status}: ${r.message}`))])}`);
  assert.ok(loser.results.every((result) => ["CONFLICT", "ERROR", "UNCHANGED"].includes(result.status)));
});

test("several groups written at the same time all succeed: every movement has its own number, none is skipped or reused", { skip: SKIP }, async () => {
  const org = await makeOrg("parallel");
  const groups = ["Alpha", "Bravo", "Charlie", "Delta"].map((parent) => Array.from({ length: 8 }, (_, index) => cells(parent, `TAILLE: T${index}`)));
  const requests = groups.map((grid) => {
    const { local, lines } = readFile(grid);
    return routeBatch({ org, applyStock: true }, local, lines);
  });
  const outcomes = await Promise.all(requests);
  assert.equal(outcomes.reduce((sum, outcome) => sum + outcome.groupsWritten, 0), 4);
  assert.equal((await productsOf(org)).length, 32);
  const numbers = (await server.prisma.stockMovement.findMany({ where: { organizationId: org.id }, select: { movementNumber: true } })).map((movement) => Number(movement.movementNumber.replace(/\D/g, "")));
  assert.equal(numbers.length, 32);
  assert.equal(new Set(numbers).size, 32, "no number used twice");
  const sorted = [...numbers].sort((a, b) => a - b);
  assert.equal(sorted[31] - sorted[0], 31, "no number skipped");
  assert.equal(await server.prisma.category.count({ where: { organizationId: org.id, name: "Sport" } }), 1, "the category was created by one group and found by the others (or created once)");
});

test("an interrupted import resumes: groups already written are unchanged, the rest is written, nothing doubles", { skip: SKIP }, async () => {
  const org = await makeOrg("resume");
  const file = [...ARSENAL, ...SHORT, cells("Maillot", "TAILLE: S"), cells("Maillot", "TAILLE: M")];
  // the browser stops after the first batch: only the first group reached the server
  const { local, lines } = readFile(file);
  await routeBatch({ org, applyStock: true }, local, lines.filter((line) => line.variantParentName === "Arsenal"));
  assert.equal((await productsOf(org)).length, 3);

  const resumed = await importFile(file, { org, applyStock: true });
  assert.deepEqual(resumed.preview.rows.map((row) => row.status), ["EXISTING_UNCHANGED", "EXISTING_UNCHANGED", "EXISTING_UNCHANGED", "NEW", "NEW", "NEW", "NEW"]);
  assert.equal(resumed.totals.created, 4);
  assert.equal(resumed.totals.groupsWritten, 2);
  assert.equal((await productsOf(org)).length, 7);
  assert.equal(await server.prisma.stockMovement.count({ where: { organizationId: org.id } }), 7, "one movement per variant, not one more");
});

test("a batch mixing historical lines and a variants group writes both", { skip: SKIP }, async () => {
  const org = await makeOrg("mixed");
  const { local, lines } = readFile([...SHORT, ["Ballon", "", "Sport", 30, 50, 10, ""]]);
  const outcome = await routeBatch({ org, applyStock: true }, local, lines);
  assert.deepEqual(outcome.results.map((result) => result.status), ["CREATED", "CREATED", "CREATED"]);
  assert.equal(outcome.groupsWritten, 1);
  const ballon = (await productsOf(org)).find((product) => product.name === "Ballon")!;
  assert.equal(ballon.variantKey, null, "a product without variants has no variant identity");
});

test("two concurrent stock updates of the SAME group are serialized: all-or-nothing, never a mix of the two targets", { skip: SKIP }, async (t) => {
  const org = await makeOrg("serial");
  const grid = (stock: number) => Array.from({ length: 10 }, (_, index) => cells("Charlie", `TAILLE: T${index}`, { 5: stock }));
  await importFile(grid(5), { org, applyStock: true });
  const references = (await productsOf(org)).map((product) => product.reference);
  assert.equal(references.length, 10);

  // two requests, both classified against stock 5, writing targets 7 and 9 at the same time
  const classified = { first: readFile(grid(7)), second: readFile(grid(9)) };
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const barrier = async () => {
    arrived += 1;
    if (arrived === 2) release();
    await gate;
  };
  const [a, b] = await Promise.all([
    routeBatch({ org, applyStock: true, afterClassify: barrier }, classified.first.local, classified.first.lines),
    routeBatch({ org, applyStock: true, afterClassify: barrier }, classified.second.local, classified.second.lines),
  ]);
  t.diagnostic(`first: ${JSON.stringify([...new Set(a.results.map((r) => r.status))])} second: ${JSON.stringify([...new Set(b.results.map((r) => r.status))])}`);

  const levels = await Promise.all(references.map((reference) => stockOf(org, reference, org.locationA)));
  assert.equal(new Set(levels).size, 1, `all ten variants hold the same quantity (${JSON.stringify(levels)}): a group is never half-updated`);
  assert.ok(levels[0] === 7 || levels[0] === 9);
  // every committed group moved all ten variants: movements = 10 (creation) + 10 per committed update (+ 10 more only if both committed one after the other)
  const movements = await server.prisma.stockMovement.count({ where: { organizationId: org.id } });
  const committedUpdates = [a, b].reduce((sum, outcome) => sum + outcome.groupsWritten, 0);
  assert.equal(movements, 10 + 10 * committedUpdates);
  const numbers = (await server.prisma.stockMovement.findMany({ where: { organizationId: org.id }, select: { movementNumber: true } })).map((m) => m.movementNumber);
  assert.equal(new Set(numbers).size, numbers.length, "no movement number used twice");
});
