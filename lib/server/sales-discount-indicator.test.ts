import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { canSeeDiscountIndicator } from "@/lib/sale-discount-indicator";

import { mapOrderRowToListItemDto, orderListSelect } from "./sale-list-row";

/**
 * "REMISE" indicator of the invoice lists, against the REAL local database
 * (every test inside a transaction that is always rolled back; skipped when no
 * database is reachable), plus the server-side role gating.
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
      { timeout: 60_000, maxWait: 20_000 },
    ),
    Rollback,
  );
}

async function makeContext(tx: Tx) {
  const suffix = uid();
  const organization = await tx.organization.create({ data: { code: `T-DISC-${suffix}`.toUpperCase(), name: "Test remise" } });
  const user = await tx.user.create({
    data: { organizationId: organization.id, firstName: "T", lastName: "D", fullName: "Staff D", email: `t-${suffix}@example.invalid`, passwordHash: "x", role: "ADMIN" },
  });
  const depot = await tx.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  const location = await tx.stockLocation.create({ data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id } });
  const category = await tx.category.create({ data: { organizationId: organization.id, name: "Cat" } });
  const customer = await tx.customer.create({
    data: { organizationId: organization.id, code: `C-${suffix}`, name: "Client", address: "-", city: "-", type: "GROCERY", status: "ACTIVE", createdByUserId: user.id, creationOrigin: "ADMIN" },
  });
  const product = await tx.product.create({
    data: { organizationId: organization.id, reference: `R-${suffix}`, name: "Produit", categoryId: category.id, purchasePrice: 3, salePrice: 20, taxRate: 20, unit: "u", status: "ACTIVE" },
  });
  return { organization, user, location, customer, product };
}
type Ctx = Awaited<ReturnType<typeof makeContext>>;

type SaleStatus = "DRAFT" | "VALIDATED" | "PAID" | "CREDIT" | "CANCELLED" | "CREDIT_NOTED";

/** One sale with one line. `discountHT` is what was STORED (sale and line); `totalTTC` is whatever the sale was sold for. */
async function sale(
  tx: Tx,
  ctx: Ctx,
  options: {
    status?: SaleStatus;
    discountHT?: number;
    lineDiscountHT?: number;
    totalTTC?: number;
    quantity?: number;
    unitPriceHT?: number;
    origin?: "COUNTER" | "TRUCK";
    posSessionId?: string | null;
  } = {},
) {
  const created = await tx.sale.create({
    data: {
      organizationId: ctx.organization.id,
      invoiceNumber: `T-${uid()}`,
      origin: options.origin ?? "COUNTER",
      status: options.status ?? "PAID",
      customerId: ctx.customer.id,
      stockLocationId: ctx.location.id,
      subtotalHT: 20,
      discountAmount: options.discountHT ?? 0,
      taxAmount: 4,
      totalTTC: options.totalTTC ?? 24,
      paymentMethod: "CASH",
      createdByUserId: ctx.user.id,
      ...(options.posSessionId ? { posSessionId: options.posSessionId } : {}),
    },
  });
  await tx.saleLine.create({
    data: {
      saleId: created.id,
      productId: ctx.product.id,
      quantity: options.quantity ?? 1,
      unitPriceHT: options.unitPriceHT ?? 20,
      unitCostHT: 3,
      discountAmount: options.lineDiscountHT ?? options.discountHT ?? 0,
      taxRate: 20,
      taxAmount: 4,
      totalHT: 20,
      totalTTC: options.totalTTC ?? 24,
    },
  });
  return created;
}

async function listItem(tx: Tx, id: string, includeDiscount: boolean) {
  const row = await tx.sale.findFirstOrThrow({ where: { id }, select: orderListSelect });
  return mapOrderRowToListItemDto(row, row.totalTTC.toNumber(), { includeDiscount });
}

