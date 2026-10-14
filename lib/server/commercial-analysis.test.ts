import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { assertDevDatabaseOnly, assertLoopbackServer } from "@/lib/db-test-guard";
import { AnalysisFilterError } from "@/lib/commercial-analysis/filters";

import { loadCoverage, loadSalesAnalysis } from "./commercial-analysis-core";

/**
 * Commercial analysis (Dashboard) against the REAL local database: every test
 * runs inside a transaction that is always rolled back (nothing is kept);
 * skipped when no database is reachable. Plus the server-side admin-only gating.
 */

// Never against production or a hosted database (lib/db-test-guard.ts): throws before any connection is made.
assertDevDatabaseOnly("lib/server/commercial-analysis.test.ts");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let reachable = false;

before(async () => {
  await assertLoopbackServer(prisma, "lib/server/commercial-analysis.test.ts");
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
      { timeout: 90_000, maxWait: 20_000 },
    ),
    Rollback,
  );
}

// Fixed dates: month 2026-03 (business day 02:00 Africa/Casablanca, UTC+1 -> boundaries 01:00Z), week Mon 09/03 -> Sun 15/03/2026.
const MONTH = "2026-03";
const WEEK = "2026-03-09";
const IN_MONTH = new Date("2026-03-20T12:00:00Z");
const IN_WEEK = new Date("2026-03-11T12:00:00Z");
const OTHER_MONTH = new Date("2026-04-10T12:00:00Z");
const OTHER_WEEK = new Date("2026-03-18T12:00:00Z");

async function makeOrg(tx: Tx, label: string) {
  const suffix = uid();
  const organization = await tx.organization.create({ data: { code: `T-CA-${suffix}`.toUpperCase(), name: `Test analyse ${label}` } });
  const admin = await tx.user.create({
    data: { organizationId: organization.id, firstName: "A", lastName: label, fullName: `Admin ${label}`, email: `a-${suffix}@example.invalid`, passwordHash: "x", role: "ADMIN" },
  });
  const depot = await tx.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  const location = await tx.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id } });
  const category = await tx.category.create({ data: { organizationId: organization.id, name: "Cat" } });
  return { organization, admin, location, category, suffix };
}
type Org = Awaited<ReturnType<typeof makeOrg>>;

async function makeDriver(tx: Tx, org: Org, name: string, active = true) {
  const code = uid();
  const user = await tx.user.create({
    data: { organizationId: org.organization.id, firstName: name, lastName: "Driver", fullName: name, email: `d-${code}@example.invalid`, passwordHash: "x", role: "DRIVER" },
  });
  return tx.driver.create({ data: { organizationId: org.organization.id, employeeCode: `E-${code}`, userId: user.id, active } });
}

async function makeSupplier(tx: Tx, org: Org, name: string) {
  return tx.supplier.create({ data: { organizationId: org.organization.id, code: `S-${uid()}`, name } });
}

async function makeProduct(tx: Tx, org: Org, name: string, supplierId: string | null) {
  return tx.product.create({
    data: {
      organizationId: org.organization.id,
      reference: `R-${uid()}`,
      name,
      categoryId: org.category.id,
      purchasePrice: 99, // the CURRENT purchase price is deliberately wrong: the margin must use the frozen line cost
      salePrice: 20,
      taxRate: 20,
      unit: "u",
      status: "ACTIVE",
      defaultSupplierId: supplierId,
    },
  });
}

async function makeCustomer(
  tx: Tx,
  org: Org,
  name: string,
  options: { driverId?: string | null; status?: "ACTIVE" | "INACTIVE"; createdAt?: Date } = {},
) {
  return tx.customer.create({
    data: {
      organizationId: org.organization.id,
      code: `C-${uid()}`,
      name,
      address: "-",
      city: "-",
      type: "GROCERY",
      status: options.status ?? "ACTIVE",
      createdByUserId: org.admin.id,
      creationOrigin: options.driverId ? "DRIVER" : "ADMIN",
      createdByDriverId: options.driverId ?? null,
      createdAt: options.createdAt ?? new Date("2026-01-05T10:00:00Z"),
    },
  });
}

type SaleLineInput = { productId: string; quantity: number; totalHT: number; unitCostHT: number };

