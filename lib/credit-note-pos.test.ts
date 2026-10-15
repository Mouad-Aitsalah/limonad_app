import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CREDIT_NOTE_PAYMENT_MODE_LABEL,
  buildCreditNotePosPayload,
  creditLineToCartLine,
  creditNoteBlockingReason,
  creditTotals,
  creditTotalsToCartTotals,
  defaultReasonFor,
  productToCreditLine,
  productToPosProduct,
  type CreditPosLine,
} from "@/lib/credit-note-pos";
import type { ProductDto } from "@/types/product-dto";

const product = { id: "p1", name: "Jus 1L", reference: "J1", unit: "pcs", salePrice: 10, purchasePrice: 6, taxRate: 20, barcode: null, imageUrl: null } as unknown as ProductDto;

test("the payment mode of every avoir is « Rembourser »", () => {
  assert.equal(CREDIT_NOTE_PAYMENT_MODE_LABEL, "Rembourser");
});

test("a returned product starts at the party's catalogue price", () => {
  assert.equal(productToCreditLine(product, "client").unitPrice, 10);
  assert.equal(productToCreditLine(product, "fournisseur").unitPrice, 6);
  assert.equal(productToPosProduct(product, "client").prixVenteTTC, 12);
  assert.equal(productToPosProduct(product, "fournisseur").prixVenteTTC, 7.2);
});

test("the refund total uses the server's rounding points (HT, then its VAT, then TTC)", () => {
  const lines: CreditPosLine[] = [
    { ...productToCreditLine(product, "client"), quantityReturned: 3 },
    { ...productToCreditLine({ ...product, id: "p2", salePrice: 3.33 } as ProductDto, "client"), quantityReturned: 3 },
  ];
  // line 1: HT 30.00, VAT 6.00 -> 36.00 ; line 2: HT 9.99, VAT 2.00 (1.998) -> 11.99
  const totals = creditTotals(lines);
  assert.equal(totals.totalHT, 39.99);
  assert.equal(totals.taxAmount, 8);
  assert.equal(totals.totalTTC, 47.99);
  const cart = creditTotalsToCartTotals(totals);
  assert.equal(cart.netAPayer, 47.99);
  assert.equal(cart.remise, 0);
});

test("a cart line is read-only priced, without discount and not a transfer", () => {
  const cartLine = creditLineToCartLine({ ...productToCreditLine(product, "client"), quantityReturned: 2 });
  assert.equal(cartLine.unitPriceTTC, 12);
  assert.equal(cartLine.discountUnitAmount, 0);
  assert.equal(cartLine.totalTTC, 24);
  assert.equal(cartLine.transferValue, 0);
});

test("a customer avoir is a validated MANUAL return refunded in cash, never a sale", () => {
  const payload = buildCreditNotePosPayload({
    party: "client",
    partyId: "c1",
    depotId: "d1",
    reason: "retour_commercial",
    comment: "Produit rendu",
    returnDate: "2026-10-15",
    idempotencyKey: "key-1",
    lines: [{ ...productToCreditLine(product, "client"), quantityReturned: 2 }],
  });
  assert.equal(payload.partyType, "client");
  assert.equal(payload.returnMode, "MANUAL");
  assert.equal(payload.refundMode, "remboursement_especes");
  assert.equal(payload.customerId, "c1");
  assert.equal(payload.stockDestinationLocationId, "d1");
  assert.equal(payload.idempotencyKey, "key-1");
  assert.equal(payload.id, undefined, "never an update of an existing draft");
  assert.deepEqual(payload.lines, [{ productId: "p1", quantityReturned: 2, unitPrice: 10, discountPercent: 0, taxRate: 20 }]);
  assert.equal("paymentMethod" in payload, false);
});

test("a supplier avoir leaves from the chosen depot", () => {
  const payload = buildCreditNotePosPayload({
    party: "fournisseur",
    partyId: "s1",
    depotId: "d1",
    reason: "produit_defectueux",
    comment: "",
    returnDate: "2026-10-15",
    idempotencyKey: "key-2",
    lines: [productToCreditLine(product, "fournisseur")],
  });
  assert.equal(payload.partyType, "fournisseur");
  assert.equal(payload.supplierId, "s1");
  assert.equal(payload.stockSourceLocationId, "d1");
  assert.equal(payload.lines[0].unitPrice, 6);
  assert.equal(defaultReasonFor("client"), "retour_commercial");
  assert.equal(defaultReasonFor("fournisseur"), "produit_defectueux");
});

test("« Encaisser » is blocked until the avoir is complete", () => {
  const ok = { party: "client" as const, partyId: "c1", depotId: "d1", reason: "retour_commercial" as const, comment: "Produit rendu", lineCount: 1 };
  assert.equal(creditNoteBlockingReason(ok), null);
  assert.match(creditNoteBlockingReason({ ...ok, lineCount: 0 }) ?? "", /au moins un produit/);
  assert.match(creditNoteBlockingReason({ ...ok, partyId: "" }) ?? "", /client/);
  assert.match(creditNoteBlockingReason({ ...ok, depotId: "" }) ?? "", /dépôt/);
  assert.match(creditNoteBlockingReason({ ...ok, comment: " ab " }) ?? "", /justification/);
  const supplier = { ...ok, party: "fournisseur" as const, partyId: "s1", comment: "" };
  assert.equal(creditNoteBlockingReason(supplier), null, "a supplier note needs no justification unless « Autre »");
  assert.match(creditNoteBlockingReason({ ...supplier, reason: "autre" }) ?? "", /Autre/);
});