test("an invoice with a stored discount carries the indicator and the TTC amount (for a role allowed to see it)", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeContext(tx);
    const discounted = await sale(tx, ctx, { discountHT: 0.83, totalTTC: 23 });
    const item = await listItem(tx, discounted.id, true);
    assert.equal(item.hasDiscount, true);
    assert.equal(item.discountTTC, 1);
    // the money fields of the row are exactly what they were: the indicator adds, never changes
    assert.equal(item.totalTTC, 23);
    assert.equal(item.net, 23);
    assert.equal(item.paidAmount, 0);
    assert.equal(item.creditAmount, 0);
  });
});

test("an invoice without a recorded discount has no indicator - even when it was sold below the usual price", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeContext(tx);
    const plain = await sale(tx, ctx, { totalTTC: 24 });
    // catalogue price TTC = 24.00; this one was SOLD for 18.00 with NO stored discount (price edit, old tariff...)
    const soldLower = await sale(tx, ctx, { totalTTC: 18 });
    for (const id of [plain.id, soldLower.id]) {
      const item = await listItem(tx, id, true);
      assert.equal(item.hasDiscount, undefined, "no flag");
      assert.equal("discountTTC" in item, false, "no amount");
    }
  });
});

test("historical rows: a discount stored on the line is found even if the sale total was never filled; a sale-level number alone is not a discount", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeContext(tx);
    const lineOnly = await sale(tx, ctx, { discountHT: 0, lineDiscountHT: 1.67, totalTTC: 22 });
    const saleOnly = await sale(tx, ctx, { discountHT: 2, lineDiscountHT: 0, totalTTC: 22 });
    const [fromLine, fromSale] = [await listItem(tx, lineOnly.id, true), await listItem(tx, saleOnly.id, true)];
    assert.deepEqual([fromLine.hasDiscount, fromLine.discountTTC], [true, 2]);
    assert.equal(fromSale.hasDiscount, undefined, "no article carries a discount -> nothing to flag");
  });
});

test("a one-cent HT rounding difference stored on an invoice that was NOT discounted is not flagged (real probe data: 2 x 5.00 TTC)", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeContext(tx);
    const noise = await sale(tx, ctx, { discountHT: 0.01, quantity: 2, unitPriceHT: 4.17, totalTTC: 10 });
    const item = await listItem(tx, noise.id, true);
    assert.equal(item.hasDiscount, undefined);
    assert.equal("discountTTC" in item, false);
    // the same product with a discount really typed (1.00 DH off the 5.00 unit) is flagged with exactly 1.00
    const typed = await sale(tx, ctx, { discountHT: 0.84, unitPriceHT: 4.17, totalTTC: 4 });
    const flagged = await listItem(tx, typed.id, true);
    assert.deepEqual([flagged.hasDiscount, flagged.discountTTC], [true, 1]);
  });
});

test("the information is permanent: it is still there for archived / cancelled / credit-noted / session invoices and after a reload", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeContext(tx);
    for (const status of ["PAID", "CREDIT", "VALIDATED", "CREDIT_NOTED", "CANCELLED"] as const) {
      const created = await sale(tx, ctx, { status, discountHT: 0.83, totalTTC: 23 });
      const first = await listItem(tx, created.id, true);
      const afterReload = await listItem(tx, created.id, true); // a brand new read = what a page reload does
      assert.deepEqual([first.hasDiscount, first.discountTTC], [true, 1], status);
      assert.deepEqual(afterReload, first, `${status}: identical after reload`);
    }
    const truck = await sale(tx, ctx, { origin: "TRUCK", discountHT: 0.83, totalTTC: 23 });
    assert.equal((await listItem(tx, truck.id, true)).hasDiscount, true, "truck sales too");
  });
});

