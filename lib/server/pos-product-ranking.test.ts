import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

import { SOLD_SALE_STATUSES, orderByIds, rankPosProducts, soldQuantitiesByProduct } from "./pos-product-ranking";

/**
 * POS catalogue order (best sellers first). The ranking is a database query,
 * so it is tested against the REAL local database, every test inside a
 * transaction that is always rolled back (nothing persists). Skipped when no
 * database is reachable. The pure helper and the wiring are checked below
 * without a database.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let reachable = false;

before(async () => {
  try {
    await Promise.race([
      prisma.$queryRaw`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000)),
    ]);
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

async function makeOrganization(tx: Tx, label: string) {
  const suffix = uid();
  const organization = await tx.organization.create({ data: { code: `T-${label}-${suffix}`.toUpperCase(), name: `Test ${label}` } });
  const user = await tx.user.create({
    data: {
      organizationId: organization.id,
      firstName: "T",
      lastName: label,
      fullName: `Staff ${label}`,
      email: `t-${label}-${suffix}@example.invalid`,
      passwordHash: "x",
      role: "ADMIN",
    },
  });
  const depot = await tx.depot.create({ data: { organizationId: organization.id, code: `D-${suffix}`, name: "Depot", address: "-", city: "-" } });
  const location = await tx.stockLocation.create({
    data: { organizationId: organization.id, code: `L-${suffix}`, name: "Depot", type: "DEPOT", depotId: depot.id },
  });
  const category = await tx.category.create({ data: { organizationId: organization.id, name: `Cat ${label}` } });
  const client = await tx.customer.create({
    data: {
      organizationId: organization.id,
      code: `C-${suffix}`,
      name: "Client",
      address: "-",
      city: "-",
      type: "GROCERY",
      status: "ACTIVE",
      createdByUserId: user.id,
      creationOrigin: "ADMIN",
    },
  });
  return { organization, user, location, category, client };
}
type Ctx = Awaited<ReturnType<typeof makeOrganization>>;

async function product(
  tx: Tx,
  ctx: Ctx,
  name: string,
  options: { reference?: string; barcode?: string | null; status?: "ACTIVE" | "INACTIVE"; stock?: number } = {},
) {
  const created = await tx.product.create({
    data: {
      organizationId: ctx.organization.id,
      reference: options.reference ?? `R-${uid()}`,
      barcode: options.barcode ?? null,
      name,
      categoryId: ctx.category.id,
      purchasePrice: 3,
      salePrice: 4.17,
      taxRate: 20,
      unit: "u",
      status: options.status ?? "ACTIVE",
    },
  });
  if (options.stock !== undefined) {
    await tx.stockLevel.create({
      data: { organizationId: ctx.organization.id, productId: created.id, locationId: ctx.location.id, quantity: options.stock },
    });
  }
  return created;
}

type SaleStatus = "DRAFT" | "VALIDATED" | "PARTIALLY_PAID" | "PAID" | "CREDIT" | "CANCELLED" | "CREDIT_NOTED";

/** One sale with one line per [product, quantity]. */
async function sale(tx: Tx, ctx: Ctx, status: SaleStatus, lines: Array<[{ id: string }, number]>, origin: "COUNTER" | "TRUCK" = "COUNTER") {
  const created = await tx.sale.create({
    data: {
      organizationId: ctx.organization.id,
      invoiceNumber: `T-${uid()}`,
      origin,
      status,
      customerId: ctx.client.id,
      stockLocationId: ctx.location.id,
      subtotalHT: 8.34,
      taxAmount: 1.66,
      totalTTC: 10,
      paymentMethod: "CASH",
      createdByUserId: ctx.user.id,
    },
  });
  for (const [item, quantity] of lines) {
    await tx.saleLine.create({
      data: { saleId: created.id, productId: item.id, quantity, unitPriceHT: 4.17, unitCostHT: 3, taxRate: 20, taxAmount: 0.83 * quantity, totalHT: 4.17 * quantity, totalTTC: 5 * quantity },
    });
  }
  return created;
}

