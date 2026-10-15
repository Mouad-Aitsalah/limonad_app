import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ReceiptPrint } from "@/components/pos/receipt-print";
import { creditNoteToReceiptSale } from "@/lib/invoice-print";
import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import type { CreditNote } from "@/types/credit-note";
import type { SaleDto, SaleLineDto } from "@/types/operations-dto";

/**
 * « Imprimer la facture » prints the POS ticket itself - no other invoice layout:
 *  - Factures journalières / Archives des factures: the counter POS ticket (<ReceiptPrint ruled>, 80 mm,
 *    window.print), exactly as pos-layout.tsx prints it;
 *  - the driver's « Mes ventes du jour »: the driver POS ticket and the driver POS mechanism
 *    (useDriverSalePrint: window.print on the web, Bluetooth printer / PDF print on Android).
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, "|")
    .replace(/&#x27;/g, "'")
    .split(String.fromCharCode(160))
    .join(" ");

function line(id: string, name: string, unitPriceHT: number, quantity: number, discount = 0): SaleLineDto {
  const totals = computeDiscountedLineTotals({ unitPriceHT, taxRate: 20, quantity, discountUnitAmount: discount });
  return {
    id,
    productId: `p-${id}`,
    productReference: `R-${id}`,
    productName: name,
    quantity,
    unitPriceHT,
    discountRate: totals.discountRate,
    discountAmount: totals.discountAmount,
    taxRate: 20,
    taxAmount: totals.taxAmount,
    totalHT: totals.totalHT,
    totalTTC: totals.totalTTC,
  };
}

const sale = (over: Partial<SaleDto> = {}): SaleDto => ({
  id: "s1",
  invoiceNumber: "VC-1",
  saleYear: 2026,
  saleNumber: 12,
  displayNumber: "12/2026",
  posSessionId: null,
  origin: "COUNTER",
  status: "PAID",
  customer: { id: "c1", code: "342115", name: "Epicerie Atlas" },
  driver: null,
  subtotalHT: 150.83,
  discountAmount: 3,
  taxAmount: 30.17,
  totalTTC: 181,
  roundingAmount: 0,
  stampAmount: 0,
  paidAmount: 181,
  creditAmount: 0,
  paymentMethod: "CASH",
  createdByUserName: "Caissier",
  validatedAt: "2026-10-15T09:30:00.000Z",
  createdAt: "2026-10-15T09:30:00.000Z",
  lines: [line("1", "Coca-Cola 1L", 16.67, 3, 1), line("2", "Ice Passion 33cl", 25.83, 4)],
  payments: [],
  ...over,
});

const creditNote = (over: Partial<CreditNote> = {}): CreditNote => ({
  id: "cn1",
  number: "AC-20261015-000001",
  partyType: "client",
  invoiceId: null,
  invoiceNumber: null,
  customerId: "c1",
  customerName: "Café Zahra",
  supplierId: null,
  origin: "retour_manuel",
  refundMode: "remboursement_especes",
  saleOrigin: null,
  truckId: null,
  tourneeClosed: true,
  stockDestinationLocationId: "d",
  stockSourceLocationId: null,
  reason: "retour_commercial",
  comment: "Retour",
  returnDate: "2026-10-15T10:00:00.000Z",
  status: "VALIDE",
  totalTTC: 24,
  roundingAmount: 0,
  lines: [
    { id: "l1", productId: "p1", productName: "Soda citron", productReference: "SOD", quantityReturned: 2, unitPrice: 10, discountPercent: 0, taxRate: 20, totalHT: 20, taxAmount: 4, totalTTC: 24 },
  ],
  createdBy: "Caissier",
  validatedBy: "Caissier",
  validatedAt: "2026-10-15T10:00:00.000Z",
  createdAt: "2026-10-15T10:00:00.000Z",
  updatedAt: "2026-10-15T10:00:00.000Z",
  ...over,
});

const ticket = (value: SaleDto, ruled = true) =>
  text(renderToStaticMarkup(<ReceiptPrint ruled={ruled} sale={value} identity={null} />));

test("1. the counter POS still prints its own ticket, the same way (ReceiptPrint ruled + window.print)", () => {
  const pos = code("../pos/pos-layout.tsx");
  assert.match(pos, /<ReceiptPrint\s+ruled\s+sale=\{lastSale\}/);
  assert.match(pos, /function schedulePrint\(\) \{\s+window\.setTimeout\(\(\) => window\.print\(\), 0\);\s+\}/);
  // a normal sale prints exactly as before: invoice number, paid status, payment, cashier
  const out = ticket(sale());
  for (const expected of ["|N° Facture : |12/2026|", "|Paiement : Espèces|", "|Statut : Réglée|", "|Caisse : Caissier|", "|Montant TTC|181,00 DH|"]) {
    assert.ok(out.includes(expected), expected);
  }
  // the discounted line keeps the POS rule: the price actually charged per unit, no « Remise » line
  assert.ok(out.includes("|3|Coca-Cola 1L|19,00|57,00|"));
  assert.equal(out.includes("Avoir"), false);
});

test("2-3. Factures journalières and Archives print the counter POS ticket, for the selected row only", () => {
  const hook = code("./use-invoice-print.tsx");
  assert.match(hook, /<ReceiptPrint ruled sale=\{ticketSale\} \/>/, "the very same component and variant as the counter POS");
  assert.match(hook, /flushSync\(\(\) => setTicketSale\(sale\)\);\s+window\.setTimeout\(\(\) => window\.print\(\), 0\);/);
  assert.match(hook, /fetchInvoiceDetail\("\/api\/sales", encodeURIComponent\(item\.id\)\)/);
  assert.match(hook, /fetch\(`\/api\/credit-notes\/\$\{encodeURIComponent\(item\.id\)\}`\)/);
  assert.equal(/method: "(POST|PATCH|PUT|DELETE)"/.test(hook), false, "read only");
  const table = code("./invoices-table.tsx");
  assert.match(table, /onClick=\{\(\) => void printInvoice\(invoice\)\}/);
  assert.match(table, /\{printElement\}/);
  const view = table.indexOf('{isCreditNote ? "Voir l\'avoir" : "Voir détails"}');
  const print = table.indexOf("Imprimer la facture");
  const cancel = table.indexOf('{isDraft ? "Supprimer" : "Annuler la facture"}');
  assert.ok(view > 0 && print > view && cancel > print, "Voir détails / Imprimer la facture / Annuler la facture");
  assert.match(code("./orders-tab.tsx"), /<InvoicesTable invoices=\{items\} onSaleChanged=\{refetch\} \/>/);
  assert.match(code("./daily-invoices-view.tsx"), /<InvoicesTable invoices=\{data\.items\} onSaleChanged=\{refetch\} dailyLayout \/>/);
});

test("4. the driver page prints the driver POS ticket with the driver POS mechanism (shared, not copied)", () => {
  const hook = code("../driver-pos/use-driver-sale-print.tsx");
  assert.match(hook, /if \(!Capacitor\.isNativePlatform\(\)\) \{\s+window\.setTimeout\(\(\) => window\.print\(\), 0\);/);
  assert.match(hook, /getThermalPrinterService\(\)\.printSale\(sale, \{ offlineReference \}\)/);
  assert.match(hook, /await shareInvoicePdf\(\{ sale, identity, customerPhone \}, "print"\);/);
  assert.match(hook, /<ThermalPrinterPanel/);
  // the driver POS and the driver's sales page both use it
  const pos = code("../driver-pos/driver-pos-view.tsx");
  assert.match(pos, /const driverPrint = useDriverSalePrint\(\{ identity, customerPhone: lastSalePhone \}\);/);
  assert.match(pos, /return driverPrint\.printSale\(sale, offlineReference\);/);
  assert.match(pos, /<ReceiptPrint sale=\{lastSale\} offlineReference=\{offlineTicketReference\} identity=\{identity\} \/>/);
  assert.equal(/getThermalPrinterService|isThermalPrinterAvailable|<ThermalPrinterPanel/.test(pos), false, "no second copy");
  const page = code("../driver-pos/driver-sales-view.tsx");
  assert.match(page, /useDriverSalePrint\(\{/);
  assert.match(page, /<ReceiptPrint sale=\{ticketSale\} identity=\{resolvedIdentity\} \/>/, "the plain driver ticket, not the counter one");
  assert.match(page, /await driverPrint\.printSale\(sale, null\);/);
  // the driver prints the sale already loaded for him: nothing is fetched by the print
  const printFn = page.slice(page.indexOf("async function printInvoice("), page.indexOf("function openDetail("));
  assert.equal(/fetch\(/.test(printFn), false);
  assert.match(page, /void printInvoice\(row\.sale\);/);
  const sales = code("../../lib/server/driver-sales.ts");
  assert.match(sales, /where: \{ id, driverId: user\.driverId, organizationId: user\.organizationId \},/);
});

test("5. no third invoice layout: the A4 document is gone", () => {
  assert.equal(existsSync(new URL("./invoice-print.tsx", import.meta.url)), false);
  for (const path of ["./use-invoice-print.tsx", "./invoices-table.tsx", "../driver-pos/driver-sales-view.tsx", "../../lib/invoice-print.ts"]) {
    assert.equal(/invoice-print-root|InvoicePrintDocument|PrintableInvoice|size: A4/.test(code(path)), false, path);
  }
});

test("6. an avoir prints on the same ticket: « N° Avoir », negative amounts, « Rembourser », « Avoir »", () => {
  const out = ticket(creditNoteToReceiptSale(creditNote()));
  for (const expected of ["|N° Avoir : |AC-20261015-000001|", "|Client : |Café Zahra|", "|2|Soda citron|-12,00|-24,00|", "|Montant TTC|-24,00 DH|", "|Paiement : Rembourser|", "|Statut : Avoir|"]) {
    assert.ok(out.includes(expected), expected);
  }
  assert.equal(out.includes("N° Facture"), false);
  assert.equal(out.includes("Réglée"), false);
  assert.ok(ticket(creditNoteToReceiptSale(creditNote({ status: "CONTREPASSE" }))).includes("|Statut : Avoir annulé|"));
  // the driver ticket variant too
  assert.ok(ticket(creditNoteToReceiptSale(creditNote()), false).includes("|Paiement : Rembourser|"));
});

test("7. avoir data adapted, never recomputed: stored totals, discounted line folded so quantity x price = amount", () => {
  const adapted = creditNoteToReceiptSale(
    creditNote({
      totalTTC: 21.6,
      lines: [{ id: "l1", productId: "p1", productName: "Soda citron", productReference: "SOD", quantityReturned: 2, unitPrice: 10, discountPercent: 10, taxRate: 20, totalHT: 18, taxAmount: 3.6, totalTTC: 21.6 }],
    }),
  );
  assert.equal(adapted.totalTTC, -21.6);
  assert.equal(adapted.lines[0].totalTTC, -21.6);
  assert.equal(adapted.paymentMethod, "REFUND");
  assert.equal(adapted.status, "CREDIT_NOTE");
  const out = ticket(adapted);
  assert.ok(out.includes("|2|Soda citron|-10,80|-21,60|"), "10,80 refunded per unit after the 10 % discount");
  assert.ok(out.includes("|Montant TTC|-21,60 DH|"));
  // a supplier avoir has no customer code line
  const supplier = ticket(creditNoteToReceiptSale(creditNote({ partyType: "fournisseur", customerId: null, customerName: null, supplierId: "f1", supplierName: "Fournisseur 1" })));
  assert.ok(supplier.includes("|Client : |Fournisseur 1|"));
  assert.equal(supplier.includes("N° client"), false);
});

test("8. a cancelled invoice states it; rounding and partial credit keep the POS rules", () => {
  assert.ok(ticket(sale({ status: "CANCELLED" })).includes("|Statut : ANNULÉE|"));
  const rounded = ticket(sale({ roundingAmount: 0.5, totalTTC: 181.5 }));
  assert.ok(rounded.includes("|Arrondi|+0,50 DH|") || rounded.includes("|Arrondi|"));
  assert.ok(rounded.includes("|Montant TTC|181,50 DH|"));
  assert.ok(ticket(sale({ paidAmount: 100, creditAmount: 81 })).includes("|Statut : Partiellement réglée|"));
});

test("printing never writes: no sale, payment, stock or accounting call in the print code", () => {
  for (const path of ["./use-invoice-print.tsx", "../../lib/invoice-print.ts", "../driver-pos/use-driver-sale-print.tsx"]) {
    assert.equal(/prisma|\/cancel|\/collect|method: "(POST|PATCH|PUT|DELETE)"/.test(code(path)), false, path);
  }
});
