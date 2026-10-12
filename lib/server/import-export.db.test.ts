import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { ACCOUNT_SHEET_NAME, parseAccountTable, type AccountImportLine, type AccountTypeCode } from "@/lib/import-export/accounts-format";
import { runAccountsExport, runProductsExport, type ExportFormat, type FetchJson } from "@/lib/import-export/export-runner";
import { base64ToBytes, photoDataUrl } from "@/lib/import-export/images";
import { photoUploadBatches, readProductImportFile } from "@/lib/import-export/product-import-file";
import type { ProductColumnKey } from "@/lib/import-export/products-format";
import { readTableFile } from "@/lib/import-export/tabular";
import { productImportSchema } from "@/lib/products-import-rules";
import { writeImportBatch, type ImportWriteStore } from "@/lib/products-import-writer";

import { accountImportSchema, applyAccountImportRows, classifyAccountImportRowsWith } from "./accounts-import-core";
import { loadAccountsExportPage } from "./accounts-export-core";
import { applyProductPhotos, loadProductExportPhotos, loadProductsExportPage } from "./products-export-core";
import { classifyProductImportRowsWith, productImportLineTx, type ImportSequences } from "./products-import-core";
import { OperationsServiceError } from "./service-error";

/**
 * Export -> file -> import, against a REAL database (run it on the isolated test
 * database only): every test runs inside ONE transaction that is always rolled
 * back - nothing is kept. Two throwaway organisations per test (source A,
 * target B). The files are produced by the same runner as the browser (fed by
 * the server cores instead of HTTP) and read back by the same readers as the
 * import pages. Skipped when no database is reachable.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let reachable = false;

before(async () => {
  try {
    await Promise.race([prisma.$queryRaw`select 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000))]);
    reachable = true;
  } catch {
    reachable = false;
  }
});

after(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);

async function inRollback(run: (tx: Tx) => Promise<void>) {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await run(tx);
        throw new Rollback();
      },
      { timeout: 180_000, maxWait: 20_000 },
    ),
    Rollback,
  );
}

async function makeOrg(tx: Tx, label: string) {
  const suffix = uid();
  const organization = await tx.organization.create({ data: { code: `T-IEX-${suffix}`.toUpperCase(), name: `Test import/export ${label}` } });
  const admin = await tx.user.create({
    data: { organizationId: organization.id, firstName: "A", lastName: label, fullName: `Admin ${label}`, email: `iex-${suffix}@example.invalid`, passwordHash: "x", role: "ADMIN" },
  });
  const depot = await tx.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: `Dépôt ${label}`, address: "-", city: "-" } });
  const location = await tx.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Dépôt", type: "DEPOT", depotId: depot.id } });
  const truckLocation = await tx.stockLocation.create({ data: { organizationId: organization.id, code: `T-${suffix}`, name: "Camion", type: "TRUCK" } });
  return { id: organization.id, userId: admin.id, locationId: location.id, truckLocationId: truckLocation.id };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

let sequence = 0;
const SEQUENCES: ImportSequences = {
  nextCategoryCode: async () => `CAT-${uid()}-${++sequence}`,
  nextMovementNumber: async () => `MVT-${uid()}-${++sequence}`,
};

/** The runner's API calls served by the server cores, for organisation `org`, inside the test transaction. */
function coreFetch(tx: Tx, org: Org): FetchJson {
  return async <T,>(url: string, init?: { method: "POST"; body: unknown }): Promise<T> => {
    const parsed = new URL(url, "http://local");
    const params = parsed.searchParams;
    if (parsed.pathname === "/api/produits/export") {
      const page = await loadProductsExportPage(tx, org.id, {
        filters: { search: params.get("search") ?? undefined, categoryId: params.get("categoryId") ?? undefined, status: params.get("status") ?? undefined },
        cursor: params.get("cursor") || null,
        pageSize: 2, // several pages even for a handful of products
        depotLocationId: params.get("stock") === "1" ? org.locationId : null,
      });
      return { ...page, depotName: params.get("stock") === "1" ? "Dépôt" : null } as T;
    }
    if (parsed.pathname === "/api/produits/export/photos") {
      return (await loadProductExportPhotos(tx, org.id, (init!.body as { references: string[] }).references)) as T;
    }
    if (parsed.pathname === "/api/comptes/export") {
      return (await loadAccountsExportPage(tx, org.id, {
        type: params.get("type") as AccountTypeCode,
        cursor: params.get("cursor") || null,
        pageSize: 2,
        includeGps: params.get("gps") === "1",
      })) as T;
    }
    throw new Error(`unexpected call ${url}`);
  };
}