const rankedWithQuantity = async (tx: Tx, ctx: Ctx, extra: { search?: string; limit?: number } = {}) =>
  rankPosProducts(tx, { organizationId: ctx.organization.id, limit: extra.limit ?? 500, search: extra.search });
const ranked = async (tx: Tx, ctx: Ctx, extra: { search?: string; limit?: number } = {}) =>
  (await rankedWithQuantity(tx, ctx, extra)).map((entry) => entry.id);
const names = async (tx: Tx, ids: string[]) => {
  const rows = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return orderByIds(rows, ids).map((row) => row.name);
};

test("descending by total quantity sold, summed over every real sale (counter and truck) of the organisation", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeOrganization(tx, "rank");
    const a = await product(tx, ctx, "Alpha");
    const b = await product(tx, ctx, "Bravo");
    const c = await product(tx, ctx, "Charlie");
    await sale(tx, ctx, "PAID", [[a, 4], [b, 2]]);
    await sale(tx, ctx, "VALIDATED", [[a, 6]], "TRUCK"); // alpha = 10
    await sale(tx, ctx, "CREDIT", [[c, 30], [b, 1]]); // charlie = 30, bravo = 3
    assert.deepEqual(await names(tx, await ranked(tx, ctx)), ["Charlie", "Alpha", "Bravo"]);
    // the quantity travels with the ranking (it is what the POS keeps locally to sort the grid)
    assert.deepEqual((await rankedWithQuantity(tx, ctx)).map((entry) => entry.quantity), [30, 10, 3]);
  });
});

test("only real sales count: DRAFT and CANCELLED are ignored, PARTIALLY_PAID / PAID / CREDIT / VALIDATED / CREDIT_NOTED are counted", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeOrganization(tx, "status");
    const onlyDraft = await product(tx, ctx, "Only draft");
    const onlyCancelled = await product(tx, ctx, "Only cancelled");
    const real = await product(tx, ctx, "Real small");
    const noSale = await product(tx, ctx, "A never sold");
    const creditNoted = await product(tx, ctx, "Credit noted");
    await sale(tx, ctx, "DRAFT", [[onlyDraft, 500]]);
    await sale(tx, ctx, "CANCELLED", [[onlyCancelled, 900]]);
    await sale(tx, ctx, "PARTIALLY_PAID", [[real, 1]]);
    await sale(tx, ctx, "CREDIT_NOTED", [[creditNoted, 7]]);
    const order = await names(tx, await ranked(tx, ctx));
    // creditNoted (7) > real (1) > the three products with no REAL sale (0), those by designation
    assert.deepEqual(order, ["Credit noted", "Real small", "A never sold", "Only cancelled", "Only draft"]);
    assert.ok(order.includes(noSale.name));
    for (const status of SOLD_SALE_STATUSES) {
      const probe = await product(tx, ctx, `Probe ${status}`);
      await sale(tx, ctx, status, [[probe, 2000]]);
    }
    const afterProbes = await names(tx, await ranked(tx, ctx));
    assert.equal(afterProbes.slice(0, 5).every((name) => name.startsWith("Probe ")), true, "every counted status ranks first");
  });
});

test("products without any sale history stay, after the sold ones, with stock zero, negative or absent", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeOrganization(tx, "nosale");
    const sold = await product(tx, ctx, "Zulu sold", { stock: 5 });
    await product(tx, ctx, "Yankee zero stock", { stock: 0 });
    await product(tx, ctx, "X-ray negative stock", { stock: -4 });
    await product(tx, ctx, "Whiskey no stock row");
    await sale(tx, ctx, "PAID", [[sold, 1]]);
    assert.deepEqual(await names(tx, await ranked(tx, ctx)), ["Zulu sold", "Whiskey no stock row", "X-ray negative stock", "Yankee zero stock"]);
  });
});

test("ties: designation, then reference, then id - a stable total order", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeOrganization(tx, "ties");
    const b = await product(tx, ctx, "Boisson", { reference: "REF-2" });
    const b1 = await product(tx, ctx, "Boisson", { reference: "REF-1" });
    const a = await product(tx, ctx, "Autre", { reference: "REF-9" });
    const zero = await product(tx, ctx, "Aaa jamais vendu", { reference: "REF-0" });
    await sale(tx, ctx, "PAID", [[a, 5], [b, 5], [b1, 5]]);
    const first = await ranked(tx, ctx);
    assert.deepEqual(first, [a.id, b1.id, b.id, zero.id]);
    assert.deepEqual(await ranked(tx, ctx), first, "same call, same order");
    // (organisation, reference) is unique, so name + reference already make the order total; the id is a last safety net
  });
});

