import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { InvoiceDetailInline } from "@/components/ventes/invoice-detail-inline";
import { InvoiceDiscountBadge } from "@/components/ventes/invoice-discount-badge";
import { formatCurrency } from "@/lib/utils";
import type { SaleDto, SaleHistoryListItemDto } from "@/types/operations-dto";

/**
 * The "REMISE" indicator in Archives des factures and Factures journalières:
 * the badge, the detail rows, and where it is wired. (The table and the dialog
 * need the router / auth context / a portal, so their markup is checked at the
 * source level, like the existing invoices-table tests.)
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").split(String.fromCharCode(160)).join(" ");

const listItem = (over: Partial<SaleHistoryListItemDto> = {}): SaleHistoryListItemDto => ({
  id: "s1",
  invoiceNumber: "VC-1",
  displayNumber: "12/2026",
  posSessionId: null,
  status: "PAID",
  origin: "COUNTER",
  customer: null,
  driver: null,
  articleCount: 2,
  totalTTC: 23,
  net: 23,
  paidAmount: 23,
  creditAmount: 0,
  paymentMethod: "CASH",
  createdByUserName: "Caissier",
  createdAt: "2026-10-10T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
  ...over,
});

const sale = {
  id: "s1",
  displayNumber: "12/2026",
  createdAt: "2026-10-10T10:00:00.000Z",
  customer: null,
  driver: null,
  createdByUserName: "Caissier",
  truck: null,
  paymentMethod: "CASH",
  subtotalHT: 19.17,
  taxAmount: 3.83,
  totalTTC: 23,
  roundingAmount: 0,
  lines: [],
} as unknown as SaleDto;

test("badge: a discreet REMISE tag that states the amount for accessibility", () => {
  const markup = renderToStaticMarkup(<InvoiceDiscountBadge amountTTC={1} />);
  assert.match(markup, />REMISE</);
  assert.match(markup, /rounded-full/);
  assert.ok(markup.includes(`Remise accordée sur cette facture : ${formatCurrency(1)}`));
  assert.match(renderToStaticMarkup(<InvoiceDiscountBadge />), /aria-label="Remise accordée sur cette facture"/);
});

test("inline detail (archives + daily rows): an invoice WITH a discount shows the badge, and the summary keeps only the Total TTC", () => {
  const markup = renderToStaticMarkup(<InvoiceDetailInline listItem={listItem({ hasDiscount: true, discountTTC: 1 })} sale={sale} />);
  const out = text(markup);
  assert.ok(out.includes("|REMISE|"));
  assert.ok(markup.includes(`Remise accordée sur cette facture : ${formatCurrency(1)}`), "the badge still states the amount");
  // compact summary: one amount only
  assert.ok(out.includes("|Total TTC|"));
  for (const removed of ["Total HT", "TVA", "Remise accordée (incluse)", "Arrondi", "Net (après avoirs)"]) {
    assert.equal(out.includes(`|${removed}|`), false, removed);
  }
});

test("inline detail: an invoice WITHOUT a discount (or a row the server did not flag) shows neither", () => {
  for (const item of [listItem(), listItem({ hasDiscount: undefined, discountTTC: undefined })]) {
    const markup = renderToStaticMarkup(<InvoiceDetailInline listItem={item} sale={sale} />);
    assert.equal(markup.includes("REMISE"), false);
    assert.equal(markup.includes("Remise accordée"), false);
  }
});

test("the table puts the badge beside the invoice number only when the row is flagged (archives and daily share it)", () => {
  const table = code("./invoices-table.tsx");
  assert.match(table, /\{invoice\.displayNumber\}\s+\{invoice\.hasDiscount \? <InvoiceDiscountBadge amountTTC=\{invoice\.discountTTC\} \/> : null\}/);
  assert.match(table, /import \{ InvoiceDiscountBadge \} from "@\/components\/ventes\/invoice-discount-badge";/);
  // no extra column: the detail row spans the chevron + the visible columns (lib/table-columns)
  assert.match(table, /colSpan=\{columns\.length \+ 1\}/);
  // both pages render this very table
  assert.match(code("./orders-tab.tsx"), /<InvoicesTable invoices=\{items\} onSaleChanged=\{refetch\} \/>/);
  assert.match(code("./daily-invoices-view.tsx"), /<InvoicesTable invoices=\{data\.items\} onSaleChanged=\{refetch\} dailyLayout \/>/);
  assert.match(code("./invoices-drilldown-dialog.tsx"), /<InvoicesTable invoices=\{items\} \/>/);
});

test("the detail dialog shows the badge and the discount row only for a flagged list item", () => {
  const dialog = code("./invoice-detail-dialog.tsx");
  assert.match(dialog, /\{listItem\.hasDiscount \? <InvoiceDiscountBadge amountTTC=\{listItem\.discountTTC\} \/> : null\}/);
  assert.match(dialog, /\{listItem\.hasDiscount && listItem\.discountTTC !== undefined \? \(/);
  assert.match(dialog, /Remise accordée \(incluse\)/);
  // it reads the flagged list row (staff-only data), never the SaleDto of the shared detail API
  assert.equal(/sale\.discountAmount|\.discountAmount/.test(dialog), false);
  // totals untouched
  for (const kept of ["formatCurrency(sale.subtotalHT)", "formatCurrency(sale.taxAmount)", "formatCurrency(sale.totalTTC)"]) assert.ok(dialog.includes(kept), kept);
});

test("the driver never gets the indicator: its history view builds list rows without the new fields", () => {
  const driverView = code("../driver-pos/driver-sales-view.tsx");
  assert.equal(/hasDiscount|discountTTC|InvoiceDiscountBadge/.test(driverView), false);
  // the dialog is shared with the driver, but it only renders what the row carries - and the driver's rows never carry it
  assert.match(driverView, /<InvoiceDetailDialog/);
  const dto = read("../../types/operations-dto.ts");
  assert.match(dto, /hasDiscount\?: boolean;/);
  assert.match(dto, /discountTTC\?: number;/);
});

test("the indicator changes no figure: no total, payment or stock code was touched", () => {
  for (const path of ["../../lib/server/counter-sales.ts", "../../lib/server/driver-sales.ts", "../../lib/server/sale-admin.ts", "../../lib/server/pending-sales.ts"]) {
    assert.equal(/sale-discount-indicator|hasDiscount|discountTTC/.test(code(path)), false, path);
  }
  const indicator = read("../../lib/sale-discount-indicator.ts");
  assert.equal(/prisma|fetch\(/.test(indicator), false, "pure, read-only helper");
});
