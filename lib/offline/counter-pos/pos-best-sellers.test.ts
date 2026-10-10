import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { CounterPosContextDto, DriverPosProductDto } from "@/types/operations-dto";

import { getCounterPosDatabase } from "./database";
import { hydrateCounterPosSnapshot, loadCachedCounterPosContext, productRecordFromDto } from "./pos-data-source";
import { contextResponseSchema, posProductFromListProduct, productPageSchema } from "./sync-schemas";
import { makeContext, uniqueOrg, unwrap } from "./test-helpers";

/**
 * Best sellers first, kept LOCALLY: the counter POS rebuilds its grid from the
 * offline cache (also when offline), so the quantity sold travels with each
 * product record and the local read sorts on it - descending, products with no
 * sale after them, ties by designation. The quantity is never displayed.
 */

const T0 = new Date("2026-10-10T10:00:00.000Z");
const scopeFor = (org: string) => ({ organizationId: org, userId: "user-1" });

const product = (id: string, name: string, extra: Partial<DriverPosProductDto> = {}): DriverPosProductDto => ({
  id,
  reference: `REF-${id}`,
  barcode: null,
  name,
  imageUrl: null,
  salePriceHT: 10,
  salePriceTTC: 12,
  taxRate: 20,
  availableQuantity: 5,
  supplierId: null,
  supplierName: null,
  supplierLogoUrl: null,
  ...extra,
});

const contextWith = (products: DriverPosProductDto[], extra: Partial<CounterPosContextDto> = {}) =>
  makeContext({ products, productsTruncated: false, ...extra });

async function loadedNames(org: string) {
  const cached = await loadCachedCounterPosContext(scopeFor(org));
  assert.equal(cached.ok, true);
  return cached.ok ? cached.context.products.map((p) => p.name) : [];
}

test("the local grid order is quantity sold descending, then products without sales, then designation for ties", async () => {
  const org = uniqueOrg();
  unwrap(
    await hydrateCounterPosSnapshot(
      scopeFor(org),
      contextWith([
        product("a", "Alpha", { soldQuantity: 10 }),
        product("b", "Bravo", { soldQuantity: 10 }), // tie with Alpha -> designation
        product("z", "Zulu", { soldQuantity: 50 }),
        product("m", "Mike", { soldQuantity: 3 }),
        product("n", "November"), // no soldQuantity at all (no history / old server)
        product("c", "Charlie", { soldQuantity: 0 }), // explicit zero
      ]),
      { now: T0 },
    ),
  );
  assert.deepEqual(await loadedNames(org), ["Zulu", "Alpha", "Bravo", "Mike", "Charlie", "November"]);
});

test("products with zero or negative stock stay in the grid, ranked like any other product", async () => {
  const org = uniqueOrg();
  unwrap(
    await hydrateCounterPosSnapshot(
      scopeFor(org),
      contextWith([
        product("s", "Sold but out of stock", { soldQuantity: 9, availableQuantity: -4 }),
        product("o", "Zero stock never sold", { availableQuantity: 0 }),
        product("k", "In stock never sold", { availableQuantity: 12 }),
      ]),
      { now: T0 },
    ),
  );
  const cached = await loadCachedCounterPosContext(scopeFor(org));
  assert.equal(cached.ok, true);
  if (!cached.ok) return;
  assert.deepEqual(
    cached.context.products.map((p) => [p.name, p.availableQuantity]),
    [["Sold but out of stock", -4], ["In stock never sold", 12], ["Zero stock never sold", 0]],
  );
});

test("records written before the field existed count as 0 and sort after the sold products", async () => {
  const org = uniqueOrg();
  unwrap(await hydrateCounterPosSnapshot(scopeFor(org), contextWith([product("a", "Alpha", { soldQuantity: 4 }), product("b", "Bravo")]), { now: T0 }));
  const db = await getCounterPosDatabase(org);
  assert.ok(db);
  const legacy = productRecordFromDto(org, product("l", "Aaa legacy"), T0.toISOString());
  delete (legacy as { soldQuantity?: number }).soldQuantity;
  await db.products.put(legacy);
  assert.deepEqual(await loadedNames(org), ["Alpha", "Aaa legacy", "Bravo"]);
});

test("a later sync re-ranks the grid (and counts the changed quantity as an update)", async () => {
  const org = uniqueOrg();
  const scope = scopeFor(org);
  unwrap(await hydrateCounterPosSnapshot(scope, contextWith([product("a", "Alpha", { soldQuantity: 10 }), product("b", "Bravo", { soldQuantity: 5 })]), { now: T0 }));
  assert.deepEqual(await loadedNames(org), ["Alpha", "Bravo"]);
  const summary = unwrap(
    await hydrateCounterPosSnapshot(scope, contextWith([product("a", "Alpha", { soldQuantity: 10 }), product("b", "Bravo", { soldQuantity: 25 })]), {
      now: new Date(T0.getTime() + 60_000),
    }),
  );
  assert.deepEqual(summary.products, { total: 2, added: 0, updated: 1, removed: 0 });
  assert.deepEqual(await loadedNames(org), ["Bravo", "Alpha"]);
  // same data again: nothing changes
  const again = unwrap(
    await hydrateCounterPosSnapshot(scope, contextWith([product("a", "Alpha", { soldQuantity: 10 }), product("b", "Bravo", { soldQuantity: 25 })]), {
      now: new Date(T0.getTime() + 120_000),
    }),
  );
  assert.deepEqual(again.products, { total: 2, added: 0, updated: 0, removed: 0 });
});