/** A sale made by a driver (or none) with its lines; totals follow the lines (20 % VAT). */
async function makeSale(
  tx: Tx,
  org: Org,
  options: {
    driverId: string | null;
    customerId: string | null;
    lines: SaleLineInput[];
    status?: "DRAFT" | "VALIDATED" | "PARTIALLY_PAID" | "PAID" | "CREDIT" | "CANCELLED" | "CREDIT_NOTED";
    validatedAt?: Date;
    origin?: "COUNTER" | "TRUCK";
  },
) {
  const subtotal = options.lines.reduce((sum, line) => sum + line.totalHT, 0);
  const sale = await tx.sale.create({
    data: {
      organizationId: org.organization.id,
      invoiceNumber: `T-${uid()}`,
      origin: options.origin ?? "TRUCK",
      status: options.status ?? "PAID",
      customerId: options.customerId,
      driverId: options.driverId,
      stockLocationId: org.location.id,
      subtotalHT: subtotal,
      taxAmount: subtotal * 0.2,
      totalTTC: subtotal * 1.2,
      paymentMethod: "CASH",
      createdByUserId: org.admin.id,
      validatedAt: options.validatedAt ?? IN_MONTH,
    },
  });
  const lines = [];
  for (const line of options.lines) {
    lines.push(
      await tx.saleLine.create({
        data: {
          saleId: sale.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPriceHT: line.totalHT / line.quantity,
          unitCostHT: line.unitCostHT,
          discountAmount: 0,
          taxRate: 20,
          taxAmount: line.totalHT * 0.2,
          totalHT: line.totalHT,
          totalTTC: line.totalHT * 1.2,
        },
      }),
    );
  }
  return { sale, lines };
}

async function makeCreditNote(
  tx: Tx,
  org: Org,
  options: {
    originalSaleId: string | null;
    driverId?: string | null;
    customerId?: string | null;
    status?: "DRAFT" | "VALIDATED" | "REVERSED";
    partyType?: "CUSTOMER" | "SUPPLIER";
    supplierId?: string | null;
    validatedAt?: Date;
    lines: Array<{ productId: string; saleLineId: string | null; quantity: number; totalHT: number }>;
  },
) {
  const subtotal = options.lines.reduce((sum, line) => sum + line.totalHT, 0);
  const note = await tx.creditNote.create({
    data: {
      organizationId: org.organization.id,
      creditNoteNumber: `AV-${uid()}`,
      originalSaleId: options.originalSaleId,
      partyType: options.partyType ?? "CUSTOMER",
      customerId: options.customerId ?? null,
      supplierId: options.supplierId ?? null,
      status: options.status ?? "VALIDATED",
      reason: "DEFECTIVE_PRODUCT",
      subtotalHT: subtotal,
      taxAmount: subtotal * 0.2,
      totalTTC: subtotal * 1.2,
      createdByUserId: org.admin.id,
      validatedAt: options.validatedAt ?? IN_MONTH,
      driverId: options.driverId ?? null,
    },
  });
  for (const line of options.lines) {
    await tx.creditNoteLine.create({
      data: {
        creditNoteId: note.id,
        saleLineId: line.saleLineId,
        productId: line.productId,
        quantity: line.quantity,
        unitPriceHT: line.totalHT / line.quantity,
        taxRate: 20,
        totalHT: line.totalHT,
        taxAmount: line.totalHT * 0.2,
        totalTTC: line.totalHT * 1.2,
      },
    });
  }
  return note;
}