/** The products import as the routes do it: schema, classification, then the per-line writer. */
async function importProducts(tx: Tx, org: Org, bytes: Uint8Array, fileName: string, applyStock: boolean) {
  const file = readProductImportFile(bytes, fileName);
  assert.equal(file.parsed.fatal, undefined);
  assert.deepEqual(file.parsed.lines.filter((line) => line.errors.length), [], "every line of an export is readable");
  const input = productImportSchema.parse({ rows: file.parsed.lines.map((line) => line.line), applyStock });
  const classified = await classifyProductImportRowsWith(tx, org.id, org.locationId, input.rows, { applyStock });
  const store: ImportWriteStore = {
    runLine: (work) => work(productImportLineTx(tx, org.id, org.userId, org.locationId, SEQUENCES)),
    describeError: (error) => (error instanceof OperationsServiceError ? { status: error.status, message: error.message } : null),
  };
  const outcome = await writeImportBatch(store, classified.rows, { budgetMs: 600_000 });
  const photos = file.parsed.lines.flatMap((line) => {
    const photo = file.photos.get(line.line.excelRow);
    return photo ? [{ reference: line.line.reference, mime: photo.mime, bytes: photo.bytes }] : [];
  });
  const photoResults = [];
  for (const batch of photoUploadBatches(photos)) photoResults.push(...(await applyProductPhotos(tx, org.id, batch)));
  return { file, classified, outcome, photoResults };
}

async function importAccounts(tx: Tx, org: Org, lines: AccountImportLine[], canImportEmployees = true) {
  const input = accountImportSchema.parse({ rows: lines });
  const classified = await classifyAccountImportRowsWith(tx, org.id, input.rows, { canImportEmployees });
  const results = await applyAccountImportRows((work) => work(tx), org.id, org.userId, classified.rows);
  return { classified, results };
}

const PNG = base64ToBytes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!;
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const ALL_PRODUCT_COLUMNS: ProductColumnKey[] = [
  "name",
  "categoryName",
  "supplierCode",
  "supplierName",
  "purchasePriceTTC",
  "salePriceTTC",
  "retailPriceTTC",
  "semiWholesalePriceTTC",
  "semiWholesaleMinQty",
  "wholesaleMinQty",
  "taxRate",
  "unit",
  "barcode",
  "brandName",
  "description",
  "minimumStock",
  "status",
];

async function seedProducts(tx: Tx, org: Org) {
  const category = await tx.category.create({ data: { organizationId: org.id, code: `C-${uid()}`, name: "Boissons", active: true } });
  const supplier = await tx.supplier.create({ data: { organizationId: org.id, code: "F-01", name: "Sidi Ali SA" } });
  const brand = await tx.brand.create({ data: { organizationId: org.id, name: "Sidi Ali", active: true } });
  // awkward HT / VAT pairs: the TTC written in the file must give back exactly the same HT
  const specs = [
    { reference: "EAU/1,5L", purchasePrice: "4.17", salePrice: "5.83", taxRate: "20", retailPrice: "6.67", semi: "6.25", photo: photoDataUrl(PNG, "image/png") },
    { reference: "JUS;ORANGE", purchasePrice: "0.01", salePrice: "1234.56", taxRate: "7", retailPrice: null, semi: null, photo: photoDataUrl(JPEG, "image/jpeg") },
    { reference: 'LAIT "1L"', purchasePrice: "3.33", salePrice: "9.99", taxRate: "5.5", retailPrice: null, semi: null, photo: "https://cdn.example.com/lait.png" },
    { reference: "007", purchasePrice: "10.00", salePrice: "12.50", taxRate: "14", retailPrice: null, semi: null, photo: null },
  ];
  const products = [];
  for (const [index, spec] of specs.entries()) {
    products.push(
      await tx.product.create({
        data: {
          organizationId: org.id,
          reference: spec.reference,
          name: `Produit ${index} « spécial »`,
          categoryId: category.id,
          defaultSupplierId: supplier.id,
          brandId: index === 0 ? brand.id : null,
          purchasePrice: spec.purchasePrice,
          salePrice: spec.salePrice,
          taxRate: spec.taxRate,
          retailPrice: spec.retailPrice,
          semiWholesalePrice: spec.semi,
          semiWholesaleMinQty: spec.semi ? 6 : null,
          wholesaleMinQty: spec.semi ? 24 : null,
          unit: index === 0 ? "bouteille" : "unité",
          barcode: index === 0 ? "6111234567890" : null,
          description: index === 1 ? "=formule ; pas exécutée" : null,
          minimumStock: index,
          status: index === 3 ? "INACTIVE" : "ACTIVE",
          imageUrl: spec.photo,
        },
      }),
    );
  }
  // depot stock 40 for the first product, 15 in the truck (must NOT be added to the export)
  await tx.stockLevel.create({ data: { organizationId: org.id, productId: products[0].id, locationId: org.locationId, quantity: 40, reservedQuantity: 0 } });
  await tx.stockLevel.create({ data: { organizationId: org.id, productId: products[0].id, locationId: org.truckLocationId, quantity: 15, reservedQuantity: 0 } });
  return products;
}