test("filters: the usual POS match (designation, reference or barcode contains, case-insensitive) ranks only the matches", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeOrganization(tx, "filter");
    const cola = await product(tx, ctx, "Coca Cola 33cl", { reference: "BOI-001", barcode: "6111000000011" });
    const colaBig = await product(tx, ctx, "Cola Zero 1L", { reference: "BOI-002" });
    const eau = await product(tx, ctx, "Eau minérale", { reference: "COLA-REF", barcode: "6111000000099" });
    const fanta = await product(tx, ctx, "Fanta", { reference: "BOI-003" });
    await sale(tx, ctx, "PAID", [[cola, 3], [colaBig, 9], [eau, 5], [fanta, 100]]);
    assert.deepEqual(await names(tx, await ranked(tx, ctx, { search: "cola" })), ["Cola Zero 1L", "Eau minérale", "Coca Cola 33cl"], "name or reference, any case, by quantity sold (fanta excluded)");
    assert.deepEqual(await names(tx, await ranked(tx, ctx, { search: "  COLA  " })), ["Cola Zero 1L", "Eau minérale", "Coca Cola 33cl"], "trimmed, case-insensitive");
    assert.deepEqual(await names(tx, await ranked(tx, ctx, { search: "6111000000099" })), ["Eau minérale"], "barcode");
    assert.deepEqual(await ranked(tx, ctx, { search: "introuvable" }), []);
    // LIKE wildcards are plain characters, never patterns
    assert.deepEqual(await ranked(tx, ctx, { search: "%" }), []);
    assert.deepEqual(await ranked(tx, ctx, { search: "_" }), []);
    assert.equal((await ranked(tx, ctx)).length, 4, "no search = every active product");
  });
});

test("the limit applies AFTER the ranking: the top sellers are kept, not the first names", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeOrganization(tx, "limit");
    const aaa = await product(tx, ctx, "Aaa");
    const bbb = await product(tx, ctx, "Bbb");
    const zzz = await product(tx, ctx, "Zzz");
    await sale(tx, ctx, "PAID", [[zzz, 50], [bbb, 10], [aaa, 1]]);
    assert.deepEqual(await names(tx, await ranked(tx, ctx, { limit: 2 })), ["Zzz", "Bbb"]);
    assert.deepEqual(await names(tx, await ranked(tx, ctx, { limit: 1 })), ["Zzz"]);
  });
});

test("scoped to the organisation and to ACTIVE products", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const mine = await makeOrganization(tx, "mine");
    const other = await makeOrganization(tx, "other");
    const p = await product(tx, mine, "Mine");
    const inactive = await product(tx, mine, "Inactive big seller", { status: "INACTIVE" });
    const foreign = await product(tx, other, "Foreign");
    await sale(tx, mine, "PAID", [[p, 1], [inactive, 99]]);
    await sale(tx, other, "PAID", [[foreign, 999]]);
    assert.deepEqual(await ranked(tx, mine), [p.id], "no inactive product, no foreign product");
    assert.deepEqual(await ranked(tx, other), [foreign.id]);
    // a (corrupt) sale line of ANOTHER organisation pointing at my product never counts for me
    const q = await product(tx, mine, "Q");
    await sale(tx, other, "PAID", [[{ id: q.id }, 500]]);
    assert.deepEqual(await ranked(tx, mine), [p.id, q.id], "q stays at zero: only my organisation's sales are summed");
  });
});