test("the order is kept for the whole synced catalogue (not only the first 500) and the supplier filter keeps it", async () => {
  const org = uniqueOrg();
  const many = Array.from({ length: 600 }, (_, i) =>
    product(`p${String(i).padStart(3, "0")}`, `Produit ${String(i).padStart(3, "0")}`, {
      soldQuantity: i === 599 ? 1000 : i === 3 ? 500 : 0,
      supplierId: i % 2 === 0 ? "s-even" : "s-odd",
      supplierName: i % 2 === 0 ? "Pairs" : "Impairs",
    }),
  );
  unwrap(await hydrateCounterPosSnapshot(scopeFor(org), contextWith(many, { productsTruncated: true }), { now: T0 }));
  const cached = await loadCachedCounterPosContext(scopeFor(org));
  assert.equal(cached.ok, true);
  if (!cached.ok) return;
  const names = cached.context.products.map((p) => p.name);
  assert.deepEqual(names.slice(0, 3), ["Produit 599", "Produit 003", "Produit 000"]);
  // what the POS grid does for the supplier filter: a plain filter over the already ordered list
  const odd = cached.context.products.filter((p) => p.supplierId === "s-odd").map((p) => p.name);
  assert.deepEqual(odd.slice(0, 3), ["Produit 599", "Produit 003", "Produit 001"]);
});

test("the quantity is a sort key only: the rebuilt product never shows an amount, a price or a stock change", async () => {
  const org = uniqueOrg();
  const source = product("a", "Alpha", { soldQuantity: 7, availableQuantity: 3, salePriceTTC: 12 });
  unwrap(await hydrateCounterPosSnapshot(scopeFor(org), contextWith([source]), { now: T0 }));
  const cached = await loadCachedCounterPosContext(scopeFor(org));
  assert.equal(cached.ok, true);
  if (!cached.ok) return;
  const [rebuilt] = cached.context.products;
  assert.equal(rebuilt.salePriceTTC, 12);
  assert.equal(rebuilt.availableQuantity, 3);
  assert.equal(rebuilt.soldQuantity, 7);
});

test("sync schemas accept soldQuantity (context and catalogue pages) and refuse a negative one", () => {
  const base = {
    id: "p1",
    reference: "R",
    barcode: null,
    name: "N",
    imageUrl: null,
    salePriceHT: 1,
    salePriceTTC: 1.2,
    taxRate: 20,
    availableQuantity: 0,
  };
  const context = (products: unknown[]) => ({
    context: {
      canSell: true,
      user: { id: "u", name: "U" },
      depot: { id: "d", code: "D", name: "D" },
      stockLocation: { id: "l", code: "L", name: "L" },
      customers: [],
      defaultCustomerId: null,
      products,
      productsTruncated: false,
      bankAccounts: [],
    },
  });
  const ok = contextResponseSchema.parse(context([{ ...base, soldQuantity: 12 }, { ...base, id: "p2" }]));
  assert.equal(ok.context.products[0].soldQuantity, 12);
  assert.equal(ok.context.products[1].soldQuantity, undefined);
  assert.equal(contextResponseSchema.safeParse(context([{ ...base, soldQuantity: -1 }])).success, false);

  const page = (items: unknown[]) => ({ items, nextCursor: null, hasMore: false, totalCount: items.length });
  const item = { id: "p1", reference: "R", barcode: null, name: "N", salePrice: 1, taxRate: 20, status: "ACTIVE", imageUrl: null, supplier: null };
  const parsed = productPageSchema.parse(page([{ ...item, soldQuantity: 8 }, { ...item, id: "p2" }]));
  assert.equal(posProductFromListProduct(parsed.items[0], new Map()).soldQuantity, 8);
  assert.equal("soldQuantity" in posProductFromListProduct(parsed.items[1], new Map()), false, "nothing invented when the server did not send it");
  assert.equal(productPageSchema.safeParse(page([{ ...item, soldQuantity: -3 }])).success, false);
});

test("wiring: the catalogue download asks for the quantities, the local read sorts on them, nothing else sorts the grid", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const sync = read("./pos-sync.ts");
  assert.match(sync, /new URLSearchParams\(\{ status: "ACTIVE", pageSize: String\(pageSize\), withSales: "1" \}\)/);
  const source = read("./pos-data-source.ts");
  assert.match(source, /\.sort\(\(a, b\) => \(b\.soldQuantity \?\? 0\) - \(a\.soldQuantity \?\? 0\) \|\| a\.name\.localeCompare\(b\.name, "fr"\)\)/);
  assert.equal((source.match(/productRecords\s+\.sort\(/g) ?? []).length, 1);
  // the grid component itself does not re-sort: it filters the list it is given
  const layout = read("../../../components/pos/pos-layout.tsx");
  assert.equal(/matchedProducts\.(sort|toSorted)|filteredProducts\.(sort|toSorted)/.test(layout), false);
});