const productSnapshot = (tx: Tx, organizationId: string) =>
  tx.product
    .findMany({
      where: { organizationId },
      orderBy: { reference: "asc" },
      select: {
        reference: true,
        name: true,
        category: { select: { name: true } },
        defaultSupplier: { select: { code: true, name: true } },
        brand: { select: { name: true } },
        purchasePrice: true,
        salePrice: true,
        taxRate: true,
        retailPrice: true,
        semiWholesalePrice: true,
        semiWholesaleMinQty: true,
        wholesaleMinQty: true,
        unit: true,
        barcode: true,
        description: true,
        minimumStock: true,
        status: true,
        imageUrl: true,
      },
    })
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        purchasePrice: row.purchasePrice.toString(),
        salePrice: row.salePrice.toString(),
        taxRate: row.taxRate.toString(),
        retailPrice: row.retailPrice?.toString() ?? null,
        semiWholesalePrice: row.semiWholesalePrice?.toString() ?? null,
      })),
    );

const runExport = (tx: Tx, org: Org, columns: ProductColumnKey[], format: ExportFormat) =>
  runProductsExport({ columns, format, filters: {}, fetchJson: coreFetch(tx, org) });

// ------------------------------------------------------------------ products

test("products: ZIP export -> import into ANOTHER organisation recreates exactly the same products, prices, VAT, links and photos", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    const b = await makeOrg(tx, "B");
    await seedProducts(tx, a);

    const exported = await runExport(tx, a, [...ALL_PRODUCT_COLUMNS, "photo"], "zip");
    assert.equal(exported.rowCount, 4);
    const { classified, outcome, photoResults } = await importProducts(tx, b, exported.bytes, exported.fileName, false);
    assert.deepEqual(classified.summary.new, 4);
    assert.deepEqual(outcome.results.map((row) => row.status), ["CREATED", "CREATED", "CREATED", "CREATED"]);
    assert.equal(outcome.suppliersCreated, 1);
    assert.equal(outcome.brandsCreated, 1);
    assert.deepEqual(photoResults.map((row) => row.status), ["UPDATED", "UPDATED"]);

    // same business data, to the cent - and stored photos byte for byte
    const source = await productSnapshot(tx, a.id);
    const target = await productSnapshot(tx, b.id);
    assert.deepEqual(target, source);

    // nothing from A leaks into B: every link of B's products points to B's own rows
    const links = await tx.product.findMany({ where: { organizationId: b.id }, select: { category: { select: { organizationId: true } }, defaultSupplier: { select: { organizationId: true } }, brand: { select: { organizationId: true } } } });
    for (const link of links) {
      assert.equal(link.category.organizationId, b.id);
      assert.equal(link.defaultSupplier?.organizationId, b.id);
      if (link.brand) assert.equal(link.brand.organizationId, b.id);
    }
    assert.equal(await tx.stockMovement.count({ where: { organizationId: b.id } }), 0, "no stock column -> no stock movement");
  });
});

