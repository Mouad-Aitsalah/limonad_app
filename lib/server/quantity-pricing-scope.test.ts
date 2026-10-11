import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * Where quantity pricing applies - and where it must NOT. Source-level checks
 * (these modules need a session and a database to run); the behaviour itself
 * is covered by lib/quantity-pricing.test.ts and the end-to-end run on the
 * isolated test database.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

test("createCounterSale: setting read from the DATABASE for the session's organisation, tiers from the product row", () => {
  const source = read("lib/server/counter-sales.ts");
  const create = source.slice(source.indexOf("export async function createCounterSale"));
  assert.match(create, /const quantityPricingEnabled = await readQuantityPricingEnabled\(tx, sessionUser\.organizationId\);/);
  assert.match(create, /retailPrice: true,\s*semiWholesalePrice: true,\s*semiWholesaleMinQty: true,\s*wholesaleMinQty: true,/);
  assert.match(create, /const quantityByProduct = sumQuantitiesByProduct\(lines\);/);
  // admin manual price first, otherwise the quantity / wholesale price from the database
  assert.match(
    create,
    /canOverrideLinePrice && line\.unitPriceHT != null\s*\? roundMoney\(line\.unitPriceHT\)\s*: resolveQuantityPrice\(\{\s*enabled: quantityPricingEnabled,\s*wholesalePriceHT: product\.salePrice\.toNumber\(\),\s*tiers: quantityTierValuesFromRow\(product\),/,
  );
  assert.match(create, /const canOverrideLinePrice = sessionUser\.role === "admin";/);
});

test("the sale request cannot carry a tier, a setting or a trusted price: the line schema is unchanged", () => {
  const source = read("lib/server/counter-sales.ts");
  const schema = source.slice(source.indexOf("const counterSaleSchema"), source.indexOf("const POS_PRODUCT_LIST_LIMIT"));
  assert.equal(/quantityPricing|quantityTiers|retailPrice|semiWholesale|tier/i.test(schema), false);
});

test("invoice revision: a line already on the invoice keeps its historical price; only an added product gets the quantity price", () => {
  const source = read("lib/server/sale-admin.ts");
  assert.match(
    source,
    /line\.unitPriceHT != null\s*\? roundMoney\(line\.unitPriceHT\)\s*: original\s*\? original\.unitPriceHT\.toNumber\(\)\s*: resolveQuantityPrice\(/,
  );
  assert.match(source, /await readQuantityPricingEnabled\(tx, sessionUser\.organizationId\)/);
});

test("driver POS and Espace Client are NOT touched: they keep selling / showing the wholesale price", () => {
  for (const file of [
    "lib/server/driver-sales.ts",
    "lib/server/client-portal-core.ts",
    "lib/server/client-catalog.ts",
    "components/driver-pos/driver-pos-view.tsx",
  ]) {
    assert.equal(/quantity-pricing|quantityTiers|quantityPricingEnabled|retailPrice|semiWholesale/.test(read(file)), false, file);
  }
  // the shared POS search never sends tiers to a driver session
  const products = read("lib/server/products.ts");
  assert.equal((products.match(/currentUser\.role !== "driver",/g) ?? []).length, 2);
  assert.match(products, /const quantityTiers = withQuantityTiers\s*\? readCompleteQuantityTiers/);
});

test("the counter POS cart prices with the SAME function, on Q = total quantity of the product in the cart", () => {
  const layout = read("components/pos/pos-layout.tsx");
  assert.match(layout, /const quantityPricingEnabled = context\.quantityPricingEnabled === true;/);
  assert.match(layout, /const quantityByProduct = sumQuantitiesByProduct\(cart\);/);
  assert.match(layout, /quantity: quantityByProduct\.get\(line\.productId\) \?\? line\.quantity,/);
  // a line of the invoice being edited keeps its historical price, a manual price hides the tier label
  assert.match(layout, /const catalogue = frozen\s*\? \{ unitPriceHT: frozen\.unitPriceHT, tier: null \}/);
  assert.match(layout, /quantityPriceTier: priceOverridden \? null : catalogue\.tier,/);
  // only a manual (admin) price is ever sent; the server prices everything else
  assert.equal((layout.match(/\.\.\.\(line\.priceOverridden \? \{ unitPriceHT: line\.unitPriceHT \} : \{\}\),/g) ?? []).length, 2);
  // recomputed whenever the cart or the setting changes
  assert.match(layout, /\}, \[cart, openPendingSale, productById, editLineInfoById, context\.quantityPricingEnabled\]\);/);
});

test("settings: admin only on the server, own organisation only, audited", () => {
  const source = read("lib/server/organization-settings.ts");
  const update = source.slice(source.indexOf("export async function updatePricingSettings"), source.indexOf("export async function getProductColumnSettings"));
  assert.match(update, /requireOrganizationUser\(\["admin"\]\)/);
  assert.match(update, /where: \{ id: user\.organizationId \}/);
  assert.match(update, /typeof enabled !== "boolean"/);
  assert.match(update, /action: enabled \? "QUANTITY_PRICING_ENABLED" : "QUANTITY_PRICING_DISABLED"/);
  assert.match(source, /export async function getPricingSettingsForAdmin[\s\S]*?requireOrganizationUser\(\["admin"\]\)/);
  for (const route of ["app/api/organization/pricing/route.ts", "app/api/organization/product-columns/route.ts"]) {
    assert.match(read(route), /const csrfRejection = rejectUntrustedOrigin\(request\);/, route);
  }
  // the migration turns the setting OFF by default and adds nullable tiers only
  const migration = read("prisma/migrations/20261011100000_add_quantity_pricing/migration.sql");
  assert.match(migration, /"quantityPricingEnabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.equal(/DROP|ALTER COLUMN|UPDATE |DELETE /i.test(migration.replace(/^--.*$/gm, "")), false);
});