test("one single aggregated query, whatever the number of products (no query per product)", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeOrganization(tx, "perf");
    const items = [];
    for (let i = 0; i < 25; i++) items.push(await product(tx, ctx, `P${String(i).padStart(2, "0")}`));
    await sale(tx, ctx, "PAID", items.map((item, i) => [item, i + 1] as [{ id: string }, number]));
    let calls = 0;
    const counting = {
      $queryRaw: ((...args: Parameters<Tx["$queryRaw"]>) => {
        calls += 1;
        return tx.$queryRaw(...args);
      }) as Tx["$queryRaw"],
    };
    const ids = await rankPosProducts(counting, { organizationId: ctx.organization.id, limit: 500 });
    assert.equal(ids.length, 25);
    assert.equal(calls, 1);
    assert.equal(ids[0].id, items[24].id, "the product with the largest quantity is first");
    assert.equal(ids[0].quantity, 25);
    // the page-level helper is also a single query for any number of products
    calls = 0;
    const sums = await soldQuantitiesByProduct(counting, { organizationId: ctx.organization.id, productIds: items.map((item) => item.id) });
    assert.equal(calls, 1);
    assert.equal(sums.get(items[0].id), 1);
    assert.equal(sums.get(items[24].id), 25);
  });
});

test("soldQuantitiesByProduct: real sales only, 0 for a product with none, scoped to the organisation", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const mine = await makeOrganization(tx, "sums");
    const other = await makeOrganization(tx, "sums-other");
    const sold = await product(tx, mine, "Sold");
    const draftOnly = await product(tx, mine, "Draft only");
    const never = await product(tx, mine, "Never");
    await sale(tx, mine, "PAID", [[sold, 4]]);
    await sale(tx, mine, "CREDIT", [[sold, 6]]);
    await sale(tx, mine, "DRAFT", [[draftOnly, 50]]);
    await sale(tx, mine, "CANCELLED", [[sold, 1000]]);
    await sale(tx, other, "PAID", [[{ id: sold.id }, 777]]); // another organisation's line on my product
    const sums = await soldQuantitiesByProduct(tx, { organizationId: mine.organization.id, productIds: [sold.id, draftOnly.id, never.id] });
    assert.deepEqual([...sums], [[sold.id, 10], [draftOnly.id, 0], [never.id, 0]]);
    assert.deepEqual([...(await soldQuantitiesByProduct(tx, { organizationId: mine.organization.id, productIds: [] }))], []);
  });
});

test("ranking only reads: sales, stock and money are untouched", async (t) => {
  if (!reachable) return t.skip("no local database reachable");
  await inRollback(async (tx) => {
    const ctx = await makeOrganization(tx, "readonly");
    const p = await product(tx, ctx, "P", { stock: 7 });
    await sale(tx, ctx, "PAID", [[p, 3]]);
    const snapshot = async () => ({
      sales: await tx.sale.count({ where: { organizationId: ctx.organization.id } }),
      lines: await tx.saleLine.count({ where: { sale: { organizationId: ctx.organization.id } } }),
      payments: await tx.payment.count({ where: { sale: { organizationId: ctx.organization.id } } }),
      entries: await tx.accountingEntry.count({ where: { organizationId: ctx.organization.id } }),
      movements: await tx.stockMovement.count({ where: { organizationId: ctx.organization.id } }),
      stock: (await tx.stockLevel.findFirstOrThrow({ where: { productId: p.id } })).quantity,
    });
    const before = await snapshot();
    await ranked(tx, ctx);
    await ranked(tx, ctx, { search: "p" });
    assert.deepEqual(await snapshot(), before);
  });
});

// ---------------------------------------------------------------------------
// No database needed
// ---------------------------------------------------------------------------

