import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { canEditPosLinePrice, POS_LINE_PRICE_ROLES } from "@/lib/pos-price-permissions";
import type { UserRole } from "@/types/auth";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("who may type a price on a POS line", () => {
  it("the driver, the cashier and the admin may - nobody else", () => {
    for (const role of ["driver", "cashier", "admin"] as const) assert.equal(canEditPosLinePrice(role), true, role);
    for (const role of ["depot_manager", "super_admin"] as const) assert.equal(canEditPosLinePrice(role), false, role);
    for (const role of [null, undefined, "", "client", "manager"]) {
      assert.equal(canEditPosLinePrice(role as UserRole | null | undefined), false, String(role));
    }
    assert.deepEqual([...POS_LINE_PRICE_ROLES].sort(), ["admin", "cashier", "driver"]);
  });
});

describe("server: the price is enforced by the role, not by the screen", () => {
  const counter = code("lib/server/counter-sales.ts");
  const create = counter.slice(counter.indexOf("export async function createCounterSale"));
  const driver = code("lib/server/driver-sales.ts");

  it("counter sale: a custom price is honoured for the admin and the cashier only, the depot manager sells at the catalogue price", () => {
    assert.match(create, /const canOverrideLinePrice = sessionUser\.role === "admin" \|\| sessionUser\.role === "cashier";/);
    assert.match(create, /canOverrideLinePrice && line\.unitPriceHT != null\s*\? roundMoney\(line\.unitPriceHT\)\s*: resolveQuantityPrice\(/);
    // the role comes from the session, never from the request
    assert.equal(/line\.role|parsed\.data\.role|input\.role/.test(create), false);
  });

  it("counter sale schema: 0 DH is a valid price, a negative or non-numeric one is refused, the amount is bounded", () => {
    assert.match(counter, /unitPriceHT: z\.coerce\.number\(\)\.min\(0\)\.max\(MONEY_RANGE_MAX_NUMBER\)\.optional\(\),/);
    assert.equal(/unitPriceHT: z\.coerce\.number\(\)\.positive\(\)/.test(counter), false);
    assert.match(code("lib/counter-sale-sync-contract.ts"), /unitPriceHT: z\.coerce\.number\(\)\.min\(0\)\.max\(MONEY_RANGE_MAX_NUMBER\)\.optional\(\)/);
    assert.match(code("lib/server/sale-admin.ts"), /unitPriceHT: z\.coerce\.number\(\)\.min\(0\)\.max\(MONEY_RANGE_MAX_NUMBER\)\.optional\(\)/);
    // the amount is still range-checked after the price is chosen
    assert.match(create, /assertMoneyRange\(unitPriceHT, "line\.unitPriceHT"\);/);
  });

  it("invoice revision stays admin only", () => {
    const admin = code("lib/server/sale-admin.ts");
    assert.match(admin.slice(admin.indexOf("export async function reviseSale")), /requireOrganizationUser\(\["admin", "super_admin"\]\)/);
  });

  it("driver sale: reachable by drivers only, the custom price is a strict number (null / '' never become 0), bounded", () => {
    const create = driver.slice(driver.indexOf("export async function createDriverSale"));
    assert.match(create, /requireOrganizationUser\(\["driver"\]\)/);
    assert.match(driver, /customUnitPriceTTC: z\.number\(\)\.finite\(\)\.min\(0\)\.max\(MONEY_RANGE_MAX_NUMBER\)\.optional\(\),/);
    assert.equal(/customUnitPriceTTC: z\.coerce/.test(driver), false, "no coercion: JSON null must not become a silent 0 DH");
    // priced from the typed TTC price, then range-checked like any other line
    assert.match(driver, /priceFromCustomTTC\(line\.customUnitPriceTTC, taxRate\)/);
    assert.match(create, /assertMoneyRange\(unitPriceHT, "line\.unitPriceHT"\);/);
    assert.match(create, /assertMoneyRange\(totalTTC, "line\.totalTTC"\);/);
  });

  it("offline sync: the signed catalogue price is still verified, the custom price travels apart and is re-validated", () => {
    const sync = driver.slice(driver.indexOf("const offlineSaleSyncSchema"));
    assert.match(sync, /unitPriceTTC: z\.coerce\.number\(\)\.finite\(\)\.min\(0\),\s*priceToken: z\.string\(\)\.trim\(\)\.min\(1\)\.nullable\(\)\.optional\(\),/);
    assert.match(sync, /customUnitPriceTTC: z\.number\(\)\.finite\(\)\.min\(0\)\.max\(MONEY_RANGE_MAX_NUMBER\)\.optional\(\),/);
    assert.match(sync, /roundMoney\(tokenPayload\.unitPriceTTC\) === roundMoney\(line\.unitPriceTTC\)/);
    assert.match(sync, /\.\.\.\(line\.customUnitPriceTTC !== undefined \? \{ customUnitPriceTTC: line\.customUnitPriceTTC \} : \{\}\),/);
  });

  it("the product's catalogue price and purchase price are never written by a sale", () => {
    for (const file of ["lib/server/counter-sales.ts", "lib/server/driver-sales.ts", "lib/server/sales-shared.ts", "lib/server/sale-admin.ts"]) {
      assert.equal(/\.product\.(update|updateMany|upsert)\(/.test(code(file)), false, file);
    }
  });

  it("the cost is frozen on the line from the product, whatever price was typed (margin = typed price - cost)", () => {
    assert.match(create, /const unitCostHT = product\.purchasePrice\.toNumber\(\);/);
    assert.match(driver, /const unitCostHT = product\.purchasePrice\.toNumber\(\);/);
  });
});

describe("the purchase price reaches the POS of the roles that can type a price, and only those", () => {
  it("counter POS context: admin and cashier", () => {
    const counter = code("lib/server/counter-sales.ts");
    assert.match(counter, /purchasePrice: sessionUser\.role === "admin" \|\| sessionUser\.role === "cashier",/);
    assert.match(counter, /\(sessionUser\.role === "admin" \|\| sessionUser\.role === "cashier"\) &&\s*"purchasePrice" in product/);
  });

  it("POS product search / by ids: the roles of canEditPosLinePrice (admin, cashier, driver), never the depot manager", () => {
    const products = code("lib/server/products.ts");
    assert.equal((products.match(/canEditPosLinePrice\(currentUser\.role\),/g) ?? []).length, 2);
    assert.match(products, /purchasePrice: withPurchasePrice,/);
    assert.match(products, /\.\.\.\(withPurchasePrice && product\.purchasePrice/);
  });

  it("driver POS context carries the cost; the offline mirror of the COUNTER POS never stores it", () => {
    assert.match(code("lib/server/driver-sales.ts"), /purchasePriceHT: product\.purchasePrice\.toNumber\(\),/);
    // sync-schemas only reads the selling fields: the cost is dropped before anything is stored on the device
    const schemas = code("lib/offline/counter-pos/sync-schemas.ts");
    const contextProduct = schemas.slice(schemas.indexOf("const contextProductSchema"), schemas.indexOf("export const customerSchema"));
    assert.equal(/purchasePrice/i.test(contextProduct), false);
  });
});

describe("screens", () => {
  it("counter POS: price field for admin and cashier; driver POS: price field for the driver", () => {
    assert.match(code("components/pos/pos-layout.tsx"), /const canEditLinePrice = currentUser\?\.role === "admin" \|\| currentUser\?\.role === "cashier";/);
    assert.match(code("components/driver-pos/driver-pos-view.tsx"), /canEditPrice\s+onPriceChange=\{updatePrice\}/);
  });

  it("an empty / zero price never falls back to the catalogue price (no `||` / `??` on the typed value)", () => {
    const layout = code("components/pos/pos-layout.tsx");
    const update = layout.slice(layout.indexOf("function updatePrice"), layout.indexOf("function removeFromCart"));
    // the only `||` is the guard that ignores NaN / negative values - never a fallback to a reference price
    assert.equal(/unitPriceTTC\s*(\|\||\?\?)\s*[^<]/.test(update), false);
    assert.equal(/catalogue|original/i.test(update.replace(/independent of the catalogue/g, "")), false);
    assert.equal(/priceOverrideHT: undefined/.test(update), false, "the override is no longer cleared by an empty field");
    assert.match(update, /priceOverrideHT: roundCurrency\(unitPriceTTC \/ \(1 \+ taxRate \/ 100\)\)/);
    const driver = code("components/driver-pos/driver-pos-view.tsx");
    const driverUpdate = driver.slice(driver.indexOf("function updatePrice"), driver.indexOf("const cartTotalsForSummary"));
    assert.equal(/unitPriceTTC\s*(\|\||\?\?)\s*[^<]/.test(driverUpdate), false);
    assert.equal(/salePriceTTC/.test(driverUpdate), false, "never the catalogue price");
    assert.match(driverUpdate, /customUnitPriceTTC: round\(unitPriceTTC\)/);
    // the applied price is chosen with `=== undefined`, so 0 stays 0
    assert.match(driver, /if \(line\.customUnitPriceTTC === undefined\) \{/);
    const field = code("components/pos/price-input.tsx");
    assert.equal(/\|\|/.test(field), false);
  });

  it("a sale whose whole total is 0 DH is refused by the server and never saved offline (it could not synchronise)", () => {
    for (const file of ["lib/server/counter-sales.ts", "lib/server/driver-sales.ts", "lib/server/sale-admin.ts"]) {
      assert.match(code(file), /assertMoneyRange\(totalTTC, "totalTTC"\);\s*assertSaleHasAmount\(totalTTC\);/, file);
    }
    assert.match(code("lib/server/sales-shared.ts"), /export function assertSaleHasAmount\(totalTTC: number\) \{\s*if \(!\(totalTTC > 0\)\) \{/);
    assert.match(code("components/pos/pos-layout.tsx"), /if \(!\(built\.input\.totals\.totalTTC > 0\)\) \{\s*toast\.error\(ZERO_TOTAL_SALE_MESSAGE\);\s*return false;/);
    assert.match(code("components/driver-pos/driver-pos-view.tsx"), /if \(!\(totals\.ttc > 0\)\) \{\s*toast\.error\(ZERO_TOTAL_SALE_MESSAGE\);\s*return;/);
  });

  it("the driver cart sends the typed price with the line (lines: cart), the offline sale keeps the signed catalogue price apart", () => {
    const driver = code("components/driver-pos/driver-pos-view.tsx");
    assert.match(driver, /lines: cart,/);
    assert.match(driver, /unitPriceSnapshot: row\.product\.salePriceTTC,/);
    assert.match(driver, /customUnitPriceTTC: appliedPrice\(row\.product, row\)\.unitPriceTTC/);
  });
});
