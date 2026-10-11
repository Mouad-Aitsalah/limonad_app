import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ProductsTable } from "@/components/produits/products-table";
import { withProductColumnVisibility, DEFAULT_PRODUCT_COLUMN_SETTINGS, type ProductColumnSettings } from "@/lib/product-columns";
import { computePriceTTC } from "@/lib/product-pricing";
import { formatCurrency } from "@/lib/utils";
import type { ProductDto } from "@/types/product-dto";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const noop = () => {};
const plain = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").split(String.fromCharCode(160)).join(" ").replace(/\s+/g, " ");
const money = (value: number) => formatCurrency(value).split(String.fromCharCode(160)).join(" ");

const product: ProductDto = {
  id: "p1",
  reference: "EAU-5L",
  name: "Eau minérale 5L",
  purchasePrice: 2.5,
  salePrice: 3.33,
  retailPrice: 4.17,
  semiWholesalePrice: 3.75,
  semiWholesaleMinQty: 6,
  wholesaleMinQty: 24,
  stockQuantity: -3,
  taxRate: 20,
  unit: "pack",
  minimumStock: 5,
  status: "ACTIVE",
  category: { id: "c", name: "Eaux" },
  supplier: { id: "s", name: "Sidi Ali" },
  createdAt: "",
  updatedAt: "",
};

function render(settings?: ProductColumnSettings, products = [product]) {
  return renderToStaticMarkup(
    <ProductsTable products={products} onView={noop} onEdit={noop} onToggleStatus={noop} columnSettings={settings} />,
  );
}
const headersOf = (markup: string) =>
  [...markup.matchAll(/<th[^>]*data-column="([^"]+)"/g)].map((match) => match[1]);

test("default (no organisation choice): the same columns as before, the new ones hidden", () => {
  assert.deepEqual(headersOf(render()), [
    "photo",
    "reference",
    "designation",
    "category",
    "supplier",
    "purchasePriceTTC",
    "salePriceTTC",
    "taxRate",
    "minimumStock",
    "status",
  ]);
  assert.deepEqual(headersOf(render(DEFAULT_PRODUCT_COLUMN_SETTINGS)), headersOf(render()));
});

test("every new column shows its value (tier prices in TTC, thresholds, unit, stock in red when negative)", () => {
  let settings = DEFAULT_PRODUCT_COLUMN_SETTINGS;
  for (const key of ["retailPriceTTC", "semiWholesalePriceTTC", "semiWholesaleMinQty", "wholesaleMinQty", "unit", "stockQuantity"] as const) {
    settings = withProductColumnVisibility(settings, key, true);
  }
  const markup = render(settings);
  const text = plain(markup);
  for (const header of ["Prix détail TTC", "Prix semi-gros TTC", "Qped", "Qgros", "Unité", "Qté en stock"]) {
    assert.ok(text.includes(header), header);
  }
  assert.ok(text.includes(money(computePriceTTC(4.17, 20))), "prix détail TTC");
  assert.ok(text.includes(money(computePriceTTC(3.75, 20))), "prix semi-gros TTC");
  assert.ok(text.includes(money(computePriceTTC(3.33, 20))), "prix gros TTC");
  assert.ok(text.includes(" 6 24 pack "), "Qped, Qgros, unit");
  assert.ok(text.includes("pack"));
  assert.match(markup, /class="[^"]*text-red-600[^"]*">-3</);
  // a product without tiers shows "-" (never 0)
  const bare = render(settings, [{ ...product, retailPrice: null, semiWholesalePrice: null, semiWholesaleMinQty: null, wholesaleMinQty: null }]);
  assert.equal(plain(bare).split(" ").filter((token) => token === "-").length, 4);
});

test("hiding columns removes header AND cells; the designation and the actions always stay", () => {
  let settings = DEFAULT_PRODUCT_COLUMN_SETTINGS;
  for (const key of ["photo", "reference", "category", "supplier", "purchasePriceTTC", "salePriceTTC", "taxRate", "minimumStock", "status", "designation"] as const) {
    settings = withProductColumnVisibility(settings, key, false);
  }
  // the desktop table only (the phone cards above it are not configurable and keep their content)
  const markup = render(settings).slice(render(settings).indexOf("<table"));
  assert.deepEqual(headersOf(markup), ["designation"]);
  assert.equal((markup.match(/<td/g) ?? []).length, 2, "designation + actions");
  assert.ok(plain(markup).includes("Eau minérale 5L"));
  assert.ok(markup.includes("Modifier le produit"));
  assert.equal(plain(markup).includes("EAU-5L"), false);
});

test("the panel is admin-only and saves for the organisation; the page reads the organisation's choice", () => {
  const view = read("./products-view.tsx");
  assert.match(view, /\{canEditColumns \? \(/);
  assert.match(view, /columnSettings=\{columnSettings\}/);
  const page = read("../../app/(dashboard)/produits/page.tsx");
  assert.match(page, /getProductColumnSettings\(\)/);
  assert.match(page, /canEditColumns=\{columns\.canEdit\}/);
  const panel = read("./product-columns-panel.tsx");
  assert.match(panel, /fetch\("\/api\/organization\/product-columns", \{\s*method: "PUT"/);
  // a refused save puts the previous choice back
  assert.match(panel, /onSettingsChange\(previous\)/);
  const server = read("../../lib/server/organization-settings.ts");
  assert.match(server, /export async function updateProductColumnSettings[\s\S]*?requireOrganizationUser\(\["admin"\]\)/);
  assert.match(server, /canEdit: user\.role === "admin"/);
});