test("products: re-importing an export into the SAME organisation changes nothing and creates no duplicate (xlsx and csv)", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    await seedProducts(tx, a);
    const before = await productSnapshot(tx, a.id);
    for (const format of ["xlsx", "csv"] as const) {
      const exported = await runExport(tx, a, [...ALL_PRODUCT_COLUMNS, "photo"], format);
      const { classified, outcome } = await importProducts(tx, a, exported.bytes, exported.fileName, false);
      assert.equal(classified.summary.unchanged, 4, format);
      assert.deepEqual(outcome.results.map((row) => row.status), ["UNCHANGED", "UNCHANGED", "UNCHANGED", "UNCHANGED"], format);
      assert.equal(outcome.categoriesCreated + outcome.suppliersCreated + outcome.brandsCreated, 0, format);
    }
    assert.deepEqual(await productSnapshot(tx, a.id), before);
    assert.equal(await tx.product.count({ where: { organizationId: a.id } }), 4);
  });
});

test("products: QuantiteStock = the DEPOT stock (never depot + trucks); applied only when confirmed; absent column = stock untouched", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    const [eau] = await seedProducts(tx, a);
    const exported = await runExport(tx, a, ["targetStock"], "csv");
    const table = readTableFile(exported.bytes, exported.fileName, "produits");
    assert.deepEqual(table.headers, ["ref_produit", "QuantiteStock"]);
    const stockOf = (reference: string) => table.rows.find((row) => row.cells[0] === reference)?.cells[1];
    assert.equal(stockOf("EAU/1,5L"), "40", "depot only: the 15 in the truck are not added");
    assert.equal(stockOf("007"), "0");

    // the stock changed since the export: an OLD file must not overwrite it silently
    await tx.stockLevel.update({ where: { productId_locationId: { productId: eau.id, locationId: a.locationId } }, data: { quantity: 55 } });
    const unconfirmed = await importProducts(tx, a, exported.bytes, exported.fileName, false);
    const eauRow = unconfirmed.classified.rows.find((row) => row.reference === "EAU/1,5L")!;
    assert.equal(eauRow.stockToApply, undefined);
    assert.deepEqual(eauRow.pendingStock, { old: "55", new: "40" }, "the difference is reported for confirmation");
    assert.equal((await tx.stockLevel.findUnique({ where: { productId_locationId: { productId: eau.id, locationId: a.locationId } } }))!.quantity, 55);

    // confirmed: the depot gets the file's value through ONE adjustment movement; the truck is untouched
    const confirmed = await importProducts(tx, a, exported.bytes, exported.fileName, true);
    assert.equal(confirmed.outcome.stockMovementsCreated, 1);
    assert.equal((await tx.stockLevel.findUnique({ where: { productId_locationId: { productId: eau.id, locationId: a.locationId } } }))!.quantity, 40);
    assert.equal((await tx.stockLevel.findUnique({ where: { productId_locationId: { productId: eau.id, locationId: a.truckLocationId } } }))!.quantity, 15);

    // a file without the stock column never touches the stock, even "confirmed"
    const noStock = await runExport(tx, a, ["name"], "xlsx");
    const movementsBefore = await tx.stockMovement.count({ where: { organizationId: a.id } });
    await importProducts(tx, a, noStock.bytes, noStock.fileName, true);
    assert.equal(await tx.stockMovement.count({ where: { organizationId: a.id } }), movementsBefore);
  });
});

test("products: a partial file (some columns) updates only those columns; empty cells keep the stored values", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    await seedProducts(tx, a);
    const before = await productSnapshot(tx, a.id);
    // historical-style CSV: reference + new sale price for one product, empty cell for another
    const csv = new TextEncoder().encode("﻿ref_produit;prixGros;designation\r\nEAU/1,5L;7,20;\r\n007;;\r\n");
    const { outcome } = await importProducts(tx, a, csv, "maj.csv", false);
    assert.deepEqual(outcome.results.map((row) => row.status), ["UPDATED", "UNCHANGED"]);
    const after = await productSnapshot(tx, a.id);
    const eauBefore = before.find((row) => row.reference === "EAU/1,5L")!;
    const eauAfter = after.find((row) => row.reference === "EAU/1,5L")!;
    assert.equal(eauAfter.salePrice, "6", "7,20 TTC at 20 % = 6.00 HT");
    assert.deepEqual({ ...eauAfter, salePrice: eauBefore.salePrice }, eauBefore, "every other field kept, name included");
    assert.deepEqual(after.filter((row) => row.reference !== "EAU/1,5L"), before.filter((row) => row.reference !== "EAU/1,5L"));
  });
});

