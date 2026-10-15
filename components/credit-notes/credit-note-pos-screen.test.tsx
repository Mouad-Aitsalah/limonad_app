import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { RefundForm } from "@/components/credit-notes/refund-dialog";
import { CartSummary } from "@/components/pos/cart-summary";
import { CartTable } from "@/components/pos/cart-table";
import { ProductGrid } from "@/components/pos/product-grid";
import { creditLineToCartLine, creditTotals, creditTotalsToCartTotals, productToCreditLine, productToPosProduct } from "@/lib/credit-note-pos";
import type { ProductDto } from "@/types/product-dto";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const noop = () => {};
const product = { id: "p1", name: "Jus 1L", reference: "J1", unit: "pcs", salePrice: 10, purchasePrice: 6, taxRate: 20, barcode: null, imageUrl: null } as unknown as ProductDto;

test("the page keeps the two top buttons and loses the three removed entries", () => {
  const tabs = read("components/credit-notes/credit-note-tabs.tsx");
  assert.match(tabs, />Avoir client</);
  assert.match(tabs, />Avoir fournisseur</);
  for (const removed of ["Historique des avoirs", "Lier une facture", "Lie a une facture", "Retour manuel", "CreditNotesHistory", "CreditNotePosView"]) {
    assert.equal(tabs.includes(removed), false, `${removed} is gone from the page`);
  }
  const screen = read("components/credit-notes/credit-note-pos-screen.tsx");
  for (const removed of ["Historique des avoirs", "Lier une facture", "Retour manuel", "Nouvelle facture", "InvoiceHeader", "PageHeaderSlot"]) {
    assert.equal(screen.includes(removed), false, `${removed} is not in the credit note screen`);
  }
});

test("the screen is the POS building blocks, without the invoice header nor the 1 2 navigation", () => {
  const screen = read("components/credit-notes/credit-note-pos-screen.tsx");
  for (const block of ["ProductSearch", "PosProductGrid", "CartTable", "CartSummary", "CustomerCombobox"]) {
    assert.ok(screen.includes(`<${block}`), `${block} is reused`);
  }
  assert.equal(/InvoiceActions|pending-sales|invoice-header|invoiceSlots|ChevronLeft|ChevronRight/.test(screen), false);
  // it is not a sale: it talks to the credit note service only
  assert.ok(screen.includes("/api/credit-notes/manual"));
  assert.equal(screen.includes("/api/sales"), false);
  assert.ok(screen.includes('"Encaisser"') || screen.includes(">\n              Encaisser") || screen.includes("Encaisser"));
});

test("the cart of an avoir has no discount column, reads « Total à rembourser » and shows no stock", () => {
  const line = creditLineToCartLine({ ...productToCreditLine(product, "client"), quantityReturned: 2 });
  const table = renderToStaticMarkup(
    <CartTable lines={[line]} operationType="sale" pcLayout hideDiscount onIncrement={noop} onDecrement={noop} onQuantityChange={noop} onDiscountChange={noop} onRemove={noop} />,
  );
  assert.equal(table.includes("Rem. DH"), false);
  assert.equal(table.includes("Remise en DH"), false);
  assert.ok(table.includes("Prix TTC"));
  const withDiscount = renderToStaticMarkup(
    <CartTable lines={[line]} operationType="sale" pcLayout onIncrement={noop} onDecrement={noop} onQuantityChange={noop} onDiscountChange={noop} onRemove={noop} />,
  );
  assert.ok(withDiscount.includes("Rem. DH"), "the normal POS cart keeps its discount column");

  const summary = renderToStaticMarkup(<CartSummary totals={creditTotalsToCartTotals(creditTotals([productToCreditLine(product, "client")]))} operationType="sale" totalLabel="Total à rembourser" />);
  assert.ok(summary.includes("Total à rembourser"));
  assert.equal(summary.includes("Total à payer"), false);
  assert.ok(renderToStaticMarkup(<CartSummary totals={creditTotalsToCartTotals(creditTotals([]))} operationType="sale" />).includes("Total à payer"), "the POS keeps « Total à payer »");

  const grid = renderToStaticMarkup(<ProductGrid products={[{ ...productToPosProduct(product, "client"), quantiteStock: 0 }]} onAdd={noop} display={{ showPhotos: false, showStock: false }} />);
  assert.equal(grid.includes("Stock 0"), false);
  const gridWithStock = renderToStaticMarkup(<ProductGrid products={[{ ...productToPosProduct(product, "client"), quantiteStock: 0 }]} onAdd={noop} display={{ showPhotos: false }} />);
  assert.ok(gridWithStock.includes("Stock 0"), "the POS cards still show the stock");
});