const salesFilters = (overrides: Partial<Parameters<typeof loadSalesAnalysis>[2]> = {}) => ({
  driverId: "all",
  month: MONTH,
  supplierId: "all",
  metric: "revenue" as const,
  sort: "revenue" as const,
  direction: "desc" as const,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Analyse des ventes
// ---------------------------------------------------------------------------

test("combined filters driver + month + supplier only keep the matching lines", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "combo");
    const [d1, d2] = [await makeDriver(tx, org, "Karim"), await makeDriver(tx, org, "Said")];
    const [s1, s2] = [await makeSupplier(tx, org, "Fournisseur 1"), await makeSupplier(tx, org, "Fournisseur 2")];
    const [pA, pB, pC] = [await makeProduct(tx, org, "Produit A", s1.id), await makeProduct(tx, org, "Produit B", s2.id), await makeProduct(tx, org, "Produit C", null)];
    const customer = await makeCustomer(tx, org, "Client", { driverId: d1.id });

    // d1, March: A (s1) 10 u / 100 HT, B (s2) 4 u / 40 HT, C (no supplier) 2 u / 30 HT
    await makeSale(tx, org, { driverId: d1.id, customerId: customer.id, lines: [{ productId: pA.id, quantity: 10, totalHT: 100, unitCostHT: 6 }, { productId: pB.id, quantity: 4, totalHT: 40, unitCostHT: 7 }, { productId: pC.id, quantity: 2, totalHT: 30, unitCostHT: 10 }] });
    // d2, March: A 5 u / 55 HT
    await makeSale(tx, org, { driverId: d2.id, customerId: customer.id, lines: [{ productId: pA.id, quantity: 5, totalHT: 55, unitCostHT: 6 }] });
    // d1, APRIL: A 99 u (must not appear in March)
    await makeSale(tx, org, { driverId: d1.id, customerId: customer.id, validatedAt: OTHER_MONTH, lines: [{ productId: pA.id, quantity: 99, totalHT: 999, unitCostHT: 6 }] });

    const all = await loadSalesAnalysis(tx, org.organization.id, salesFilters());
    assert.deepEqual([all.totals.quantity, all.totals.revenue, all.totals.distinctProducts], [21, 225, 3]);
    assert.equal(all.byDriver?.length, 2, "the comparison lists both drivers");

    const driverOnly = await loadSalesAnalysis(tx, org.organization.id, salesFilters({ driverId: d1.id }));
    assert.deepEqual([driverOnly.totals.quantity, driverOnly.totals.revenue], [16, 170]);
    assert.equal(driverOnly.byDriver, null, "no comparison once one driver is chosen");

    const combined = await loadSalesAnalysis(tx, org.organization.id, salesFilters({ driverId: d1.id, supplierId: s1.id }));
    assert.equal(combined.products.length, 1);
    assert.equal(combined.products[0].productId, pA.id);
    assert.equal(combined.products[0].supplierName, "Fournisseur 1");
    assert.deepEqual([combined.totals.quantity, combined.totals.revenue, combined.totals.margin, combined.totals.distinctProducts], [10, 100, 40, 1]);

    const noSupplier = await loadSalesAnalysis(tx, org.organization.id, salesFilters({ supplierId: "none" }));
    assert.deepEqual(noSupplier.products.map((p) => p.productId), [pC.id]);

    // The previous month has none of this.
    const empty = await loadSalesAnalysis(tx, org.organization.id, salesFilters({ month: "2026-02" }));
    assert.deepEqual(empty.totals, { quantity: 0, revenue: 0, margin: 0, distinctProducts: 0 });
    assert.deepEqual(empty.products, []);
  });
});

test("several lines / invoices / drivers of the same product are ONE row; the margin uses the frozen cost, not the current price", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "agg");
    const [d1, d2] = [await makeDriver(tx, org, "Karim"), await makeDriver(tx, org, "Said")];
    const supplier = await makeSupplier(tx, org, "F");
    const product = await makeProduct(tx, org, "Eau", supplier.id);
    const customer = await makeCustomer(tx, org, "Client", { driverId: d1.id });

    // two lines of the same product on one invoice (different frozen costs) + another invoice + another driver
    await makeSale(tx, org, { driverId: d1.id, customerId: customer.id, lines: [{ productId: product.id, quantity: 3, totalHT: 30, unitCostHT: 5 }, { productId: product.id, quantity: 2, totalHT: 24, unitCostHT: 6 }] });
    await makeSale(tx, org, { driverId: d1.id, customerId: customer.id, lines: [{ productId: product.id, quantity: 5, totalHT: 50, unitCostHT: 5 }] });
    await makeSale(tx, org, { driverId: d2.id, customerId: customer.id, lines: [{ productId: product.id, quantity: 1, totalHT: 11, unitCostHT: 5 }] });

    const result = await loadSalesAnalysis(tx, org.organization.id, salesFilters());
    assert.equal(result.products.length, 1);
    const [row] = result.products;
    assert.equal(row.quantity, 11);
    assert.equal(row.revenue, 115);
    // cost = 3x5 + 2x6 + 5x5 + 1x5 = 57 (NOT 11 x 99 from the current purchase price) -> margin 58
    assert.equal(row.margin, 58);
    assert.equal(result.totals.distinctProducts, 1);
    assert.equal(result.productRowCount, 1);
    // the per-driver rows add up to the global figures
    const sum = (result.byDriver ?? []).reduce((acc, d) => acc + d.revenue, 0);
    assert.equal(sum, result.totals.revenue);
  });
});

