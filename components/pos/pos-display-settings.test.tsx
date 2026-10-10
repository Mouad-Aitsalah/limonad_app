import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PosCatalogScroller } from "./pos-catalog-display";
import { PosDisplaySettingsPanel } from "./pos-display-settings-panel";
import { ProductCard } from "./product-card";
import { ProductGrid } from "./product-grid";
import { POS_DISPLAY_LIMITS } from "@/lib/pos-display-settings";
import type { PosProduct } from "@/types/pos";

/**
 * "Personnaliser l'affichage" of the counter POS catalogue: the panel, the
 * grid / card in custom mode, and the guarantees that only the catalogue is
 * affected (the driver POS and the rest of the counter POS are untouched).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const product = (over: Partial<PosProduct> = {}): PosProduct => ({
  id: "p1",
  reference: "COCA-1L",
  barcode: null,
  designation: "Coca-Cola 1L",
  prixVenteHT: 10,
  prixVenteTTC: 12,
  tauxTVA: 20,
  quantiteStock: 5,
  imageUrl: null,
  ...over,
});
const PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
const noop = () => undefined;
const html = (element: React.ReactElement) => renderToStaticMarkup(element);

test("panel: closed it is only a labelled button; open it shows the four continuous sliders with the specified limits and defaults", () => {
  const closed = html(<PosDisplaySettingsPanel scope={null} />);
  assert.match(closed, /aria-label="Personnaliser l&#x27;affichage"/);
  assert.equal(closed.includes('type="range"'), false);

  const open = html(<PosDisplaySettingsPanel scope={{ organizationId: "org-1", userId: "u-1" }} defaultOpen />);
  const ranges = [...open.matchAll(/<input[^>]*type="range"[^>]*>/g)].map((match) => match[0]);
  assert.equal(ranges.length, 4);
  const expected: Array<[string, number, number, number]> = [
    ["Taille du nom du produit", 10, 28, 16],
    ["Largeur minimale de la carte", 110, 280, 150],
    ["Hauteur de l&#x27;image", 40, 180, 100],
    ["Espacement entre les cartes", 0, 24, 8],
  ];
  expected.forEach(([label, min, max, value], index) => {
    const range = ranges[index];
    assert.match(range, new RegExp(`min="${min}"`), label);
    assert.match(range, new RegExp(`max="${max}"`), label);
    assert.match(range, new RegExp(`value="${value}"`), label);
    assert.match(range, /step="1"/, "one px steps: a continuous slider, not presets");
    assert.match(range, new RegExp(`aria-valuetext="${value} pixels"`));
    const id = /id="([^"]+)"/.exec(range)?.[1] ?? "";
    assert.ok(open.includes(`for="${id}"`) && open.includes(label), `${label} is a real label of its slider`);
    assert.ok(open.includes(`>${value} px</output>`) || open.includes(`${value} px`), `${label} shows ${value} px`);
  });
  // the limits come from the single source of truth
  assert.deepEqual([POS_DISPLAY_LIMITS.nameSize.min, POS_DISPLAY_LIMITS.nameSize.max], [10, 28]);
});

test("panel: photos switch, reset and close buttons, and the honest storage note", () => {
  const signedIn = html(<PosDisplaySettingsPanel scope={{ organizationId: "org-1", userId: "u-1" }} defaultOpen />);
  assert.match(signedIn, /Afficher les photos des produits/);
  assert.match(signedIn, /role="switch"/);
  assert.match(signedIn, /aria-checked="true"/);
  assert.match(signedIn, /Réinitialiser/);
  assert.match(signedIn, /disabled=""[^>]*>[^<]*<svg[\s\S]*?Réinitialiser/, "nothing to reset at the defaults");
  assert.match(signedIn, /aria-label="Fermer le panneau"/);
  assert.match(signedIn, />Fermer</);
  assert.match(signedIn, /enregistrés sur ce navigateur pour votre compte/);
  assert.match(signedIn, /pas synchronisés entre vos appareils/);
  assert.match(signedIn, /role="dialog"/);
  const anonymous = html(<PosDisplaySettingsPanel scope={null} defaultOpen />);
  assert.match(anonymous, /pas enregistrés tant que vous n&#x27;êtes pas identifié/);
});

test("grid, custom display: cards fill the available width from the minimum width variable, with the gap variable, never wider than the container", () => {
  const custom = html(<ProductGrid products={[product()]} onAdd={noop} display={{ showPhotos: true }} />);
  assert.match(custom, /grid-template-columns:repeat\(auto-fill, ?minmax\(min\(var\(--pos-card-min, 150px\), 100%\), 1fr\)\)/);
  assert.match(custom, /gap:var\(--pos-gap, 8px\)/);
  assert.equal(/grid-cols-[23]/.test(custom), false, "no fixed column count");
  assert.match(custom, /class="grid min-w-0 items-start lg:items-stretch"/);
});

test("grid without the option (driver POS): exactly the previous layout", () => {
  const legacy = html(<ProductGrid products={[product()]} onAdd={noop} />);
  assert.match(legacy, /class="grid grid-cols-3 items-start gap-1\.5 lg:grid-cols-2 lg:items-stretch lg:gap-3 xl:grid-cols-3 2xl:grid-cols-4"/);
  assert.equal(legacy.includes("--pos-"), false);
  assert.match(legacy, /aspect-\[30\/23\]/);
  assert.equal(legacy.includes("var(--pos-"), false);
});

test("card, custom display: ONLY the product name follows the size variable; photo height follows its variable", () => {
  const card = html(<ProductCard product={product({ imageUrl: PHOTO })} onAdd={noop} display={{ showPhotos: true }} />);
  assert.match(card, /font-size:var\(--pos-name-size, 16px\)/);
  assert.match(card, /line-height:1\.3/);
  assert.match(card, /min-height:2\.6em/);
  assert.match(card, /overflow-wrap:anywhere/);
  assert.match(card, /height:var\(--pos-img-h, 100px\)/);
  assert.match(card, /Photo du produit Coca-Cola 1L/);
  // price, stock label and the Ajouter pill keep their own classes and sizes
  assert.match(card, /text-\[12px\] font-semibold text-emerald-700/);
  assert.match(card, /text-\[10px\] leading-tight max-lg:text-\[9px\]/);
  assert.match(card, /text-\[9px\] font-medium uppercase tracking-\[0\.06em\] text-emerald-700/);
  assert.equal((card.match(/--pos-name-size/g) ?? []).length, 1, "the name size variable is read by the name only");
  // long names: two lines, wrapping anywhere, no overflow
  assert.match(card, /line-clamp-2/);
});

test("card, photos hidden: no photo at all, the card keeps name, price, stock and the add button", () => {
  const card = html(<ProductCard product={product({ imageUrl: PHOTO })} onAdd={noop} display={{ showPhotos: false }} />);
  assert.equal(card.includes("Photo du produit"), false);
  assert.equal(card.includes("<img"), false);
  assert.equal(card.includes("--pos-img-h"), false);
  assert.match(card, /Coca-Cola 1L/);
  assert.match(card, /Ajouter/);
  assert.match(card, /5 en stock|stock/i);
  // a negative stock badge must not sit on top of the name when there is no photo
  const negative = html(<ProductCard product={product({ quantiteStock: -3 })} onAdd={noop} display={{ showPhotos: false }} />);
  assert.match(negative, /max-lg:pr-10/);
  assert.match(negative, /Stock négatif|Négatif/);
});

test("card without the option (driver POS): the previous card, byte for byte in its sizing", () => {
  const legacy = html(<ProductCard product={product()} onAdd={noop} />);
  assert.equal(legacy.includes("--pos-"), false);
  assert.equal(legacy.includes("style="), false);
  assert.match(legacy, /text-\[21\.84px\]/);
  assert.match(legacy, /max-lg:text-\[13px\]/);
  assert.match(legacy, /max-lg:h-\[78px\] max-lg:w-\[68px\]/);
});

test("the CSS variables are set on the catalogue wrapper only (defaults on the first render)", () => {
  const wrapper = html(
    <PosCatalogScroller className="catalogue">
      <span>x</span>
    </PosCatalogScroller>,
  );
  assert.match(wrapper, /class="catalogue"/);
  assert.match(wrapper, /--pos-name-size:16px/);
  assert.match(wrapper, /--pos-card-min:150px/);
  assert.match(wrapper, /--pos-img-h:100px/);
  assert.match(wrapper, /--pos-gap:8px/);
  // nowhere else in the app are the variables defined
  for (const path of [
    "./pos-layout.tsx",
    "./cart-table.tsx",
    "./cart-summary.tsx",
    "./checkout-dialog.tsx",
    "./product-search.tsx",
    "../driver-pos/driver-pos-view.tsx",
  ]) {
    assert.equal(read(path).includes("--pos-"), false, path);
  }
});

test("wiring: the panel sits next to the search, the catalogue keeps its phone tile rule, the driver POS is untouched", () => {
  const layout = code("./pos-layout.tsx");
  assert.match(layout, /<ProductSearch value=\{search\} onChange=\{setSearch\} inputRef=\{searchInputRef\} \/>[\s\S]*?<PosDisplaySettingsPanel scope=\{offline\.scope\} \/>/);
  assert.match(layout, /<PosCatalogScroller className=\{`lg:flex-1 lg:overflow-y-auto lg:pr-1 \$\{PHONE_PRODUCT_TILE_NAME_CLASS\}`\}>/);
  assert.match(layout, /<PosProductGrid\s+products=\{filteredProducts\}/);
  assert.equal(/<ProductGrid/.test(layout), false, "the counter POS only uses the custom-display grid");
  // sorting, search, supplier filter and scanner code paths are the very same expressions as before
  assert.match(layout, /usePosProductSearch\(\s+context\.products,\s+search,/);
  assert.match(layout, /rankBySales: true,/);
  assert.match(layout, /matchedProducts\.filter\(\(product\) => product\.supplierId === supplierFilter\.id\)/);

  const driver = code("../driver-pos/driver-pos-view.tsx");
  assert.match(driver, /<ProductGrid\s+products=\{productTiles\}\s+onAdd=\{addProductById\}\s+onAdded=\{handleMobileProductAdded\}\s+\/>/);
  assert.equal(/pos-display|pos-catalog-display|PosDisplaySettings/.test(driver), false);

  // the store is a visual-only module: no API, no sale, no stock
  const store = code("../../lib/pos-display-settings.ts") + code("./use-pos-display-settings.ts") + code("./pos-display-settings-panel.tsx");
  assert.equal(/fetch\(|\/api\/|prisma|createOfflineSale|stock/i.test(store), false);
  assert.match(code("./use-pos-display-settings.ts"), /window\.localStorage/);
});