test("« Encaisser » opens a dialog whose payment mode is « Rembourser » (a refund, not a collection)", () => {
  const markup = renderToStaticMarkup(
    <RefundForm
      open
      onOpenChange={noop}
      party="client"
      partyName="Client Test"
      totalTTC={24}
      depots={[]}
      depotId=""
      onDepotChange={noop}
      reason="retour_commercial"
      onReasonChange={noop}
      comment=""
      onCommentChange={noop}
      busy={false}
      blockingReason={null}
      onConfirm={noop}
    />,
  );
  assert.ok(markup.includes("Rembourser"));
  assert.ok(markup.includes("Mode de règlement"));
  assert.ok(markup.includes("Montant à rembourser"));
  assert.ok(markup.includes("Sortie d&#x27;espèces de la caisse") || markup.includes("Sortie d'espèces de la caisse"));
  assert.equal(markup.includes("Espèces</span>"), false, "no collection mode is offered");
});

test("the confirm button is disabled while the request runs and while the avoir is incomplete", () => {
  const render = (busy: boolean, blockingReason: string | null) =>
    renderToStaticMarkup(
      <RefundForm open onOpenChange={noop} party="client" partyName="C" totalTTC={24} depots={[]} depotId="" onDepotChange={noop} reason="retour_commercial" onReasonChange={noop} comment="" onCommentChange={noop} busy={busy} blockingReason={blockingReason} onConfirm={noop} />,
    );
  // the confirm button is the last <button> of the form
  const confirmButton = (markup: string) => markup.slice(markup.lastIndexOf("<button"));
  const isDisabled = (button: string) => /^<button[^>]*\sdisabled(?:=|\s|>)/.test(button);
  assert.equal(isDisabled(confirmButton(render(true, null))), true);
  assert.equal(isDisabled(confirmButton(render(false, "Sélectionnez un client."))), true);
  assert.equal(isDisabled(confirmButton(render(false, null))), false);
});

test("the screen guards a double click and reuses one idempotency key until the avoir is saved", () => {
  const screen = read("components/credit-notes/credit-note-pos-screen.tsx");
  assert.ok(screen.includes("submittingRef"));
  assert.match(screen, /if \(submittingRef\.current \|\| blockingReason\) return;/);
  assert.match(screen, /idempotencyKeyRef\.current = crypto\.randomUUID\(\)/);
  // the key is only renewed after a success (resetForm), never when the request fails
  const failureBranch = screen.slice(screen.indexOf("if (!response.ok || !body.creditNote)"), screen.indexOf("const saved"));
  assert.equal(failureBranch.includes("randomUUID"), false);
});

test("the page is limited to the administrator and the cashier", () => {
  const page = read("app/(dashboard)/avoirs/page.tsx");
  assert.match(page, /allowedRoles: UserRole\[\] = \["admin", "cashier"\]/);
  assert.equal(page.includes("getCreditNotes"), false, "no history preload");
  const server = read("lib/server/credit-notes.ts");
  assert.match(server, /DESK_CREDIT_NOTE_ROLES: UserRole\[\] = \["admin", "cashier"\]/);
  assert.match(server, /CREDIT_NOTE_REVERSAL_ROLES: UserRole\[\] = \["admin", "depot_manager"\]/);
});
