import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { StockMobileList } from "@/components/stock/stock-mobile-list";
import { WarehouseStockTable } from "@/components/stock/warehouse-stock-table";
import type { StockLevelDto } from "@/types/operations-dto";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const level = (
  id: string,
  productName: string,
  quantity: number,
  stockValue: number,
  status: StockLevelDto["status"] = "AVAILABLE",
  locationCode = "DEP-01",
): StockLevelDto => ({
  id,
  productId: `p${id}`,
  productReference: `REF-${id}`,
  productName,
  categoryId: "c",
  categoryName: "Boissons",
  locationId: "l",
  locationCode,
  locationName: locationCode,
  locationType: "DEPOT",
  quantity,
  reservedQuantity: 2,
  availableQuantity: quantity - 2,
  minimumStock: 5,
  salePrice: 10,
  stockValue,
  status,
  updatedAt: "2026-01-01T00:00:00Z",
});

const rows = [
  level("1", "1L بومس", 0, 0, "OUT_OF_STOCK"),
  level("2", "Coca-Cola 1L pack de 6 bouteilles très long nom", 3, 192, "LOW_STOCK"),
  level("3", "Limonade 33cl", 1500, 1875750.5),
];

const strip = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("a card shows the product (bold), its reference, the current stock and the stock value", () => {
  const markup = renderToStaticMarkup(
    <StockMobileList items={[{ id: "1", name: "Eau minérale 5L", reference: "REF-9", quantity: 120, value: 8640 }]} />,
  );
  assert.match(markup, /<p class="[^"]*font-bold[^"]*">Eau minérale 5L<\/p>/);
  assert.match(markup, />REF-9</);
  assert.match(markup, />Stock actuel</);
  assert.match(markup, />Valeur du stock</);
  assert.match(markup, />120</);
  assert.match(strip(markup), /8\.640,00\sDH/, "app currency format");
  assert.match(markup, /rounded-2xl/);
  assert.equal(/<(table|th|td)\b/.test(markup), false, "no table markup on phones");
});

test("long and Arabic names wrap instead of overflowing; the location only shows when asked", () => {
  const markup = renderToStaticMarkup(
    <StockMobileList
      items={[
        { id: "1", name: "عصير البرتقال الطبيعي 2 لتر الحجم العائلي", reference: "REF-1", location: "CAM-01", quantity: 1, value: 1 },
        { id: "2", name: "Sans emplacement", reference: "REF-2", quantity: 1, value: 1 },
      ]}
    />,
  );
  assert.match(markup, /\[overflow-wrap:anywhere\]/);
  assert.match(markup, /\[unicode-bidi:plaintext\]/);
  assert.ok(markup.includes("عصير البرتقال الطبيعي 2 لتر الحجم العائلي"));
  assert.match(markup, /REF-1 · CAM-01/);
  assert.equal(/REF-2 ·/.test(markup), false);
});

test("the stock figure keeps the desktop colours; an action can be attached", () => {
  const markup = renderToStaticMarkup(
    <StockMobileList
      items={[
        { id: "1", name: "A", reference: "R", quantity: 0, value: 0, tone: "danger" },
        { id: "2", name: "B", reference: "R", quantity: 3, value: 1, tone: "warning", action: <button>Ajuster</button> },
        { id: "3", name: "C", reference: "R", quantity: 9, value: 1, tone: "success" },
      ]}
    />,
  );
  assert.match(markup, /text-red-600[^>]*>0</);
  assert.match(markup, /text-amber-600[^>]*>3</);
  assert.equal((markup.match(/<button>Ajuster<\/button>/g) ?? []).length, 1);
});

test("warehouse table: phones get cards with the exact quantity and value of each row, desktop keeps its table", () => {
  const markup = renderToStaticMarkup(<WarehouseStockTable rows={rows} />);
  assert.match(markup, /<div class="lg:hidden"><ul/);
  assert.match(markup, /<div class="max-lg:hidden">/);
  // figures straight from the rows (no recomputation)
  const text = strip(markup);
  for (const [name, qty, value] of [
    ["1L بومس", "0", "0,00"],
    ["Coca-Cola 1L pack de 6 bouteilles très long nom", "3", "192,00"],
    ["Limonade 33cl", "1500", "1.875.750,50"],
  ]) {
    assert.ok(text.includes(name), name);
    assert.ok(text.includes(`${qty}`), qty);
    assert.ok(text.split(String.fromCharCode(160)).join(" ").includes(`${value} DH`), value);
  }
  // the desktop table keeps six columns: Emplacement, Reserve and Disponible were removed on request
  for (const head of ["Produit", "Categorie", "Stock actuel", "Stock minimum", "Valeur", "Statut"]) {
    assert.ok(markup.includes(`>${head}</th>`), head);
  }
  for (const removed of ["Emplacement", "Reserve", "Disponible"]) {
    assert.equal(markup.includes(`>${removed}</th>`), false, `${removed} column removed`);
  }
  assert.equal((markup.match(/<th /g) ?? []).length, 6);
  assert.equal(/<td[^>]*>DEP-01<\/td>/.test(markup), false, "no location cell in the table");
  assert.equal(/DEP-01 ·/.test(markup), false, "no location on the main-stock cards");
  assert.match(renderToStaticMarkup(<WarehouseStockTable rows={rows} showLocation />), /REF-1 · DEP-01/);
});

test("empty state is unchanged", () => {
  const markup = renderToStaticMarkup(<WarehouseStockTable rows={[]} />);
  assert.match(markup, /Aucun produit ne correspond aux filtres de stock\./);
  assert.equal(/lg:hidden/.test(markup), false);
});

test("page wiring: tabs, filters, count and desktop frame are kept; only phone classes were added", () => {
  const view = read("./stock-view.tsx");
  for (const label of ["Stock principal", "Stock camions", "Tous les emplacements"]) assert.ok(view.includes(label), label);
  assert.match(view, /ligne\(s\) en stock principal/);
  assert.match(view, /overflow-hidden rounded-\[22px\] border border-border\/70 bg-white\/82 max-lg:overflow-visible/);
  assert.match(view, /<WarehouseStockTable rows=\{filteredLevels\} showLocation \/>/);
  assert.match(view, /<TabsList className="max-lg:grid max-lg:w-full max-lg:grid-cols-3">/);
  const toolbar = read("./stock-toolbar.tsx");
  assert.match(toolbar, /grid gap-2 sm:flex sm:flex-row sm:items-center sm:gap-3/);
  for (const w of ["sm:w-52", "sm:w-48", "sm:w-56"]) assert.ok(toolbar.includes(w), w);
  const trucks = read("./truck-stock-panel.tsx");
  assert.match(trucks, /<div className="lg:hidden">/);
  assert.match(trucks, /<div className="max-lg:hidden">\s*<Table>/);
  assert.match(trucks, /openAdjustmentDialog\(\{\s*productId: row\.productId/);
});
