import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { test } from "node:test";

import type { QuantityTiers } from "@/lib/quantity-pricing";

import {
  hydrateCounterPosSnapshot,
  loadCachedCounterPosContext,
  productDtoFromRecord,
  productRecordFromDto,
} from "./pos-data-source";
import { contextResponseSchema, posProductFromListProduct } from "./sync-schemas";
import { makeContext, uniqueOrg, unwrap } from "./test-helpers";

const T0 = new Date("2026-10-11T09:00:00.000Z");
const tiers: QuantityTiers = { retailPriceHT: 4.17, semiWholesalePriceHT: 3.75, semiWholesaleMinQty: 6, wholesaleMinQty: 24 };

test("the offline snapshot keeps the setting and each product's tiers, and gives them back offline", async () => {
  const org = uniqueOrg("qp");
  const scope = { organizationId: org, userId: "user-1" };
  const base = makeContext();
  const context = {
    ...base,
    quantityPricingEnabled: true,
    products: base.products.map((product, index) => (index === 0 ? { ...product, quantityTiers: tiers } : product)),
  };
  unwrap(await hydrateCounterPosSnapshot(scope, context, { now: T0 }));
  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok, true);
  if (!cached.ok) return;
  assert.equal(cached.context.quantityPricingEnabled, true);
  const withTiers = cached.context.products.find((product) => product.id === context.products[0].id);
  assert.deepEqual(withTiers?.quantityTiers, tiers);
  // the other products have none (they stay at the wholesale price offline too)
  assert.ok(cached.context.products.filter((product) => product.id !== context.products[0].id).every((product) => !product.quantityTiers));
});

test("a snapshot taken with the setting OFF (or before it existed) reads back as OFF", async () => {
  const org = uniqueOrg("qp-off");
  const scope = { organizationId: org, userId: "user-1" };
  unwrap(await hydrateCounterPosSnapshot(scope, makeContext(), { now: T0 }));
  const cached = await loadCachedCounterPosContext(scope);
  assert.equal(cached.ok && cached.context.quantityPricingEnabled, false);
});

test("product record <-> DTO: tiers round-trip; a record written before them has none", () => {
  const dto = { ...makeContext().products[0], quantityTiers: tiers };
  const record = productRecordFromDto("org", dto, T0.toISOString());
  assert.deepEqual(record.quantityTiers, tiers);
  assert.deepEqual(productDtoFromRecord(record, 3).quantityTiers, tiers);
  const legacy = { ...record };
  delete legacy.quantityTiers;
  assert.equal("quantityTiers" in productDtoFromRecord(legacy, 3), false);
});

test("the sync validates and keeps the server's setting and tiers", () => {
  const product = { ...makeContext().products[0], quantityTiers: tiers };
  const parsed = contextResponseSchema.parse({ context: { ...makeContext(), products: [product], quantityPricingEnabled: true } });
  assert.equal(parsed.context.quantityPricingEnabled, true);
  assert.deepEqual(parsed.context.products[0].quantityTiers, tiers);
  // a context from a server without the setting still parses (OFF)
  assert.equal(contextResponseSchema.parse({ context: makeContext() }).context.quantityPricingEnabled, undefined);
});

test("full catalogue pages (/api/products/list): only COMPLETE tiers travel, like the server context", () => {
  const listProduct = {
    id: "p-9",
    reference: "R9",
    barcode: null,
    name: "Produit 9",
    salePrice: 3.33,
    taxRate: 20,
    status: "ACTIVE",
    imageUrl: null,
    supplier: null,
    retailPrice: 4.17,
    semiWholesalePrice: 3.75,
    semiWholesaleMinQty: 6,
    wholesaleMinQty: 24,
  };
  assert.deepEqual(posProductFromListProduct(listProduct, new Map()).quantityTiers, tiers);
  assert.equal("quantityTiers" in posProductFromListProduct({ ...listProduct, wholesaleMinQty: null }, new Map()), false);
  assert.equal("quantityTiers" in posProductFromListProduct({ ...listProduct, semiWholesaleMinQty: 30 }, new Map()), false);
});