test("DRAFT and CANCELLED sales are excluded; every real status (paid, credit, partially paid, credit-noted) is counted once", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "status");
    const driver = await makeDriver(tx, org, "Karim");
    const product = await makeProduct(tx, org, "P", null);
    const customer = await makeCustomer(tx, org, "Client", { driverId: driver.id });
    const line = (totalHT: number) => [{ productId: product.id, quantity: 1, totalHT, unitCostHT: 1 }];
    for (const status of ["VALIDATED", "PARTIALLY_PAID", "PAID", "CREDIT", "CREDIT_NOTED"] as const) {
      await makeSale(tx, org, { driverId: driver.id, customerId: customer.id, status, lines: line(10) });
    }
    await makeSale(tx, org, { driverId: driver.id, customerId: customer.id, status: "DRAFT", lines: line(1000) });
    await makeSale(tx, org, { driverId: driver.id, customerId: customer.id, status: "CANCELLED", lines: line(2000) });

    const result = await loadSalesAnalysis(tx, org.organization.id, salesFilters());
    assert.deepEqual([result.totals.quantity, result.totals.revenue], [5, 50]);
  });
});

test("validated credit notes of the month reduce quantity, revenue and margin (cost comes back); drafts, supplier notes and other months do not", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "returns");
    const driver = await makeDriver(tx, org, "Karim");
    const supplier = await makeSupplier(tx, org, "F");
    const product = await makeProduct(tx, org, "P", supplier.id);
    const customer = await makeCustomer(tx, org, "Client", { driverId: driver.id });
    const { sale, lines } = await makeSale(tx, org, { driverId: driver.id, customerId: customer.id, status: "CREDIT_NOTED", lines: [{ productId: product.id, quantity: 10, totalHT: 200, unitCostHT: 12 }] });

    // validated return of 2 u (40 HT) linked to the sale line, no driver on the credit note itself:
    // the driver is the one of the ORIGINAL sale
    await makeCreditNote(tx, org, { originalSaleId: sale.id, customerId: customer.id, lines: [{ productId: product.id, saleLineId: lines[0].id, quantity: 2, totalHT: 40 }] });
    // ignored: draft, reversed, supplier credit note, and a return validated in ANOTHER month
    await makeCreditNote(tx, org, { originalSaleId: sale.id, customerId: customer.id, status: "DRAFT", lines: [{ productId: product.id, saleLineId: lines[0].id, quantity: 1, totalHT: 20 }] });
    await makeCreditNote(tx, org, { originalSaleId: sale.id, customerId: customer.id, status: "REVERSED", lines: [{ productId: product.id, saleLineId: lines[0].id, quantity: 1, totalHT: 20 }] });
    await makeCreditNote(tx, org, { originalSaleId: null, partyType: "SUPPLIER", supplierId: supplier.id, lines: [{ productId: product.id, saleLineId: null, quantity: 3, totalHT: 60 }] });
    await makeCreditNote(tx, org, { originalSaleId: sale.id, customerId: customer.id, validatedAt: OTHER_MONTH, lines: [{ productId: product.id, saleLineId: lines[0].id, quantity: 4, totalHT: 80 }] });

    const result = await loadSalesAnalysis(tx, org.organization.id, salesFilters({ driverId: driver.id }));
    const [row] = result.products;
    assert.equal(row.quantity, 8);
    assert.equal(row.revenue, 160);
    // margin = (200 - 120) - (40 - 24) = 64
    assert.equal(row.margin, 64);
    assert.equal(result.dataQuality.returnLinesWithoutCost, 0);

    // A free-standing return (no sale line): revenue is netted, its cost is unknown and REPORTED.
    await makeCreditNote(tx, org, { originalSaleId: sale.id, customerId: customer.id, lines: [{ productId: product.id, saleLineId: null, quantity: 1, totalHT: 20 }] });
    const after = await loadSalesAnalysis(tx, org.organization.id, salesFilters({ driverId: driver.id }));
    assert.equal(after.products[0].revenue, 140);
    assert.equal(after.dataQuality.returnLinesWithoutCost, 1);
  });
});

test("a credit note with no original sale uses its own driver; with no driver at all it is not put on anybody", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "cn-driver");
    const driver = await makeDriver(tx, org, "Karim");
    const product = await makeProduct(tx, org, "P", null);
    const customer = await makeCustomer(tx, org, "Client", { driverId: driver.id });
    await makeCreditNote(tx, org, { originalSaleId: null, driverId: driver.id, customerId: customer.id, lines: [{ productId: product.id, saleLineId: null, quantity: 1, totalHT: 15 }] });
    await makeCreditNote(tx, org, { originalSaleId: null, driverId: null, customerId: customer.id, lines: [{ productId: product.id, saleLineId: null, quantity: 1, totalHT: 500 }] });
    const result = await loadSalesAnalysis(tx, org.organization.id, salesFilters());
    assert.equal(result.totals.revenue, -15);
    assert.equal(result.totals.distinctProducts, 0, "a product that was only returned is not « sold »");
  });
});

