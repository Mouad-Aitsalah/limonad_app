import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { usePosProductSearch } from "@/components/pos/use-pos-product-search";
import type { DriverPosProductDto } from "@/types/operations-dto";

import { AI_DRAFT_REPLACE_MESSAGE } from "./ai-draft-replace-dialog";

/**
 * POS side of the AI-prepared cart: no second cart, a product beyond the 500
 * preloaded ones always resolvable, an existing cart never overwritten
 * silently, the draft applied once. The browser flow itself is checked by
 * hand (no browser test runner in this project).
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const posProduct = (id: string, name: string): DriverPosProductDto => ({
  id,
  reference: id.toUpperCase(),
  barcode: null,
  name,
  imageUrl: null,
  salePriceHT: 10,
  salePriceTTC: 12,
  taxRate: 20,
  availableQuantity: 0,
  supplierId: null,
  supplierName: null,
  supplierLogoUrl: null,
});

function KnownProductsProbe(props: { preload: DriverPosProductDto[]; extra?: DriverPosProductDto[] }) {
  const { allKnownProducts, products } = usePosProductSearch(props.preload, "", {
    truncated: true,
    locationId: "loc",
    normalize: (value) => value.toLowerCase(),
    extraProducts: props.extra,
  });
  return React.createElement("output", {
    "data-known": allKnownProducts.map((product) => product.id).join(","),
    "data-grid": String(products.length),
  });
}

test("25. a product outside the 500 preloaded ones becomes resolvable for the cart (allKnownProducts), the grid is unchanged", () => {
  const preload = Array.from({ length: 500 }, (_, index) => posProduct(`p${index}`, `Article ${index}`));
  const target = posProduct("zz-limonade", "Zzz Limonade");

  const without = renderToStaticMarkup(React.createElement(KnownProductsProbe, { preload }));
  assert.equal(without.includes("zz-limonade"), false, "not preloaded: unknown before");

  const html = renderToStaticMarkup(React.createElement(KnownProductsProbe, { preload, extra: [target] }));
  const known = /data-known="([^"]*)"/.exec(html)?.[1].split(",") ?? [];
  assert.equal(known.length, 501);
  assert.ok(known.includes("zz-limonade"));
  assert.match(html, /data-grid="500"/, "extra products never change what the grid shows");

  // a preloaded product is never duplicated or replaced by an extra copy
  const duplicate = renderToStaticMarkup(React.createElement(KnownProductsProbe, { preload, extra: [preload[0]] }));
  assert.equal((/data-known="([^"]*)"/.exec(duplicate)?.[1].split(",") ?? []).length, 500);
});

test("25. the POS loads missing cart products by id instead of dropping the line silently", () => {
  const layout = code("./pos-layout.tsx");
  assert.match(layout, /useMissingCartProducts\(\{/);
  assert.match(layout, /extraProducts,\n\s+\},/);
  assert.match(layout, /onLoaded: registerProducts/);
  assert.match(layout, /onUnavailable:/, "a product that can't be loaded is reported, not silently dropped");
  const hook = code("./use-missing-cart-products.ts");
  assert.match(hook, /\/api\/products\/pos-by-ids\?/);
  const products = code("../../lib/server/products.ts");
  assert.match(products, /export async function getPosProductsByIds/);
  assert.match(products, /where: \{ organizationId: currentUser\.organizationId, status: "ACTIVE", id: \{ in: ids \} \}/);
});

test("24. a non-empty POS cart is never overwritten without asking (exact message, two buttons, no merge)", () => {
  assert.equal(
    AI_DRAFT_REPLACE_MESSAGE,
    "Ton panier contient déjà des produits. Veux-tu le remplacer par le panier préparé par l'Assistant IA ?",
  );
  const dialog = read("./ai-draft-replace-dialog.tsx");
  assert.match(dialog, />\s*Remplacer le panier\s*</);
  assert.match(dialog, />\s*Annuler\s*</);

  const hook = code("./use-ai-pos-draft.ts");
  assert.match(hook, /if \(latestRef\.current\.hasCartContent\(\)\) setPendingDraft\(draft\);\s+else await apply\(draft\);/);
  const layout = code("./pos-layout.tsx");
  assert.match(layout, /hasCartContent: \(\) => cart\.length > 0 \|\| openPendingSale !== null/);
  // replace, never merge: the cart becomes exactly the draft lines
  assert.match(layout, /resetOperation\(\);\s+setCart\(draft\.lines\.map\(\(line\) => \(\{ \.\.\.line, discountUnitAmount: 0 \}\)\)\);/);
  assert.match(layout, /<AiDraftReplaceDialog/);
});

test("the draft only brings ids + quantities: prices, VAT, discounts and rounding stay the POS's own", () => {
  const layout = code("./pos-layout.tsx");
  const fill = /fillCart: \(draft\) => \{([\s\S]*?)\n    \},/.exec(layout)?.[1] ?? "";
  assert.ok(fill, "fillCart found");
  for (const forbidden of ["priceOverrideHT", "unitPriceHT", "totalTTC", "taxRate", "salePrice"]) {
    assert.equal(fill.includes(forbidden), false, forbidden);
  }
  const dto = read("../../types/ai-pos-draft-dto.ts");
  assert.match(dto, /lines: Array<\{ productId: string; quantity: number \}>/);
});

test("22+23. the draft is marked APPLIED (once) BEFORE the cart is filled; a second open is refused", () => {
  const hook = code("./use-ai-pos-draft.ts");
  const applyAt = hook.indexOf("/apply`");
  const fillAt = hook.indexOf("fillCart(draft)");
  assert.ok(applyAt > 0 && fillAt > applyAt, "POST .../apply happens before fillCart");
  assert.match(hook, /if \(!response\.ok\) throw new Error/);
  assert.match(hook, /handledRef\.current === draftId/, "one load per draft id");
  assert.match(hook, /if \(!draftId\) handledRef\.current = null;/, "the same link can be opened again after Annuler");
  // registered BEFORE applying, so the lines resolve immediately
  assert.ok(hook.indexOf("registerProducts(draft.products)") < hook.indexOf("await apply(draft)"));

  const server = code("../../lib/server/ai-pos-draft-pos.ts");
  assert.match(server, /status: "OPEN",\s+expiresAt: \{ gt: now \},\s+\},\s+data: \{ status: "APPLIED", appliedAt: now \}/);
  assert.match(server, /checkAiPosDraftAccess\(row, \{ organizationId: user\.organizationId, userId: user\.id \}\)/);
  assert.match(server, /requireOrganizationUser\(\[\.\.\.POS_ROLES\]\)/);
  const apply = read("../../app/api/pos/ai-draft/[id]/apply/route.ts");
  assert.match(apply, /rejectUntrustedOrigin\(request\)/, "CSRF on the state-changing route");
});

test("opening a draft is blocked in edit mode and offline, and never creates a sale", () => {
  const layout = code("./pos-layout.tsx");
  assert.match(layout, /blockedReason: editSaleId\s+\?/);
  assert.match(layout, /offline\.isOffline\s+\?/);
  const hook = code("./use-ai-pos-draft.ts");
  assert.equal(/\/api\/sales/.test(hook), false, "the hook never calls the sale API");
});