test("a role that may not see it gets NO trace of the discount in the row (the server decides, not the UI)", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeContext(tx);
    const discounted = await sale(tx, ctx, { discountHT: 0.83, totalTTC: 23 });
    const hidden = await listItem(tx, discounted.id, false);
    assert.equal("hasDiscount" in hidden, false);
    assert.equal("discountTTC" in hidden, false);
    assert.equal(JSON.stringify(hidden).toLowerCase().includes("discount"), false, "nothing named discount is serialised");
    assert.equal(JSON.stringify(hidden).includes("0.83"), false);
    // and the default of the mapper is "do not include"
    const row = await tx.sale.findFirstOrThrow({ where: { id: discounted.id }, select: orderListSelect });
    assert.equal("hasDiscount" in mapOrderRowToListItemDto(row, 23), false);
  });
});

test("every role is gated the same way the pages are: admin / cashier see it, driver and depot manager do not", () => {
  const decisions = Object.fromEntries(["super_admin", "admin", "cashier", "depot_manager", "driver"].map((role) => [role, canSeeDiscountIndicator(role)]));
  assert.deepEqual(decisions, { super_admin: true, admin: true, cashier: true, depot_manager: false, driver: false });
});

// ---------------------------------------------------------------------------
// No database needed: server-side wiring (a driver cannot get the data through an API)
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("the two list functions are staff-only on the server, and they alone add the indicator, from the SESSION role", () => {
  const history = code("./sales-history.ts");
  const daily = code("./daily-invoices.ts");
  for (const [name, source] of [["getSalesOrdersPage", history], ["getDailyInvoicesPage", daily]] as const) {
    assert.match(source, /requireOrganizationUser\(\["admin", "depot_manager", "cashier"\]\)/, name);
    assert.equal(/requireOrganizationUser\([^)]*"driver"/.test(source), false, `${name} never allows a driver`);
  }
  assert.match(history, /includeDiscount: canSeeDiscountIndicator\(currentUser\.role\),/);
  assert.match(daily, /includeDiscount: canSeeDiscountIndicator\(user\.role\),/);
  // the mapper is the ONLY producer of the indicator and is only called by those two functions
  assert.equal((history.match(/mapOrderRowToListItemDto\(/g) ?? []).length, 1, "the archives call only");
  assert.equal((daily.match(/mapOrderRowToListItemDto\(/g) ?? []).length, 1, "the daily call only");
  assert.equal((code("./sale-list-row.ts").match(/export function mapOrderRowToListItemDto\(/g) ?? []).length, 1, "one definition");
  assert.match(history, /export \{ mapOrderRowToListItemDto, orderListSelect \};/, "still exported from sales-history for the daily page");
  // no client input can switch it on: neither route reads a parameter for it
  for (const route of ["../../app/api/sales-history/route.ts", "../../app/api/daily-invoices/route.ts"]) {
    assert.equal(/discount|remise/i.test(code(route)), false, route);
  }
});

test("the new fields exist nowhere in the driver's data: driver DTO builders, driver routes and the driver history view are untouched", () => {
  for (const path of ["./driver-sales.ts", "./sales-shared.ts", "../../app/api/driver/sales/[id]/route.ts", "../../components/driver-pos/driver-sales-view.tsx"]) {
    assert.equal(/hasDiscount|discountTTC|DISCOUNT_INDICATOR|canSeeDiscountIndicator|InvoiceDiscountBadge/.test(code(path)), false, path);
  }
  // staff detail API stays staff-only, the driver detail API stays driver-only (existing rules, unchanged)
  assert.match(code("./driver-sales.ts"), /export async function getSaleById\(id: string\): Promise<SaleDto> \{\s+const currentUser = await requireOrganizationUser\(\["admin", "depot_manager", "cashier"\]\);/);
  assert.match(code("./driver-sales.ts"), /export async function getDriverSaleById\(id: string\): Promise<SaleDto> \{\s+const user = await requireOrganizationUser\(\["driver"\]\);/);
});

test("no migration is involved: the indicator reads columns that already exist", () => {
  const schema = read("../../prisma/schema.prisma");
  assert.match(schema, /discountAmount\s+Decimal\s+@default\(0\) @db\.Decimal\(12, 2\)/);
});
