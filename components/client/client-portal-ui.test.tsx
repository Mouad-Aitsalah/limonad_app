import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ClientCartBar } from "@/components/client/client-cart-sheet";
import { AvailabilityBadge, ClientProductCard } from "@/components/client/client-product-card";
import { ClientQuantityStepper } from "@/components/client/client-quantity-stepper";
import { buildClientOrderBody } from "@/components/client/use-client-order-submit";
import {
  addCartLine,
  cartCounts,
  cartStorageKey,
  parseStoredCart,
  removeCartLines,
  setCartLineQuantity,
} from "@/lib/client-cart-store";
import { CLIENT_ORDER_MAX_LINES, CLIENT_ORDER_MAX_QUANTITY, clientOrderInputSchema } from "@/lib/client-portal-rules";
import type { ClientCartLine, ClientCatalogProductDto } from "@/types/client-portal";

/**
 * Espace Client (mobile ordering page): no price anywhere, the cards, the cart and the submission body.
 * The database side (catalogue without price, order priced server-side) is in
 * lib/server/client-portal-core.test.ts.
 */

const noop = () => {};
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").split(String.fromCharCode(160)).join(" ").replace(/\s+/g, " ");

const product = (over: Partial<ClientCatalogProductDto> = {}): ClientCatalogProductDto => ({
  id: "p1",
  name: "Coca-Cola 1L",
  reference: "CC-1L",
  description: null,
  categoryId: "c1",
  categoryName: "Boissons",
  imageUrl: "/api/products/p1/image?v=1",
  available: true,
  ...over,
});

/** A money amount as the app formats it ("72,00 DH") or any "DH" / "MAD" mention. */
const MONEY = /\d+,\d{2}\s?(DH|MAD)|\bDH\b|\bMAD\b|TTC|HT\b/;

test("no price anywhere in the Espace Client code: no amount formatting, no price or total field", () => {
  const files = [
    ...readdirSync(new URL("./", import.meta.url))
      .filter((name) => /\.(tsx?|ts)$/.test(name) && !name.includes(".test."))
      .map((name) => `./${name}`),
    "../../app/client/catalog/page.tsx",
    "../../app/client/cart/page.tsx",
    "../../app/client/orders/page.tsx",
    "../../types/client-portal.ts",
    "../../lib/client-cart-store.ts",
  ];
  assert.ok(files.length >= 14, `${files.length} files scanned`);
  for (const file of files) {
    const source = code(file);
    assert.equal(/formatCurrency|formatSignedCurrency|priceTTC|totalTTC|unitPrice|salePrice|subtotal|taxAmount/.test(source), false, file);
    assert.equal(MONEY.test(source), false, `${file}: no "DH" / TTC / HT text`);
  }
});

test("product card: photo, designation, reference and availability - and no price", () => {
  const markup = renderToStaticMarkup(
    <ClientProductCard product={product()} quantityInCart={0} onAdd={noop} onQuantityChange={noop} onOpenDetails={noop} />,
  );
  const out = text(markup);
  assert.ok(out.includes("Coca-Cola 1L"));
  assert.ok(out.includes("Réf. CC-1L"));
  assert.ok(out.includes("Disponible"));
  assert.match(markup, /<img[^>]+alt="Coca-Cola 1L"/, "the product photo");
  assert.match(markup, /src="\/api\/products\/p1\/image\?v=1"/);
  assert.equal(MONEY.test(out), false);
  // not in the cart yet: one clear « Ajouter » button
  assert.match(markup, /aria-label="Ajouter Coca-Cola 1L au panier"[^>]*>[\s\S]*?Ajouter<\/button>/);
  assert.equal(markup.includes("Quantité de Coca-Cola 1L"), false);
});

test("product card in the cart: « Ajouter » becomes « − n + », and « − » on one unit takes it out", () => {
  const two = renderToStaticMarkup(
    <ClientProductCard product={product()} quantityInCart={2} onAdd={noop} onQuantityChange={noop} onOpenDetails={noop} />,
  );
  assert.equal(two.includes("Ajouter Coca-Cola 1L au panier"), false);
  assert.match(two, /aria-label="Quantité de Coca-Cola 1L"[^>]*value="2"|value="2"[^>]*aria-label="Quantité de Coca-Cola 1L"/);
  assert.ok(two.includes("Diminuer la quantité de Coca-Cola 1L"));
  assert.ok(two.includes("Augmenter la quantité de Coca-Cola 1L"));
  const one = renderToStaticMarkup(
    <ClientProductCard product={product()} quantityInCart={1} onAdd={noop} onQuantityChange={noop} onOpenDetails={noop} />,
  );
  assert.ok(one.includes("Retirer Coca-Cola 1L du panier"), "the minus of the last unit removes the product");
});