test("products: barcode already used by another product -> conflict, nothing written for that line", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    await seedProducts(tx, a);
    const csv = new TextEncoder().encode("ref_produit;code_barre\r\n007;6111234567890\r\n");
    const { outcome } = await importProducts(tx, a, csv, "cb.csv", false);
    assert.equal(outcome.results[0].status, "CONFLICT");
    assert.match(outcome.results[0].message, /déjà utilisé par le produit EAU\/1,5L/);
    assert.equal((await tx.product.findFirst({ where: { organizationId: a.id, reference: "007" } }))!.barcode, null);
  });
});

test("products: photos are matched by reference in the session's organisation only; invalid images and unknown references are reported", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    const b = await makeOrg(tx, "B");
    await seedProducts(tx, a);
    await tx.category.create({ data: { organizationId: b.id, code: `C-${uid()}`, name: "X", active: true } });
    const png = photoDataUrl(PNG, "image/png");
    const results = await applyProductPhotos(tx, a.id, [
      { reference: "007", dataUrl: png }, // no photo yet (NULL) -> saved
      { reference: "EAU/1,5L", dataUrl: png }, // same photo -> unchanged
      { reference: "JUS;ORANGE", dataUrl: "data:image/png;base64,PHN2Zz48L3N2Zz4=" }, // svg disguised as png
      { reference: "INCONNU", dataUrl: png },
    ]);
    assert.deepEqual(results.map((row) => row.status), ["UPDATED", "UNCHANGED", "INVALID", "NOT_FOUND"]);
    // org B cannot reach A's products with A's references
    assert.deepEqual((await applyProductPhotos(tx, b.id, [{ reference: "007", dataUrl: png }])).map((row) => row.status), ["NOT_FOUND"]);
    assert.equal((await tx.product.findFirst({ where: { organizationId: a.id, reference: "JUS;ORANGE" } }))!.imageUrl, photoDataUrl(JPEG, "image/jpeg"));
    // export of photos is scoped too
    assert.deepEqual((await loadProductExportPhotos(tx, b.id, ["EAU/1,5L"])).photos, []);
  });
});

// ------------------------------------------------------------------ accounts

const SOURCE_ACCOUNTS: AccountImportLine[] = [
  {
    excelRow: 2,
    code: "0042",
    type: "CUSTOMER",
    name: "Épicerie Atlas",
    phone: "0612345678",
    email: "atlas@example.invalid",
    address: "12 rue des Oliviers",
    city: "Casablanca",
    latitude: 33.5731234,
    longitude: -7.5898341,
    ice: "001234567000089",
    taxId: "IF-778",
    contactName: "M. Atlas",
    customerType: "GROCERY",
    creditLimit: 1500.5,
    creditLimitEnabled: true,
    notes: "Livrer le matin",
    accountStatus: "BLOCKED",
  },
  { excelRow: 3, code: "F-01", type: "SUPPLIER", name: "Sidi Ali SA", phone: "0522000000", city: "Rabat", ice: "009", accountStatus: "ACTIVE" },
  { excelRow: 4, code: "61311", type: "EXPENSE", name: "Carburant", description: "Gasoil camions", category: "Transport" },
  { excelRow: 5, code: "51611", type: "TREASURY", name: "Caisse principale", treasuryKind: "CASH" },
  { excelRow: 6, code: "51410", type: "TREASURY", name: "Banque BMCE", treasuryKind: "BANK" },
  {
    excelRow: 7,
    code: "E-01",
    type: "EMPLOYEE",
    name: "Ali Benali",
    phone: "0700000000",
    hireDate: "2024-02-01",
    salary: 4500.5,
    advanceAccountCode: "34311001",
    salaryAccountCode: "44321001",
    accountStatus: "ACTIVE",
  },
];
const ALL_TYPES: AccountTypeCode[] = ["CUSTOMER", "SUPPLIER", "EXPENSE", "TREASURY", "EMPLOYEE"];