test("sales with no driver (counter sales, unattributed truck sales) never go on a driver; truck ones are reported", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "unattributed");
    const driver = await makeDriver(tx, org, "Karim");
    const product = await makeProduct(tx, org, "P", null);
    const customer = await makeCustomer(tx, org, "Client");
    await makeSale(tx, org, { driverId: driver.id, customerId: customer.id, lines: [{ productId: product.id, quantity: 1, totalHT: 10, unitCostHT: 1 }] });
    await makeSale(tx, org, { driverId: null, customerId: customer.id, origin: "COUNTER", lines: [{ productId: product.id, quantity: 7, totalHT: 700, unitCostHT: 1 }] });
    await makeSale(tx, org, { driverId: null, customerId: customer.id, origin: "TRUCK", lines: [{ productId: product.id, quantity: 3, totalHT: 90, unitCostHT: 1 }] });

    const result = await loadSalesAnalysis(tx, org.organization.id, salesFilters());
    assert.deepEqual([result.totals.quantity, result.totals.revenue], [1, 10]);
    assert.deepEqual(result.dataQuality.truckSalesWithoutDriver, { count: 1, revenue: 90 });
  });
});

test("sorting is done by the chosen metric and direction", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "sort");
    const driver = await makeDriver(tx, org, "Karim");
    const [a, b, c] = [await makeProduct(tx, org, "A", null), await makeProduct(tx, org, "B", null), await makeProduct(tx, org, "C", null)];
    const customer = await makeCustomer(tx, org, "Client", { driverId: driver.id });
    // A: qty 10, rev 100, margin 10 ; B: qty 4, rev 200, margin 100 ; C: qty 7, rev 50, margin 40
    await makeSale(tx, org, {
      driverId: driver.id,
      customerId: customer.id,
      lines: [
        { productId: a.id, quantity: 10, totalHT: 100, unitCostHT: 9 },
        { productId: b.id, quantity: 4, totalHT: 200, unitCostHT: 25 },
        { productId: c.id, quantity: 7, totalHT: 50, unitCostHT: 10 / 7 },
      ],
    });
    const order = async (sort: "quantity" | "revenue" | "margin", direction: "asc" | "desc") =>
      (await loadSalesAnalysis(tx, org.organization.id, salesFilters({ sort, direction }))).products.map((p) => p.name);
    assert.deepEqual(await order("quantity", "desc"), ["A", "C", "B"]);
    assert.deepEqual(await order("revenue", "desc"), ["B", "A", "C"]);
    assert.deepEqual(await order("margin", "asc"), ["A", "C", "B"]);
    assert.deepEqual(await order("revenue", "asc"), ["C", "A", "B"]);
  });
});

test("organisation isolation: another organisation's sales, drivers and suppliers are invisible and unusable as filters", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const mine = await makeOrg(tx, "mine");
    const other = await makeOrg(tx, "other");
    const myDriver = await makeDriver(tx, mine, "Mine");
    const otherDriver = await makeDriver(tx, other, "Other");
    const otherSupplier = await makeSupplier(tx, other, "Other supplier");
    const myProduct = await makeProduct(tx, mine, "P", null);
    const otherProduct = await makeProduct(tx, other, "Q", otherSupplier.id);
    const myCustomer = await makeCustomer(tx, mine, "C", { driverId: myDriver.id });
    const otherCustomer = await makeCustomer(tx, other, "C", { driverId: otherDriver.id });
    await makeSale(tx, mine, { driverId: myDriver.id, customerId: myCustomer.id, lines: [{ productId: myProduct.id, quantity: 1, totalHT: 10, unitCostHT: 1 }] });
    await makeSale(tx, other, { driverId: otherDriver.id, customerId: otherCustomer.id, lines: [{ productId: otherProduct.id, quantity: 50, totalHT: 5000, unitCostHT: 1 }] });

    const result = await loadSalesAnalysis(tx, mine.organization.id, salesFilters());
    assert.deepEqual([result.totals.quantity, result.totals.revenue], [1, 10]);
    assert.deepEqual(result.drivers.map((d) => d.id), [myDriver.id]);
    assert.deepEqual(result.suppliers, []);

    await assert.rejects(
      loadSalesAnalysis(tx, mine.organization.id, salesFilters({ driverId: otherDriver.id })),
      (error: unknown) => error instanceof AnalysisFilterError && error.field === "driverId",
    );
    await assert.rejects(
      loadSalesAnalysis(tx, mine.organization.id, salesFilters({ supplierId: otherSupplier.id })),
      (error: unknown) => error instanceof AnalysisFilterError && error.field === "supplierId",
    );
    await assert.rejects(
      loadCoverage(tx, mine.organization.id, { driverId: otherDriver.id, week: WEEK }),
      (error: unknown) => error instanceof AnalysisFilterError && error.field === "driverId",
    );

    const coverage = await loadCoverage(tx, mine.organization.id, { driverId: "all", week: WEEK });
    assert.deepEqual(coverage.byDriver?.map((d) => d.driverId), [myDriver.id]);
  });
});

