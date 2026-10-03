import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ProductsMobileList } from "@/components/produits/products-mobile-list";
import { ProductsTable } from "@/components/produits/products-table";
import { computePriceTTC } from "@/lib/product-pricing";
import { formatCurrency } from "@/lib/utils";
import type { ProductDto } from "@/types/product-dto";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const noop = () => {};
const plain = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").split(String.fromCharCode(160)).join(" ").replace(/\s+/g, " ");
const money = (value: number) => formatCurrency(value).split(String.fromCharCode(160)).join(" ");

const product = (over: Partial<ProductDto> = {}): ProductDto => ({
  id: "p1",
  reference: "REF-0001",
  barcode: "6001",
  name: "Eau minérale 5L",
  purchasePrice: 50,
  salePrice: 60,
  taxRate: 20,
  unit: "u",
  minimumStock: 5,
  status: "ACTIVE",
  category: { id: "c", name: "Boissons" },
  createdAt: "",
  updatedAt: "",
  ...over,
});

const products = [
  product(),
  product({ id: "p2", reference: "COCA-1L-PACK6-VERY-LONG-REFERENCE-2026-0002", name: "عصير البرتقال الطبيعي 2 لتر الحجم العائلي", purchasePrice: 833.33, salePrice: 1041.25, status: "INACTIVE" }),
];

function list() {
  return renderToStaticMarkup(<ProductsMobileList products={products} onView={noop} onEdit={noop} onToggleStatus={noop} />);
}

test("a card shows the reference (bold), the designation and both prices with labels", () => {
  const markup = list();
  assert.match(markup, /<p class="[^"]*font-bold[^"]*">REF-0001<\/p>/);
  const text = plain(markup);
  assert.ok(text.includes("Eau minérale 5L"));
  assert.ok(text.includes("Prix d'achat") || text.includes("Prix d&#x27;achat") || /Prix d.achat/.test(text));
  assert.ok(text.includes("Prix de vente"));
  assert.equal((markup.match(/<li /g) ?? []).length, 2);
  assert.equal(/<(table|th|td)\b/.test(markup), false);
});

test("prices are exactly the ones of the desktop table (same TTC computation, same currency format)", () => {
  const text = plain(list());
  for (const p of products) {
    assert.ok(text.includes(money(computePriceTTC(p.purchasePrice, p.taxRate))), `achat ${p.reference}`);
    assert.ok(text.includes(money(computePriceTTC(p.salePrice, p.taxRate))), `vente ${p.reference}`);
  }
  const table = plain(renderToStaticMarkup(<ProductsTable products={products} onView={noop} onEdit={noop} onToggleStatus={noop} />));
  assert.ok(table.includes(money(computePriceTTC(50, 20))) && table.includes(money(computePriceTTC(60, 20))));
});

test("long references and Arabic designations wrap instead of overflowing", () => {
  const markup = list();
  assert.ok(markup.includes("COCA-1L-PACK6-VERY-LONG-REFERENCE-2026-0002"));
  assert.ok(markup.includes("عصير البرتقال الطبيعي 2 لتر الحجم العائلي"));
  assert.match(markup, /\[overflow-wrap:anywhere\]/);
  assert.match(markup, /\[unicode-bidi:plaintext\]/);
});

test("the three row actions stay on every card; an inactive product is flagged and can be re-activated", () => {
  const markup = list();
  assert.equal((markup.match(/aria-label="Consulter le produit"/g) ?? []).length, 2);
  assert.equal((markup.match(/aria-label="Modifier le produit"/g) ?? []).length, 2);
  assert.equal((markup.match(/aria-label="Desactiver le produit"/g) ?? []).length, 1, "active product");
  assert.equal((markup.match(/aria-label="Activer le produit"/g) ?? []).length, 1, "inactive product");
  assert.equal((markup.match(/Inactif/g) ?? []).length, 1);
});

test("the table keeps its 11 columns for desktop and is hidden below lg; the cards are hidden from lg", () => {
  const markup = renderToStaticMarkup(<ProductsTable products={products} onView={noop} onEdit={noop} onToggleStatus={noop} />);
  assert.match(markup, /<div class="lg:hidden"><ul/);
  assert.match(markup, /<div class="max-lg:hidden">/);
  for (const head of ["Photo", "Reference", "Designation", "Categorie", "Fournisseur", "Prix achat TTC", "Prix vente TTC", "TVA", "Stock min.", "Statut", "Actions"]) {
    assert.ok(markup.includes(`>${head}</th>`), head);
  }
  const empty = renderToStaticMarkup(<ProductsTable products={[]} onView={noop} onEdit={noop} onToggleStatus={noop} />);
  assert.match(empty, /Aucun produit ne correspond a ces criteres\./);
  assert.equal(/lg:hidden/.test(empty), false);
});

test("page wiring: search, filters, pagination and counters are kept; only phone classes were added", () => {
  const view = read("./products-view.tsx");
  assert.match(view, /frameless="below-lg"/);
  assert.match(view, /countLabel=\{`Page \$\{pageIndex \+ 1\} · \$\{products\.length\} sur cette page · \$\{totalCount\} au total`\}/);
  for (const kept of ["Precedent", "Suivant", "goToNextPage", "goToPreviousPage", "onView={setViewingProduct}", "onEdit={setEditingProduct}", "onToggleStatus={toggleStatus}"]) {
    assert.ok(view.includes(kept), kept);
  }
  assert.match(view, /grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end/);
  const toolbar = read("./products-toolbar.tsx");
  assert.match(toolbar, /flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3/);
  assert.equal((toolbar.match(/max-lg:data-\[size=default\]:h-10/g) ?? []).length, 2);
  for (const kept of ["Rechercher une référence, un code-barres, une désignation...", "sm:w-48", "sm:w-44", "Toutes les catégories"]) {
    assert.ok(toolbar.includes(kept), kept);
  }
});

test("DataTableShell keeps its frame everywhere except for the opt-in", () => {
  const shell = read("../ui/data-table-shell.tsx");
  assert.match(shell, /frameless === "below-lg"/);
  for (const other of ["../stock/stock-view.tsx", "../ventes/sales-view.tsx"]) {
    assert.equal(/frameless=/.test(read(other)), false, other);
  }
});