async function accountsSnapshot(tx: Tx, organizationId: string) {
  const [customers, suppliers, expenses, treasuries, employees] = await Promise.all([
    tx.customer.findMany({
      where: { organizationId },
      orderBy: { code: "asc" },
      select: { code: true, name: true, phone: true, email: true, address: true, city: true, latitude: true, longitude: true, ice: true, taxId: true, contactName: true, type: true, creditLimit: true, creditLimitEnabled: true, notes: true, status: true },
    }),
    tx.supplier.findMany({ where: { organizationId }, orderBy: { code: "asc" }, select: { code: true, name: true, phone: true, email: true, address: true, city: true, ice: true, taxId: true, active: true } }),
    tx.expenseAccount.findMany({ where: { organizationId }, orderBy: { code: "asc" }, select: { code: true, name: true, description: true, category: true, active: true, accountingAccount: { select: { code: true, type: true, organizationId: true } } } }),
    tx.treasuryAccount.findMany({ where: { organizationId }, orderBy: { code: "asc" }, select: { code: true, name: true, kind: true, active: true, accountingAccount: { select: { code: true, type: true, organizationId: true } } } }),
    tx.employee.findMany({
      where: { organizationId },
      orderBy: { employeeCode: "asc" },
      select: { employeeCode: true, fullName: true, phone: true, hireDate: true, salary: true, status: true, advanceAccount: { select: { code: true, type: true, organizationId: true } }, salaryAccount: { select: { code: true, type: true, organizationId: true } } },
    }),
  ]);
  // a linked ledger account must belong to the SAME organisation: "<own>", anything else shows up as "<foreign>"
  const plain = (value: unknown) =>
    JSON.parse(JSON.stringify(value, (_key, v) => (v && typeof v === "object" && "organizationId" in v ? { ...v, organizationId: v.organizationId === organizationId ? "<own>" : "<foreign>" } : v)));
  return plain({ customers, suppliers, expenses, treasuries, employees });
}

test("accounts: the 5 types are importable; each gets its ledger account in ITS organisation", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    const { results } = await importAccounts(tx, a, SOURCE_ACCOUNTS);
    assert.deepEqual(results.map((row) => [row.code, row.status]), SOURCE_ACCOUNTS.map((row) => [row.code, "CREATED"]));
    const ledger = await tx.accountingAccount.findMany({ where: { organizationId: a.id }, select: { code: true, type: true } });
    const has = (type: string, code?: string) => ledger.some((row) => row.type === type && (code === undefined || row.code === code));
    assert.ok(has("RECEIVABLE"), "customer auxiliary account");
    assert.ok(has("PAYABLE"), "supplier auxiliary account");
    assert.ok(has("EXPENSE", "61311"));
    assert.ok(has("TREASURY", "51611") && has("TREASURY", "51410"));
    assert.ok(has("RECEIVABLE", "34311001") && has("PAYABLE", "44321001"), "employee advance / salary accounts");
  });
});

test("accounts (mandatory GPS test): customer with GPS -> export -> import into ANOTHER organisation: same coordinates to the 7th decimal, no internal id, no link to the source", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    const b = await makeOrg(tx, "B");
    await importAccounts(tx, a, SOURCE_ACCOUNTS);
    const sourceCustomer = await tx.customer.findFirstOrThrow({ where: { organizationId: a.id, code: "0042" } });
    assert.equal(sourceCustomer.latitude?.toString(), "33.5731234");
    assert.equal(sourceCustomer.longitude?.toString(), "-7.5898341");

    for (const format of ["xlsx", "csv"] as const) {
      const exported = await runAccountsExport({ types: ALL_TYPES, columns: [], includeGps: true, format, fetchJson: coreFetch(tx, a) });
      const allColumns = await runAccountsExport({
        types: ALL_TYPES,
        columns: ["phone", "email", "address", "city", "ice", "taxId", "contactName", "customerType", "creditLimit", "creditLimitEnabled", "notes", "description", "category", "treasuryKind", "hireDate", "salary", "advanceAccountCode", "salaryAccountCode", "status"],
        includeGps: true,
        format,
        fetchJson: coreFetch(tx, a),
      });
      assert.ok(exported.rowCount === 6 && allColumns.rowCount === 6);

      // no internal identifier of A (organisation, user, rows, ledger accounts) anywhere in the file
      const text = format === "csv" ? new TextDecoder().decode(allColumns.bytes) : JSON.stringify(readTableFile(allColumns.bytes, allColumns.fileName, ACCOUNT_SHEET_NAME));
      const ids = [
        a.id,
        a.userId,
        sourceCustomer.id,
        ...(await tx.accountingAccount.findMany({ where: { organizationId: a.id }, select: { id: true } })).map((row) => row.id),
        ...(await tx.employee.findMany({ where: { organizationId: a.id }, select: { id: true } })).map((row) => row.id),
        ...(await tx.treasuryAccount.findMany({ where: { organizationId: a.id }, select: { id: true } })).map((row) => row.id),
      ];
      for (const id of ids) assert.equal(text.includes(id), false, `internal id ${id} found in the ${format} export`);
      assert.doesNotMatch(text, /\bc[a-z0-9]{24}\b/, "no cuid-looking value at all");

      const table = readTableFile(allColumns.bytes, allColumns.fileName, ACCOUNT_SHEET_NAME);
      const parsed = parseAccountTable(table.headers, table.rows);
      assert.deepEqual(parsed.lines.filter((line) => line.errors.length), [], format);
      const target = await makeOrg(tx, `B-${format}`);
      const { results } = await importAccounts(tx, target, parsed.lines.map((line) => line.line!));
      assert.deepEqual(results.map((row) => row.status), ["CREATED", "CREATED", "CREATED", "CREATED", "CREATED", "CREATED"], format);

      const copy = await tx.customer.findFirstOrThrow({ where: { organizationId: target.id, code: "0042" } });
      assert.equal(copy.latitude?.toString(), "33.5731234", `${format}: latitude exact`);
      assert.equal(copy.longitude?.toString(), "-7.5898341", `${format}: longitude exact`);
      assert.notEqual(copy.id, sourceCustomer.id);
      assert.equal(copy.organizationId, target.id);
      assert.equal(copy.createdByUserId, target.userId, "created by the importing user, not A's");
      // every account of the target is a faithful copy, and only points to the target's own ledger
      assert.deepEqual(await accountsSnapshot(tx, target.id), await accountsSnapshot(tx, a.id), format);
    }
    assert.equal(await tx.customer.count({ where: { organizationId: b.id } }), 0, "an unrelated organisation is untouched");
  });
});