test("the month boundary follows the business day (02:00): 01:30 on the 1st still belongs to the previous month", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "boundary");
    const driver = await makeDriver(tx, org, "Karim");
    const product = await makeProduct(tx, org, "P", null);
    const customer = await makeCustomer(tx, org, "C", { driverId: driver.id });
    const line = (qty: number) => [{ productId: product.id, quantity: qty, totalHT: qty * 10, unitCostHT: 1 }];
    // UTC+1 in March/April 2026: 01:30 local on 1 April = 00:30Z -> still March ; 02:00 local = 01:00Z -> April.
    await makeSale(tx, org, { driverId: driver.id, customerId: customer.id, validatedAt: new Date("2026-04-01T00:30:00Z"), lines: line(1) });
    await makeSale(tx, org, { driverId: driver.id, customerId: customer.id, validatedAt: new Date("2026-04-01T01:00:00Z"), lines: line(100) });
    assert.equal((await loadSalesAnalysis(tx, org.organization.id, salesFilters({ month: "2026-03" }))).totals.quantity, 1);
    assert.equal((await loadSalesAnalysis(tx, org.organization.id, salesFilters({ month: "2026-04" }))).totals.quantity, 100);
  });
});

// ---------------------------------------------------------------------------
// Couverture commerciale
// ---------------------------------------------------------------------------

test("coverage of one driver: 50 assigned customers, 40 buyers = 80 %; a customer buying 3 times counts once", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "cov50");
    const driver = await makeDriver(tx, org, "Karim");
    const product = await makeProduct(tx, org, "P", null);
    const customers: Array<Awaited<ReturnType<typeof makeCustomer>>> = [];
    for (let i = 0; i < 50; i += 1) customers.push(await makeCustomer(tx, org, `Client ${String(i).padStart(2, "0")}`, { driverId: driver.id }));
    const line = [{ productId: product.id, quantity: 1, totalHT: 10, unitCostHT: 1 }];
    for (const customer of customers.slice(0, 40)) {
      await makeSale(tx, org, { driverId: driver.id, customerId: customer.id, validatedAt: IN_WEEK, lines: line });
    }
    // customer 0 buys twice more in the same week, customer 45 only buys in ANOTHER week
    await makeSale(tx, org, { driverId: driver.id, customerId: customers[0].id, validatedAt: IN_WEEK, lines: line });
    await makeSale(tx, org, { driverId: driver.id, customerId: customers[0].id, validatedAt: new Date("2026-03-14T12:00:00Z"), lines: line });
    await makeSale(tx, org, { driverId: driver.id, customerId: customers[45].id, validatedAt: OTHER_WEEK, lines: line });

    const result = await loadCoverage(tx, org.organization.id, { driverId: driver.id, week: WEEK });
    assert.deepEqual(result.summary, { assigned: 50, buyers: 40, withoutPurchase: 10, rate: 80 });
    assert.equal(result.customers.length, 50);
    assert.equal(result.customers.filter((c) => c.status === "BOUGHT").length, 40);
    const first = result.customers.find((c) => c.customerId === customers[0].id)!;
    assert.deepEqual([first.status, first.salesCount, first.amount], ["BOUGHT", 3, 36]);
    assert.ok(first.lastPurchaseAt?.startsWith("2026-03-14"));
    const never = result.customers.find((c) => c.customerId === customers[45].id)!;
    assert.deepEqual([never.status, never.salesCount, never.amount, never.lastPurchaseAt], ["NO_PURCHASE", 0, 0, null]);
    assert.equal(result.period.fromDay, "2026-03-09");
    assert.equal(result.period.toDay, "2026-03-15");

    // any day of the week gives the same Monday-Sunday window
    assert.equal(weekOf(await loadCoverage(tx, org.organization.id, { driverId: driver.id, week: "2026-03-09" })), 40);
  });
});
const weekOf = (result: Awaited<ReturnType<typeof loadCoverage>>) => result.summary.buyers;

