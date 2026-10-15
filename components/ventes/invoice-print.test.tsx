import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { INVOICE_PRINT_CSS, InvoicePrintDocument } from "@/components/ventes/invoice-print";
import { creditNoteToPrintableInvoice, saleToPrintableInvoice } from "@/lib/invoice-print";
import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import type { CreditNote } from "@/types/credit-note";
import type { SaleDto, SaleLineDto } from "@/types/operations-dto";

/**
 * « Imprimer la facture »: the printable model (amounts as stored, nothing recomputed), the A4 document, the
 * print stylesheet (only the document on paper), and where the action is wired (Factures journalières,
 * Archives des factures, the driver's « Mes ventes du jour »).
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, "|")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .split(String.fromCharCode(160))
    .join(" ");

function line(id: string, name: string, reference: string, unitPriceHT: number, quantity: number, discount = 0): SaleLineDto {
  const totals = computeDiscountedLineTotals({ unitPriceHT, taxRate: 20, quantity, discountUnitAmount: discount });
  return {
    id,
    productId: `p-${id}`,
    productReference: reference,
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

const coca = line("1", "Coca-Cola 1L", "CC-1L", 16.67, 3, 1); // 20,00 TTC, 1 DH off per unit -> 57,00
const ice = line("2", "Ice Passion 33cl", "IP-33", 25.83, 4); // 31,00 TTC -> 124,00

const sale = (over: Partial<SaleDto> = {}): SaleDto => ({
  id: "s1",
  invoiceNumber: "VD-000123",
  saleYear: 2026,
  saleNumber: 123,
  displayNumber: "123/2026",
  posSessionId: null,
  origin: "TRUCK",
  status: "PAID",
  customer: { id: "c1", code: "342115", name: "Epicerie Atlas" },
  driver: { id: "d1", name: "Karim Chauffeur" },
  truck: { id: "t1", code: "CAM-7", registration: "12345-A-6" },
  subtotalHT: 150.83,
  discountAmount: 3,
  taxAmount: 30.17,
  totalTTC: 181,
  roundingAmount: 0,
  stampAmount: 0,
  paidAmount: 181,
  creditAmount: 0,
  paymentMethod: "CASH",
  createdByUserName: "Karim Chauffeur",
  validatedAt: "2026-10-15T09:30:00.000Z",
  createdAt: "2026-10-15T09:30:00.000Z",
  lines: [coca, ice],
  payments: [],
  ...over,
});

const creditNote = (over: Partial<CreditNote> = {}): CreditNote => ({
  id: "cn1",
  number: "AC-20261015-000001",
  partyType: "client",
  invoiceId: "s1",
  invoiceNumber: "VD-000123",
  customerId: "c1",
  customerName: "Epicerie Atlas",
  supplierId: null,
  origin: "facture",
  refundMode: "remboursement_especes",
  saleOrigin: "camion",
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

const identity = { name: "Limonad SARL", tradeName: "COMDIS", logoUrl: "data:image/png;base64,AAAA", address: "12 rue des Oliviers", city: "Casablanca", phone: "0522000000", email: "contact@example.test" };

test("sale: every amount is the stored one; the unit price is the catalogue TTC and the discount is only displayed", () => {
  const doc = saleToPrintableInvoice(sale());
  assert.equal(doc.title, "FACTURE");
  assert.equal(doc.number, "123/2026");
  assert.equal(doc.partyName, "Epicerie Atlas");
  assert.equal(doc.partyCode, "342115");
  assert.equal(doc.issuerLabel, "Chauffeur");
  assert.equal(doc.issuerName, "Karim Chauffeur");
  assert.equal(doc.truck, "CAM-7 - 12345-A-6");
  assert.equal(doc.statusLabel, "Payée");
  assert.equal(doc.paymentLabel, "Espèces");
  assert.equal(doc.warning, null);
  assert.deepEqual(
    doc.lines.map((l) => [l.reference, l.name, l.quantity, l.unitPriceTTC, l.discountUnitAmount, l.totalTTC]),
    [
      ["CC-1L", "Coca-Cola 1L", 3, 20, 1, 57],
      ["IP-33", "Ice Passion 33cl", 4, 31, 0, 124],
    ],
  );
  // stored totals, never re-summed nor discounted a second time
  assert.equal(doc.subtotalHT, 150.83);
  assert.equal(doc.taxAmount, 30.17);
  assert.equal(doc.totalTTC, 181);
});

test("sale: counter sale, rounding, bank transfer and a partial credit are shown as recorded", () => {
  const counter = saleToPrintableInvoice(
    sale({ driver: null, truck: null, createdByUserName: "Caissier", roundingAmount: 0.5, totalTTC: 181.5, paymentMethod: "BANK_TRANSFER", bankAccountingAccountName: "Banque Populaire", paidAmount: 100, creditAmount: 81.5 }),
  );
  assert.equal(counter.issuerLabel, "Utilisateur");
  assert.equal(counter.issuerName, "Caissier");
  assert.equal(counter.truck, null);
  assert.equal(counter.roundingAmount, 0.5);
  assert.equal(counter.totalTTC, 181.5);
  assert.equal(counter.paymentLabel, "Virement (Banque Populaire)");
  assert.equal(counter.paidAmount, 100);
  assert.equal(counter.creditAmount, 81.5);
  assert.equal(saleToPrintableInvoice(sale({ customer: null })).partyName, "Client comptoir");
});

test("cancelled and draft invoices print with their status clearly flagged", () => {
  const cancelled = saleToPrintableInvoice(sale({ status: "CANCELLED" }));
  assert.equal(cancelled.statusLabel, "Annulée");
  assert.equal(cancelled.warning, "FACTURE ANNULÉE");
  assert.match(saleToPrintableInvoice(sale({ status: "DRAFT" })).warning ?? "", /BROUILLON/);
  assert.equal(saleToPrintableInvoice(sale({ status: "CREDIT_NOTED" })).statusLabel, "Avoir émis");
});

test("credit note: « AVOIR », negative amounts as in the invoice lists, payment « Rembourser »", () => {
  const doc = creditNoteToPrintableInvoice(creditNote());
  assert.equal(doc.kind, "CREDIT_NOTE");
  assert.equal(doc.title, "AVOIR");
  assert.equal(doc.number, "AC-20261015-000001");
  assert.equal(doc.statusLabel, "Avoir");
  assert.equal(doc.paymentLabel, "Rembourser");
  assert.equal(doc.relatedInvoice, "VD-000123");
  assert.deepEqual(doc.lines.map((l) => [l.reference, l.quantity, l.unitPriceTTC, l.totalTTC]), [["SOD", 2, 12, -24]]);
  assert.equal(doc.subtotalHT, -20);
  assert.equal(doc.taxAmount, -4);
  assert.equal(doc.totalTTC, -24);
  const reversed = creditNoteToPrintableInvoice(creditNote({ status: "CONTREPASSE" }));
  assert.equal(reversed.statusLabel, "Avoir annulé");
  assert.match(reversed.warning ?? "", /ANNULÉ/);
  const supplier = creditNoteToPrintableInvoice(creditNote({ partyType: "fournisseur", customerName: null, supplierName: "Fournisseur 1", supplierCode: "F1", invoiceNumber: null }));
  assert.equal(supplier.partyLabel, "Fournisseur");
  assert.equal(supplier.partyName, "Fournisseur 1");
  assert.equal(supplier.paymentLabel, "Rembourser");
});

test("A4 document: company, number, date, client, driver, truck, lines, totals, payment, status", () => {
  const markup = renderToStaticMarkup(<InvoicePrintDocument invoice={saleToPrintableInvoice(sale({ roundingAmount: 0.5, totalTTC: 181.5 }))} identity={identity} />);
  const out = text(markup);
  for (const expected of [
    "|COMDIS|",
    "|Limonad SARL|",
    "|12 rue des Oliviers - Casablanca|",
    "Tél. 0522000000 - contact@example.test",
    "|FACTURE|",
    "|N° 123/2026|",
    "|Epicerie Atlas (342115)|",
    "|Chauffeur :|Karim Chauffeur|",
    "|Camion :|CAM-7 - 12345-A-6|",
    "|Statut :|Payée|",
    "|Mode de règlement :|Espèces|",
    "|CC-1L|Coca-Cola 1L|Remise : 1,00 DH / unité|3|20,00 DH|57,00 DH|",
    "|IP-33|Ice Passion 33cl|4|31,00 DH|124,00 DH|",
    "|Total HT|150,83 DH|",
    "|TVA|30,17 DH|",
    "|Arrondi|",
    "|Total TTC|181,50 DH|",
    "|Date :|",
    "|Heure :|",
  ]) {
    assert.ok(out.includes(expected), expected);
  }
  assert.match(markup, /<img[^>]+class="ip-logo"/);
  // the printed document holds no navigation, button or form control
  assert.equal(/<(nav|button|input|select|a )/.test(markup), false);
});

test("A4 document of a credit note shows « AVOIR », the negative total and « Rembourser »", () => {
  const out = text(renderToStaticMarkup(<InvoicePrintDocument invoice={creditNoteToPrintableInvoice(creditNote())} identity={identity} />));
  assert.ok(out.includes("|AVOIR|"));
  assert.ok(out.includes("|Facture d'origine :|VD-000123|"));
  assert.ok(out.includes("|Total TTC|-24,00 DH|"));
  assert.ok(out.includes("|Mode de règlement :|Rembourser|"));
  const cancelled = text(renderToStaticMarkup(<InvoicePrintDocument invoice={saleToPrintableInvoice(sale({ status: "CANCELLED" }))} identity={null} />));
  assert.ok(cancelled.includes("|FACTURE ANNULÉE|"));
});

test("paper: A4, only the selected document is printed (no menu, sidebar, table or button), black on white", () => {
  assert.match(INVOICE_PRINT_CSS, /@page \{ size: A4 portrait;/);
  assert.match(INVOICE_PRINT_CSS, /body > \*:not\(\.invoice-print-root\) \{ display: none !important; \}/);
  // beats app/globals.css's print rule that hides everything but the POS ticket
  assert.match(read("../../app/globals.css"), /body \* \{\s+visibility: hidden !important;/);
  assert.match(INVOICE_PRINT_CSS, /\.invoice-print-root \* \{ visibility: visible !important; \}/);
  assert.match(INVOICE_PRINT_CSS, /\.invoice-print-root \{ display: none; \}/, "invisible on screen");
  assert.equal(/color: #(?!000|222|333|fff|eee)[0-9a-f]{3,6}/i.test(INVOICE_PRINT_CSS), false, "no colour that disappears in black and white");
  const component = code("./invoice-print.tsx");
  assert.match(component, /createPortal\(/);
  assert.match(component, /window\.setTimeout\(\(\) => window\.print\(\), 150\)/);
  assert.match(component, /\}, \[invoice\]\);/, "the print dialog opens once per document, never again on a re-render");
});

test("both admin menus: Voir détails, Imprimer la facture, then Annuler la facture (unchanged rights)", () => {
  const table = code("./invoices-table.tsx");
  const view = table.indexOf('{isCreditNote ? "Voir l\'avoir" : "Voir détails"}');
  const print = table.indexOf("Imprimer la facture");
  const cancel = table.indexOf('{isDraft ? "Supprimer" : "Annuler la facture"}');
  assert.ok(view > 0 && print > view && cancel > print, "order: view, print, cancel");
  assert.match(table, /onClick=\{\(\) => void printInvoice\(invoice\)\}/, "the row's own invoice");
  assert.match(table, /const canCancel = isAdmin && CANCELLABLE_STATUSES\.has\(invoice\.status\);/, "cancel rights unchanged");
  assert.match(table, /\{printElement\}/);
  // both pages render this very table
  assert.match(code("./orders-tab.tsx"), /<InvoicesTable invoices=\{items\} onSaleChanged=\{refetch\} \/>/);
  assert.match(code("./daily-invoices-view.tsx"), /<InvoicesTable invoices=\{data\.items\} onSaleChanged=\{refetch\} dailyLayout \/>/);
});

test("the admin print loads only the selected document, through the routes that already check the role and organisation", () => {
  const hook = code("./use-invoice-print.tsx");
  assert.match(hook, /fetch\(`\/api\/credit-notes\/\$\{encodeURIComponent\(item\.id\)\}`\)/);
  assert.match(hook, /fetchInvoiceDetail\("\/api\/sales", encodeURIComponent\(item\.id\)\)/);
  assert.equal(/method: "(POST|PATCH|DELETE)"/.test(hook), false, "read only");
  const sales = code("../../lib/server/driver-sales.ts");
  assert.match(sales, /export async function getSaleById\(id: string\): Promise<SaleDto> \{\s+const currentUser = await requireOrganizationUser\(\["admin", "depot_manager", "cashier"\]\);\s+const sale = await prisma\.sale\.findFirst\(\{\s+where: \{ id, organizationId: currentUser\.organizationId \},/);
});

test("driver: a visible « Imprimer » on each of HIS invoices, printing the sale already loaded for him only", () => {
  const view = code("../driver-pos/driver-sales-view.tsx");
  assert.match(view, /aria-label=\{`Imprimer la facture \$\{row\.sale\.displayNumber\}`\}/);
  assert.match(view, /void printInvoice\(row\.sale\);/);
  assert.match(view, /className="flex h-9 items-center gap-1\.5 rounded-xl/, "a real, touch-sized button with a label");
  // no new data access: the browser prints the row's own SaleDto; the Android app reuses the existing PDF print
  const printFn = view.slice(view.indexOf("async function printInvoice("), view.indexOf("function openDetail("));
  assert.equal(/fetch\(/.test(printFn), false);
  assert.match(printFn, /setPrintDocument\(saleToPrintableInvoice\(sale\)\);/);
  assert.match(printFn, /await shareInvoicePdf\(/);
  assert.match(printFn, /"print",/);
  // the list itself is the driver's own sales, and the single-sale route stays scoped to his driverId
  const sales = code("../../lib/server/driver-sales.ts");
  assert.match(sales, /where: \{ id, driverId: user\.driverId, organizationId: user\.organizationId \},/);
});

test("printing never writes: no sale, payment, stock or accounting call in the print code", () => {
  for (const path of ["./invoice-print.tsx", "./use-invoice-print.tsx", "../../lib/invoice-print.ts"]) {
    const source = code(path);
    assert.equal(/prisma|\/cancel|\/collect|method: "(POST|PATCH|PUT|DELETE)"/.test(source), false, path);
  }
});
