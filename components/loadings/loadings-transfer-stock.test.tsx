import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LoadingSupplierSelect } from "./loading-supplier-select";
import { navItems } from "../layout/nav-items";

/**
 * "Transfert de Stock" (ex-Chargements): the supplier selector, the phone-only
 * product-name size and the renamed labels - source level + markup checks.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const view = code("./loadings-view.tsx");

test("supplier selector: one component per breakpoint (POS sheet on phones, POS combobox from lg), « Tous les fournisseurs » first", () => {
  const markup = renderToStaticMarkup(
    React.createElement(LoadingSupplierSelect, {
      suppliers: [{ id: "s1", name: "Sidi Ali" }],
      value: null,
      onChange: () => undefined,
    }),
  );
  assert.match(markup, /Filtrer les produits par fournisseur/);
  assert.match(markup, /Tous les fournisseurs/);
  assert.match(markup, /lg:hidden/, "phone trigger is hidden from lg");
  assert.match(markup, /max-lg:hidden/, "desktop combobox is hidden below lg");
  const select = code("./loading-supplier-select.tsx");
  assert.match(select, /from "@\/components\/pos\/mobile-supplier-picker"/);
  assert.match(select, /from "@\/components\/pos\/supplier-filter"/);
});

test("supplier filter only affects what is rendered or suggested - never the saved lines", () => {
  // every payload built from the sheet still uses the whole draftLines
  assert.equal((view.match(/lines: draftLines\.map\(/g) ?? []).length, 3, "draft save, close and the other persisted payload");
  assert.equal((view.match(/visibleDraftLines/g) ?? []).length, 3, "declared once, checked for emptiness once, mapped once");
  assert.match(view, /visibleDraftLines\.map\(\(line\) => \(/);
  assert.equal(/lines: visibleDraftLines/.test(view), false);
  // updating / removing a line is still by productId on draftLines
  assert.match(view, /function updateDraftLine\(/);
  assert.match(view, /current\.filter\(\s+\(currentLine\) => currentLine\.productId !== line\.productId/);
  // suggestions: server search scoped to the supplier + strict client check
  assert.match(view, /useProductPickerSearch\(\s+products,\s+deferredProductSearch,\s+supplierFilter \? \{ supplierId: supplierFilter\.id \} : undefined/);
  assert.match(view, /\.filter\(\(product\) => productMatchesSupplier\(product, supplierFilter\)\)/);
});

test("the line DTO carries the product's supplier (read only) and the server selects it without touching quantities", () => {
  const server = read("../../lib/server/truck-loadings.ts");
  assert.match(server, /defaultSupplier: \{ select: \{ id: true, name: true \} \}/);
  assert.match(server, /supplierId: line\.product\.defaultSupplier\?\.id \?\? null,\s+supplierName: line\.product\.defaultSupplier\?\.name \?\? null,/);
  const page = code("../../app/(dashboard)/chargements/page.tsx");
  assert.match(page, /getSuppliers\(\)/);
  assert.match(page, /suppliers=\{suppliers\}/);
});

test("phones only: product names are 30 % bigger (13px -> 16.9px) under max-lg, PC untouched, other texts and numeric fields unchanged", () => {
  assert.match(view, /<div className="font-medium max-lg:text-\[16\.9px\] max-lg:leading-tight max-lg:break-words">/);
  assert.equal(/font-medium max-lg:text-\[13px\]/.test(view), false, "the old 13px name size is gone (the bottom action buttons keep their own 13px)");
  assert.equal(/(^|[\s"'`])lg:text-\[16\.9px\]/.test(view), false, "no lg+ rule enlarges the names");
  // reference line, numeric inputs and headers keep their size
  assert.match(view, /max-lg:mt-0\.5 max-lg:text-\[10px\] max-lg:leading-tight max-lg:break-words/);
  assert.match(view, /const MOBILE_INPUT = "max-lg:h-9 max-lg:rounded-xl max-lg:px-1 max-lg:text-center max-lg:text-sm";/);
  assert.match(view, /max-lg:text-\[0\.58rem\]/);
  // room: the name column is wider and the three quantity columns share the rest (34 + 3 x 22 = 100)
  assert.match(view, /max-lg:w-\[34%\] max-lg:px-2/);
  assert.equal((view.match(/max-lg:w-\[22%\] max-lg:text-center/g) ?? []).length, 3);
  assert.equal(/max-lg:w-\[23%\]/.test(view), false);
});

test("rename: the visible labels say « Transfert(s) de Stock »; routes, API paths and stored movement texts are unchanged", () => {
  const stock = navItems.flatMap((item) => item.children ?? []).find((child) => child.href === "/chargements");
  assert.equal(stock?.label, "Transferts de Stock");
  assert.match(view, /text-foreground">Transferts de Stock<\/h1>/);
  assert.match(view, /<TabsTrigger value="loading">Transfert de Stock<\/TabsTrigger>/);
  assert.match(view, /Historique des transferts de stock/);
  assert.match(view, /Nouvelle fiche de transfert de stock/);
  assert.match(code("../../app/(dashboard)/chargements/page.tsx"), /title: "Transferts de Stock"/);
  // the only « chargement » left in the view: the loading indicator and the route
  const leftovers = view.match(/[^\n]*chargement[^\n]*/gi) ?? [];
  assert.deepEqual(
    leftovers.map((line) => line.trim()),
    ['<p className="text-sm text-muted-foreground">Chargement en cours...</p>', "render={<Link href={`/chargements/${loading.id}`} />}"],
  );
  const server = read("../../lib/server/truck-loadings.ts");
  const serverCode = code("../../lib/server/truck-loadings.ts");
  assert.match(server, /reason: "Cloture chargement - ajustement stock reel"/, "stored movement reason untouched");
  assert.match(server, /"Chargement brouillon applique"/, "stored movement note untouched");
  assert.equal(/"[^"\n]*[Cc]hargement[^"\n]*"/.test(serverCode.replace(/"Cloture chargement - ajustement stock reel"|"Chargement brouillon applique"|"Correction de chargement brouillon"/g, "")), false);
  // no model / route / api path renamed
  assert.match(read("../../components/loadings/loading-detail-view.tsx"), /href="\/chargements"/);
});
