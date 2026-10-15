import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { InvoiceDetailInline } from "@/components/ventes/invoice-detail-inline";
import { InvoiceStatusBadge } from "@/components/ventes/invoice-status-badge";
import { paymentMethodLabels } from "@/components/ventes/orders-toolbar";
import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import type { SaleDto, SaleHistoryListItemDto, SaleLineDto } from "@/types/operations-dto";

/**
 * The compact unfolded detail of « Factures journalières » and « Archives des factures » (one shared component,
 * rendered by <InvoicesTable> in both pages): title + status badge, the products, ONE amount (Total TTC).
 */
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").split(String.fromCharCode(160)).join(" ");
const bodyRows = (markup: string) =>
  markup
    .split("<tr")
    .slice(2)
    .map((row) => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((cell) => cell[1].replace(/<[^>]+>/g, "").split(String.fromCharCode(160)).join(" ").trim()));

function line(id: string, productName: string, unitPriceHT: number, quantity: number, discount = 0): SaleLineDto {
  const totals = computeDiscountedLineTotals({ unitPriceHT, taxRate: 20, quantity, discountUnitAmount: discount });
  return {
    id,
    productId: `p-${id}`,
    productReference: `REF-${id}`,
    productName,
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

const coca = line("1", "Coca", 16.67, 3, 1); // 20,00 TTC, 1 DH off per unit -> 57,00
const ice = line("2", "Ice Passion 33cl", 25.83, 4); // 31,00 TTC -> 124,00

const sale = {
  id: "s1",
  displayNumber: "12/2026",
  createdAt: "2026-10-10T10:00:00.000Z",
  customer: { id: "c1", code: "3421", name: "Epicerie Atlas" },
  driver: { id: "d1", name: "Karim Chauffeur" },
  createdByUserName: "Caissier Comptoir",
  truck: { id: "t1", code: "CAM-77" },
  paymentMethod: "BANK_TRANSFER",
  bankAccountingAccountCode: "5141",
  bankAccountingAccountName: "Banque Populaire",
  subtotalHT: 150.83,
  taxAmount: 30.17,
  totalTTC: 181,
  roundingAmount: 0.5,
  lines: [coca, ice],
} as unknown as SaleDto;

const listItem = (over: Partial<SaleHistoryListItemDto> = {}): SaleHistoryListItemDto => ({
  id: "s1",
  invoiceNumber: "VC-1",
  displayNumber: "12/2026",
  posSessionId: null,
  status: "PAID",
  origin: "COUNTER",
  customer: { id: "c1", code: "3421", name: "Epicerie Atlas" },
  driver: null,
  articleCount: 7,
  totalTTC: 181,
  net: 150,
  paidAmount: 181,
  creditAmount: 0,
  paymentMethod: "BANK_TRANSFER",
  createdByUserName: "Caissier Comptoir",
  createdAt: "2026-10-10T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
  ...over,
});

const render = (item = listItem()) => renderToStaticMarkup(<InvoiceDetailInline listItem={item} sale={sale} />);

test("the general information block is gone: no N° commande, Date, Client, Chauffeur / utilisateur, Camion or Mode de règlement", () => {
  const out = text(render());
  for (const label of ["N° commande", "Date", "Client", "Chauffeur / utilisateur", "Camion", "Mode règlement", "Mode de règlement", "Compte bancaire"]) {
    assert.equal(out.includes(`|${label}|`), false, label);
  }
  // nor their values: they stay on the invoice row above
  for (const value of ["Epicerie Atlas", "Karim Chauffeur", "Caissier Comptoir", "CAM-77", paymentMethodLabels.BANK_TRANSFER, "Banque Populaire"]) {
    assert.equal(out.includes(value), false, value);
  }
});

test("the summary shows the Total TTC only: no Total HT, no TVA", () => {
  const markup = render();
  const out = text(markup);
  assert.equal(out.includes("|Total HT|"), false);
  assert.equal(out.includes("|TVA|"), false);
  assert.ok(out.includes("|Total TTC|"));
  assert.match(markup, /data-testid="invoice-detail-total">181,00\sDH</, "the invoice's stored Total TTC");
  // one amount, big and right-aligned
  assert.match(markup, /class="[^"]*justify-end[^"]*"/);
  assert.match(markup, /class="text-xl font-bold[^"]*"[^>]*data-testid="invoice-detail-total"/);
});

test("header: « Détail de la commande N° » and the current status badge", () => {
  const out = text(render());
  assert.ok(out.includes("|Détail de la commande 12/2026|"));
  assert.ok(out.includes(`|${text(renderToStaticMarkup(<InvoiceStatusBadge status="PAID" />)).replace(/\|/g, "")}|`));
  // an invoice that received an avoir keeps its own badge
  const credited = text(render(listItem({ status: "CREDIT_NOTED" })));
  assert.ok(credited.includes("|Avoir emis|"));
});

test("products, Prix TTC, quantities and line totals are unchanged", () => {
  const markup = render();
  const heads = [...markup.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((head) => head[1].replace(/<[^>]+>/g, "").trim());
  assert.deepEqual(heads, ["Produit", "Prix TTC", "Qté", "Total TTC"]);
  assert.deepEqual(bodyRows(markup), [
    ["Coca", "20,00 DH", "3", "57,00 DH"],
    ["Ice Passion 33cl", "31,00 DH", "4", "124,00 DH"],
  ]);
});

test("compact layout: no outer card wrapping the products card", () => {
  const markup = render();
  assert.equal((markup.match(/rounded-xl border/g) ?? []).length, 1, "a single bordered card (products + total)");
  assert.equal(markup.includes("rounded-2xl"), false);
});

test("both pages use this one detail, and the avoir rows keep « Rembourser » / « AVOIR » in the main row", () => {
  const table = read("./invoices-table.tsx");
  assert.match(table, /<InvoiceDetailInline listItem=\{invoice\} sale=\{expandedDetail\.sale\} \/>/);
  assert.match(read("./orders-tab.tsx"), /<InvoicesTable invoices=\{items\} onSaleChanged=\{refetch\} \/>/);
  assert.match(read("./daily-invoices-view.tsx"), /<InvoicesTable invoices=\{data\.items\} onSaleChanged=\{refetch\} dailyLayout \/>/);
  // credit note rows: never unfolded, payment and status shown on the row as before
  assert.match(table, /const isCreditNote = invoice\.kind === "CREDIT_NOTE";/);
  assert.match(table, /const expanded = !isCreditNote && expandedInvoiceId === invoice\.id;/);
  assert.match(table, /paymentMethodLabels\[invoice\.paymentMethod\] \?\? invoice\.paymentMethod/);
  assert.equal(paymentMethodLabels.REFUND, "Rembourser");
  assert.ok(text(renderToStaticMarkup(<InvoiceStatusBadge status="CREDIT_NOTE" />)).includes("Avoir"));
  // the row columns (total, net, payment...) are untouched
  assert.match(table, /formatCurrency\(invoice\.totalTTC\)/);
  assert.match(table, /formatCurrency\(invoice\.net\)/);
});