test("accounts: re-import of an export into the same organisation = all unchanged, no duplicate", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    await importAccounts(tx, a, SOURCE_ACCOUNTS);
    const before = await accountsSnapshot(tx, a.id);
    const ledgerBefore = await tx.accountingAccount.count({ where: { organizationId: a.id } });
    const exported = await runAccountsExport({
      types: ALL_TYPES,
      columns: ["phone", "email", "address", "city", "ice", "taxId", "contactName", "customerType", "creditLimit", "creditLimitEnabled", "notes", "description", "category", "treasuryKind", "hireDate", "salary", "advanceAccountCode", "salaryAccountCode", "status"],
      includeGps: true,
      format: "xlsx",
      fetchJson: coreFetch(tx, a),
    });
    const table = readTableFile(exported.bytes, exported.fileName, ACCOUNT_SHEET_NAME);
    const { classified, results } = await importAccounts(tx, a, parseAccountTable(table.headers, table.rows).lines.map((line) => line.line!));
    const byCode = (list: Array<[string, string, unknown]>) => [...list].sort((x, y) => x[0].localeCompare(y[0]));
    assert.deepEqual(
      byCode(classified.rows.map((row) => [row.code, row.status, row.changes])),
      byCode(SOURCE_ACCOUNTS.map((row) => [row.code, "EXISTING_UNCHANGED", {}])),
    );
    assert.ok(results.every((row) => row.status === "UNCHANGED"));
    assert.deepEqual(await accountsSnapshot(tx, a.id), before);
    assert.equal(await tx.accountingAccount.count({ where: { organizationId: a.id } }), ledgerBefore);
  });
});