test("availability: « Disponible » or « Sur commande » (still orderable) - never a quantity", () => {
  assert.ok(text(renderToStaticMarkup(<AvailabilityBadge available />)).includes("Disponible"));
  assert.ok(text(renderToStaticMarkup(<AvailabilityBadge available={false} />)).includes("Sur commande"));
  const onOrder = renderToStaticMarkup(
    <ClientProductCard product={product({ available: false })} quantityInCart={0} onAdd={noop} onQuantityChange={noop} onOpenDetails={noop} />,
  );
  assert.ok(onOrder.includes("Ajouter Coca-Cola 1L au panier"), "a product « sur commande » can still be ordered");
});

test("quantity stepper: bounded, never negative; the cart version stops at 1 (its own delete button)", () => {
  const cartStepper = renderToStaticMarkup(<ClientQuantityStepper value={1} onChange={noop} label="X" />);
  assert.match(cartStepper, /<button[^>]*disabled=""[^>]*aria-label="Diminuer la quantité de X"/);
  const max = renderToStaticMarkup(<ClientQuantityStepper value={CLIENT_ORDER_MAX_QUANTITY} onChange={noop} label="X" />);
  assert.match(max, /<button[^>]*disabled=""[^>]*aria-label="Augmenter la quantité de X"/);
  // touch-friendly: 40 px buttons in a 44 px control
  assert.match(cartStepper, /h-11/);
  assert.match(cartStepper, /h-10 w-10/);
});

test("cart bar: product and article counts, « Voir mon panier », no amount; hidden on an empty cart", () => {
  const markup = renderToStaticMarkup(<ClientCartBar lineCount={3} itemCount={12} onOpen={noop} />);
  const out = text(markup);
  assert.ok(out.includes("3 produits"));
  assert.ok(out.includes("12 articles au total"));
  assert.ok(out.includes("Voir mon panier"));
  assert.match(markup, /fixed inset-x-0 bottom-0/);
  assert.equal(MONEY.test(out), false);
  assert.equal(renderToStaticMarkup(<ClientCartBar lineCount={0} itemCount={0} onOpen={noop} />), "");
  assert.ok(text(renderToStaticMarkup(<ClientCartBar lineCount={1} itemCount={1} onOpen={noop} />)).includes("1 produit 1 article"));
});

test("cart rules: add, increase, decrease, remove - never negative, bounded, the cart limit kept", () => {
  let cart: ClientCartLine[] = [];
  cart = addCartLine(cart, product())!;
  assert.deepEqual(cart, [{ productId: "p1", productName: "Coca-Cola 1L", reference: "CC-1L", imageUrl: "/api/products/p1/image?v=1", quantity: 1 }]);
  cart = addCartLine(cart, product(), 2)!;
  assert.equal(cart[0].quantity, 3, "the same product adds up on one line");
  cart = addCartLine(cart, product({ id: "p2", name: "Fanta" }))!;
  assert.deepEqual(cartCounts(cart), { lineCount: 2, itemCount: 4 });

  assert.equal(setCartLineQuantity(cart, "p1", 7)[0].quantity, 7);
  assert.equal(setCartLineQuantity(cart, "p1", CLIENT_ORDER_MAX_QUANTITY + 50)[0].quantity, CLIENT_ORDER_MAX_QUANTITY);
  assert.deepEqual(setCartLineQuantity(cart, "p1", 0).map((line) => line.productId), ["p2"], "0 removes the line");
  assert.deepEqual(setCartLineQuantity(cart, "p1", -3).map((line) => line.productId), ["p2"], "never a negative quantity");
  assert.equal(setCartLineQuantity(cart, "p1", Number.NaN), cart, "garbage is ignored");
  assert.deepEqual(removeCartLines(cart, "p2").map((line) => line.productId), ["p1"]);
  assert.deepEqual(removeCartLines(cart, ["p1", "p2"]), []);

  const full = Array.from({ length: CLIENT_ORDER_MAX_LINES }, (_, index) => ({
    productId: `x${index}`,
    productName: `P${index}`,
    reference: "",
    imageUrl: null,
    quantity: 1,
  }));
  assert.equal(addCartLine(full, product()), null, "a new product cannot exceed the line limit");
  assert.equal(addCartLine(full, product({ id: "x0" }))![0].quantity, 2, "an existing line can still grow");
});