test("coverage: not counted = cancelled / draft sales, inactive customers, customers created after the week, other drivers' customers", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "covrules");
    const [d1, d2] = [await makeDriver(tx, org, "Karim"), await makeDriver(tx, org, "Said")];
    const product = await makeProduct(tx, org, "P", null);
    const line = [{ productId: product.id, quantity: 1, totalHT: 10, unitCostHT: 1 }];
    const bought = await makeCustomer(tx, org, "A achete", { driverId: d1.id });
    const cancelledOnly = await makeCustomer(tx, org, "B annule", { driverId: d1.id });
    const draftOnly = await makeCustomer(tx, org, "C brouillon", { driverId: d1.id });
    const inactive = await makeCustomer(tx, org, "D inactif", { driverId: d1.id, status: "INACTIVE" });
    const later = await makeCustomer(tx, org, "E tardif", { driverId: d1.id, createdAt: new Date("2026-03-16T12:00:00Z") });
    const otherDriversCustomer = await makeCustomer(tx, org, "F de Said", { driverId: d2.id });
    const adminCustomer = await makeCustomer(tx, org, "G sans chauffeur");

    await makeSale(tx, org, { driverId: d1.id, customerId: bought.id, validatedAt: IN_WEEK, lines: line });
    await makeSale(tx, org, { driverId: d1.id, customerId: cancelledOnly.id, status: "CANCELLED", validatedAt: IN_WEEK, lines: line });
    await makeSale(tx, org, { driverId: d1.id, customerId: draftOnly.id, status: "DRAFT", validatedAt: IN_WEEK, lines: line });
    await makeSale(tx, org, { driverId: d1.id, customerId: inactive.id, validatedAt: IN_WEEK, lines: line });
    await makeSale(tx, org, { driverId: d1.id, customerId: later.id, validatedAt: IN_WEEK, lines: line });
    // d1 serves d2's customer and a customer with no driver: reported apart, never in d1's rate
    await makeSale(tx, org, { driverId: d1.id, customerId: otherDriversCustomer.id, validatedAt: IN_WEEK, lines: line });
    await makeSale(tx, org, { driverId: d1.id, customerId: adminCustomer.id, validatedAt: IN_WEEK, lines: line });

    const one = await loadCoverage(tx, org.organization.id, { driverId: d1.id, week: WEEK });
    assert.deepEqual(one.customers.map((c) => c.name), ["A achete", "B annule", "C brouillon"]);
    assert.deepEqual(one.summary, { assigned: 3, buyers: 1, withoutPurchase: 2, rate: 33.3 });
    // inactive, later-created, other driver's and admin customers = 4 customers / 4 sales outside the portfolio
    assert.deepEqual(one.outsidePortfolio, { customers: 4, sales: 4 });

    // The "all drivers" figures agree with the single-driver ones, and a customer is in ONE portfolio only.
    const all = await loadCoverage(tx, org.organization.id, { driverId: "all", week: WEEK });
    const row1 = all.byDriver!.find((r) => r.driverId === d1.id)!;
    const row2 = all.byDriver!.find((r) => r.driverId === d2.id)!;
    assert.deepEqual([row1.assigned, row1.buyers, row1.withoutPurchase, row1.rate], [3, 1, 2, 33.3]);
    assert.deepEqual([row2.assigned, row2.buyers, row2.withoutPurchase, row2.rate], [1, 0, 1, 0]);
    assert.equal(all.summary.assigned, row1.assigned + row2.assigned, "no customer is counted for two drivers");
    assert.deepEqual(all.outsidePortfolio, one.outsidePortfolio);
    assert.deepEqual(all.customers, []);
  });
});

test("coverage: everybody bought = 100 %, nobody bought = 0 %, nobody assigned = no rate (no division by zero)", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "covedge");
    const [full, none, empty] = [await makeDriver(tx, org, "Plein"), await makeDriver(tx, org, "Aucun achat"), await makeDriver(tx, org, "Sans client")];
    const product = await makeProduct(tx, org, "P", null);
    const line = [{ productId: product.id, quantity: 1, totalHT: 10, unitCostHT: 1 }];
    for (const name of ["a", "b"]) {
      const customer = await makeCustomer(tx, org, name, { driverId: full.id });
      await makeSale(tx, org, { driverId: full.id, customerId: customer.id, validatedAt: IN_WEEK, lines: line });
    }
    await makeCustomer(tx, org, "c", { driverId: none.id });

    const rate = async (driverId: string) => (await loadCoverage(tx, org.organization.id, { driverId, week: WEEK })).summary;
    assert.deepEqual(await rate(full.id), { assigned: 2, buyers: 2, withoutPurchase: 0, rate: 100 });
    assert.deepEqual(await rate(none.id), { assigned: 1, buyers: 0, withoutPurchase: 1, rate: 0 });
    assert.deepEqual(await rate(empty.id), { assigned: 0, buyers: 0, withoutPurchase: 0, rate: null });
    assert.deepEqual((await loadCoverage(tx, org.organization.id, { driverId: empty.id, week: WEEK })).customers, []);

    const all = await loadCoverage(tx, org.organization.id, { driverId: "all", week: WEEK });
    assert.equal(all.byDriver!.find((r) => r.driverId === empty.id)!.rate, null);
    assert.deepEqual(all.summary, { assigned: 3, buyers: 2, withoutPurchase: 1, rate: 66.7 });
  });
});