test("accounts: matched by code AND type -> automatic update of the given fields only, old -> new shown; absent / empty never erases", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    await importAccounts(tx, a, SOURCE_ACCOUNTS);
    const ledgerBefore = await tx.accountingAccount.findMany({ where: { organizationId: a.id }, orderBy: { code: "asc" }, select: { id: true, code: true } });
    // a historical 4-column file with an empty Tel, plus a GPS change through the full format
    const csv = new TextEncoder().encode("N_compte;Nom_Compte;Type_Compte;Tel;Latitude;Longitude\r\n0042;Épicerie Atlas II;Client;;34,0209;-6,8416\r\nF-01;;Fournisseur;0522111111;;\r\n");
    const table = readTableFile(csv, "maj.csv", ACCOUNT_SHEET_NAME);
    const parsed = parseAccountTable(table.headers, table.rows);
    const { classified, results } = await importAccounts(tx, a, parsed.lines.map((line) => line.line!));
    assert.deepEqual(classified.rows.map((row) => row.status), ["EXISTING_UPDATE", "EXISTING_UPDATE"]);
    assert.deepEqual(classified.rows[0].changes, {
      name: { old: "Épicerie Atlas", new: "Épicerie Atlas II" },
      gps: { old: "33.5731234, -7.5898341", new: "34.0209, -6.8416" },
    });
    assert.deepEqual(classified.rows[1].changes, { phone: { old: "0522000000", new: "0522111111" } });
    assert.deepEqual(results.map((row) => row.status), ["UPDATED", "UPDATED"]);

    const customer = await tx.customer.findFirstOrThrow({ where: { organizationId: a.id, code: "0042" } });
    assert.equal(customer.name, "Épicerie Atlas II");
    assert.equal(customer.phone, "0612345678", "empty Tel cell -> phone kept");
    assert.deepEqual([customer.email, customer.address, customer.city, customer.ice, customer.notes, customer.status, customer.type], ["atlas@example.invalid", "12 rue des Oliviers", "Casablanca", "001234567000089", "Livrer le matin", "BLOCKED", "GROCERY"]);
    assert.deepEqual([customer.latitude?.toString(), customer.longitude?.toString()], ["34.0209", "-6.8416"]);
    const supplier = await tx.supplier.findFirstOrThrow({ where: { organizationId: a.id, code: "F-01" } });
    assert.deepEqual([supplier.name, supplier.phone, supplier.city, supplier.ice], ["Sidi Ali SA", "0522111111", "Rabat", "009"], "no name in the file -> name kept");
    // same ledger accounts (ids and codes): relations and auxiliary numbers kept
    assert.deepEqual(await tx.accountingAccount.findMany({ where: { organizationId: a.id }, orderBy: { code: "asc" }, select: { id: true, code: true } }), ledgerBefore);
  });
});

test("accounts: same code under another type -> conflict before any write; employees need the admin; another organisation's codes are invisible", async (t) => {
  if (!reachable) return t.skip("no database reachable");
  await inRollback(async (tx) => {
    const a = await makeOrg(tx, "A");
    const b = await makeOrg(tx, "B");
    await importAccounts(tx, a, SOURCE_ACCOUNTS);
    const before = await accountsSnapshot(tx, a.id);

    const { classified, results } = await importAccounts(
      tx,
      a,
      [
        { excelRow: 2, code: "0042", type: "SUPPLIER", name: "Même code qu'un client" },
        { excelRow: 3, code: "N-1", type: "CUSTOMER", name: "Nouveau", latitude: 33.1, longitude: -7.1 },
        { excelRow: 4, code: "N-1", type: "CUSTOMER", name: "Doublon" },
        { excelRow: 5, code: "E-02", type: "EMPLOYEE", name: "Sans admin", advanceAccountCode: "34311002", salaryAccountCode: "44321002" },
        { excelRow: 6, code: "51699", type: "TREASURY", name: "Sans nature" },
      ],
      false,
    );
    // 0042 exists as a CUSTOMER -> refused as SUPPLIER; N-1 twice in the file -> the 2nd line is refused
    assert.deepEqual(classified.rows.map((row) => row.status), ["CONFLICT", "NEW", "CONFLICT", "ERROR", "ERROR"]);
    assert.match(classified.rows[0].message, /type/);
    assert.match(classified.rows[2].message, /double dans le fichier.*ligne 3/);
    assert.deepEqual(results.map((row) => row.status), ["CONFLICT", "CREATED", "CONFLICT", "ERROR", "ERROR"]);
    const now = await accountsSnapshot(tx, a.id);
    assert.deepEqual({ ...now, customers: now.customers.filter((row: { code: string }) => row.code !== "N-1") }, before, "only the valid line was written");
    assert.equal(await tx.employee.count({ where: { organizationId: a.id, employeeCode: "E-02" } }), 0);

    // B sees none of A's codes: everything is NEW there, and A is untouched
    const inB = await importAccounts(tx, b, [{ excelRow: 2, code: "0042", type: "CUSTOMER", name: "Client de B" }]);
    assert.deepEqual(inB.results.map((row) => row.status), ["CREATED"]);
    assert.equal((await tx.customer.findFirstOrThrow({ where: { organizationId: a.id, code: "0042" } })).name, "Épicerie Atlas");
  });
});