test("cart persistence: same storage key per organisation + customer; a cart saved with prices loses them on read", () => {
  assert.equal(cartStorageKey("org", "cus"), "comdis-client-cart:v2:org:cus", "the key is unchanged: open carts survive the update");
  const legacy = JSON.stringify([
    { productId: "p1", productName: "Coca", reference: "CC", priceTTC: 72, imageUrl: "/img", quantity: 2 },
    { productId: "p2", productName: "Fanta", priceTTC: 64, quantity: 5000 },
    { productId: "p3", productName: "Bad", quantity: 0 },
    { productName: "No id", quantity: 1 },
    null,
  ]);
  const cart = parseStoredCart(legacy);
  assert.deepEqual(cart, [
    { productId: "p1", productName: "Coca", reference: "CC", imageUrl: "/img", quantity: 2 },
    { productId: "p2", productName: "Fanta", reference: "", imageUrl: null, quantity: CLIENT_ORDER_MAX_QUANTITY },
  ]);
  assert.equal(JSON.stringify(cart).includes("price"), false);
  assert.deepEqual(parseStoredCart("not json"), []);
  assert.deepEqual(parseStoredCart(null), []);
});

test("search and categories only change the list: the catalogue view never empties or rewrites the cart on a filter", () => {
  const view = code("./client-catalog-view.tsx");
  assert.match(view, /onChange=\{\(event\) => setSearch\(event\.target\.value\)\}/);
  assert.match(view, /onClick=\{\(\) => setCategoryId\(category\.id\)\}/);
  assert.equal(/clearCart|removeFromCart/.test(view), false, "the catalogue never removes cart lines in bulk");
  // categories: a horizontal scrolling row, the selected one highlighted
  assert.match(view, /overflow-x-auto/);
  assert.match(view, /aria-selected=\{active\}/);
  assert.match(view, /Aucun produit ne correspond à votre recherche/);
  // the server does the search (designation, reference) and the category filter
  const hook = code("./use-client-catalog.ts");
  assert.match(hook, /if \(params\.q\.trim\(\)\) query\.set\("q", params\.q\.trim\(\)\);/);
  assert.match(hook, /if \(params\.categoryId\) query\.set\("categoryId", params\.categoryId\);/);
  assert.match(hook, /fetch\(`\/api\/client\/catalog\?\$\{query\.toString\(\)\}`/);
});

test("submission: only products and quantities go out (valid for the server), once, with one key per attempt", () => {
  const cart: ClientCartLine[] = [
    { productId: "p1", productName: "Coca", reference: "CC", imageUrl: null, quantity: 2 },
    { productId: "p2", productName: "Fanta", reference: "", imageUrl: null, quantity: 1 },
  ];
  const body = buildClientOrderBody(cart, "  Livraison le matin  ", "key-12345678");
  assert.deepEqual(body, {
    lines: [
      { productId: "p1", quantity: 2 },
      { productId: "p2", quantity: 1 },
    ],
    note: "Livraison le matin",
    idempotencyKey: "key-12345678",
  });
  assert.equal(clientOrderInputSchema.safeParse(body).success, true);
  assert.equal(buildClientOrderBody(cart, "   ", "key-12345678").note, undefined);

  const hook = code("./use-client-order-submit.ts");
  assert.match(hook, /if \(inFlightRef\.current\) return \{ kind: "busy" \};/, "a second tap while sending does nothing");
  assert.match(hook, /idempotencyKeyRef\.current \?\?= crypto\.randomUUID\(\);/, "the same key on a retry");
  assert.match(hook, /if \(response\.ok && body\.order\) \{\s+idempotencyKeyRef\.current = null;/, "a new key only after an order exists");
  const checkout = code("./client-cart-checkout.tsx");
  assert.match(checkout, /onClick=\{\(\) => void confirm\(\)\} disabled=\{submitting\}/, "the confirm button is disabled while sending");
  assert.match(checkout, /Envoi en cours…/);
  assert.match(checkout, /if \(outcome\.kind === "created"\) \{\s+clearCart\(\);/, "the cart is emptied only once the order exists");
});

test("one ordering path: the catalogue panel and the cart page share the same checkout; the old dialogs are gone", () => {
  assert.match(code("./client-cart-sheet.tsx"), /<ClientCartCheckout/);
  assert.match(code("./client-cart-view.tsx"), /<ClientCartCheckout/);
  const files = readdirSync(new URL("./", import.meta.url));
  for (const removed of ["client-cart-summary.tsx", "client-order-confirm-dialog.tsx"]) {
    assert.equal(files.includes(removed), false, removed);
  }
  // the panel cannot be closed while the order is being sent
  assert.match(code("./client-cart-sheet.tsx"), /onOpenChange=\{\(next\) => \(submitting \? undefined : onOpenChange\(next\)\)\}/);
});

test("header: organisation, cart badge, orders and logout - compact (56 px)", () => {
  const header = code("./client-header.tsx");
  assert.match(header, /h-14/);
  assert.match(header, /href="\/client\/orders"/);
  assert.match(header, /aria-label="Se déconnecter"/);
  assert.match(header, /data-testid="client-cart-count"/);
  assert.match(header, /const \{ itemCount \} = cartCounts\(cart\);/);
});