test("coverage: a week with no sales at all, and a week before the customers existed (history by creation date)", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const org = await makeOrg(tx, "covhist");
    const driver = await makeDriver(tx, org, "Karim");
    await makeCustomer(tx, org, "Ancien", { driverId: driver.id, createdAt: new Date("2026-01-05T10:00:00Z") });
    await makeCustomer(tx, org, "Recent", { driverId: driver.id, createdAt: new Date("2026-03-10T10:00:00Z") });

    const quiet = await loadCoverage(tx, org.organization.id, { driverId: driver.id, week: WEEK });
    assert.deepEqual(quiet.summary, { assigned: 2, buyers: 0, withoutPurchase: 2, rate: 0 });
    // the week BEFORE the second customer existed: only the first is in the portfolio
    const before = await loadCoverage(tx, org.organization.id, { driverId: driver.id, week: "2026-03-02" });
    assert.deepEqual(before.customers.map((c) => c.name), ["Ancien"]);
    assert.equal(before.summary.assigned, 1);
  });
});

// ---------------------------------------------------------------------------
// Permissions (server side) - source level, like the other role-gating tests
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("both analyses are admin-only ON THE SERVER, and the organisation comes from the session", () => {
  const server = code("./commercial-analysis.ts");
  const core = code("./commercial-analysis-core.ts");
  assert.match(code("../commercial-analysis/access.ts"), /COMMERCIAL_ANALYSIS_VIEW_ROLES: UserRole\[\] = \["admin"\];/);
  assert.match(server, /export const COMMERCIAL_ANALYSIS_ROLES = COMMERCIAL_ANALYSIS_VIEW_ROLES;/);
  assert.match(server, /export async function getSalesAnalysis\(filters: SalesAnalysisFilters\)[^{]*\{\s+const user = await requireOrganizationUser\(\[\.\.\.COMMERCIAL_ANALYSIS_ROLES\]\);\s+return loadSalesAnalysis\(prisma, user\.organizationId, filters\);/);
  assert.match(server, /export async function getCoverage\(filters: CoverageFilters\)[^{]*\{\s+const user = await requireOrganizationUser\(\[\.\.\.COMMERCIAL_ANALYSIS_ROLES\]\);\s+return loadCoverage\(prisma, user\.organizationId, filters\);/);
  assert.match(server, /^import "server-only";/);
  // the cores decide nothing about access, never import the session or the global client, and are read only
  assert.equal(/requireOrganizationUser|@\/lib\/prisma|server-only/.test(core), false);
  assert.equal(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(core + server), false);
  // the organisation is never a filter coming from the client
  assert.equal(/organizationId[^\n]*filters\./.test(core), false);
});

test("the API routes only call the guarded functions, validate the filters, and answer 401/403/422 without leaking", () => {
  for (const [path, fn, parser] of [
    ["../../app/api/dashboard/sales-analysis/route.ts", "getSalesAnalysis", "parseSalesFilters"],
    ["../../app/api/dashboard/coverage/route.ts", "getCoverage", "parseCoverageFilters"],
  ] as const) {
    const route = code(path);
    assert.match(route, new RegExp(`${fn}\\(`), path);
    assert.match(route, new RegExp(`${parser}\\(`), path);
    assert.match(route, /AuthServiceError/, path);
    assert.match(route, /AnalysisFilterError/, path);
    assert.match(route, /422/, path);
    assert.match(route, /no-store/, path);
    assert.equal(/prisma|\$queryRaw/.test(route), false, `${path} does no query itself`);
  }
});

test("the Dashboard only renders the analysis for an admin", () => {
  const page = code("../../app/(dashboard)/dashboard/page.tsx");
  assert.match(page, /const showCommercialAnalysis = canViewCommercialAnalysis\(sessionUser\?\.role\);/);
  assert.match(page, /\{showCommercialAnalysis \? <CommercialAnalysisTabs \/> : null\}/);
});