test("orderByIds puts rows back in the ranking order and drops ids that are no longer there", () => {
  const rows = [{ id: "b" }, { id: "c" }, { id: "a" }];
  assert.deepEqual(orderByIds(rows, ["a", "b", "c"]).map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(orderByIds(rows, ["c", "gone", "a"]).map((r) => r.id), ["c", "a"]);
  assert.deepEqual(orderByIds([], ["a"]), []);
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("the sold statuses are the project's real-sale perimeter (no DRAFT, no CANCELLED)", () => {
  assert.deepEqual([...SOLD_SALE_STATUSES], ["VALIDATED", "PARTIALLY_PAID", "PAID", "CREDIT", "CREDIT_NOTED"]);
  for (const path of ["./dashboard-bi.ts", "../forecasting/product-daily-sales.ts"]) {
    const source = code(path);
    for (const status of SOLD_SALE_STATUSES) assert.match(source, new RegExp(`"${status}"`), `${path} counts ${status}`);
    assert.equal(/"DRAFT"/.test(source.slice(0, source.indexOf("]"))), false);
  }
  assert.equal((SOLD_SALE_STATUSES as readonly string[]).includes("DRAFT"), false);
  assert.equal((SOLD_SALE_STATUSES as readonly string[]).includes("CANCELLED"), false);
});

test("wiring: the counter POS preload and its search use the ranking; the driver POS and the other screens do not", () => {
  const sales = code("./counter-sales.ts");
  assert.match(sales, /const ranked = await rankPosProducts\(prisma, \{\s+organizationId: sessionUser\.organizationId,\s+limit: POS_PRODUCT_LIST_LIMIT \+ 1,/);
  assert.match(sales, /soldQuantity: soldByProductId\.get\(product\.id\) \?\? 0,/);
  assert.match(sales, /return orderByIds\(rows, rankedIds\);/);
  assert.equal(/orderBy: \{ name: "asc" \},\s+take: POS_PRODUCT_LIST_LIMIT \+ 1/.test(sales), false, "the name-ordered preload is gone");
  assert.match(sales, /loadRankedPreloadProducts\(\)/);

  const products = code("./products.ts");
  assert.match(products, /if \(params\.rankBySales\) \{/);
  assert.match(products, /rankPosProducts\(prisma, \{ organizationId, search: query, limit \}\)/);
  // the catalogue pages the offline POS downloads: soldQuantity ONLY when asked (withSales), one query for the page
  assert.match(products, /params\.withSales\s+\? await soldQuantitiesByProduct\(prisma, \{ organizationId, productIds: pageRows\.map\(\(row\) => row\.id\) \}\)\s+: null;/);
  assert.match(products, /return soldById \? \{ \.\.\.dto, soldQuantity: soldById\.get\(row\.id\) \?\? 0 \} : dto;/);
  assert.match(code("../../app/api/products/list/route.ts"), /withSales: url\.searchParams\.get\("withSales"\) === "1",/);
  assert.match(code("../offline/counter-pos/pos-sync.ts"), /withSales: "1"/);
  // the original name-ordered path is still there for everyone else
  assert.match(products, /orderBy: \{ name: "asc" \},\s+take: limit,\s+\}\);\s+return withLevels\(matches\);/);
  // the exact barcode shortcut still comes first
  assert.ok(products.indexOf("exactBarcodeMatch") < products.indexOf("if (params.rankBySales)"));

  const route = code("../../app/api/products/search/route.ts");
  assert.match(route, /rankBySales: url\.searchParams\.get\("sort"\) === "sold",/);

  const hook = code("../../components/pos/use-pos-product-search.ts");
  assert.match(hook, /sort: "sold"/);
  assert.match(hook, /options\.searchRemote \?\? \(rankBySales \? rankedSearchRemote : defaultSearchRemote\)/);
  assert.match(code("../../components/pos/pos-layout.tsx"), /rankBySales: true,/);
  assert.equal(/rankBySales/.test(code("../../components/driver-pos/driver-pos-view.tsx")), false, "driver POS unchanged");
});

test("the ranking is one aggregated query: no query inside a per-product loop", () => {
  const source = code("./pos-product-ranking.ts");
  assert.equal((source.match(/db\.\$queryRaw</g) ?? []).length, 2, "one raw query per function (ranking, page sums)");
  assert.equal(/for \(const (product|id|item)|\.map\(async|Promise\.all/.test(source.slice(source.indexOf("export async function rankPosProducts"), source.indexOf("export function orderByIds"))), false);
  assert.match(source, /strpos\(lower\(p\.name\), lower\(\$\{search\}\)\)/);
  assert.match(source, /ORDER BY COALESCE\(sold\.quantity, 0\) DESC, m\.name ASC, m\.reference ASC, m\.id ASC/);
  assert.match(source, /SUM\(sl\.quantity\)/);
});
