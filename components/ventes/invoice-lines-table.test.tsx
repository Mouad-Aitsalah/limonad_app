import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { InvoiceLinesTable } from "@/components/ventes/invoice-lines-table";
import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import type { SaleLineDto } from "@/types/operations-dto";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").split(String.fromCharCode(160)).join(" ").replace(/\s+/g, " ");
/** The cells of each body row, in order. */
const bodyRows = (markup: string) =>
  markup
    .split("<tr")
    .slice(2)
    .map((row) => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((cell) => text(cell[1]).trim()));

/** A persisted line exactly as the POS computes it (HT stored, discount folded into totalTTC). */
function line(id: string, productName: string, unitPriceHT: number, taxRate: number, quantity: number, discount = 0): SaleLineDto {
  const totals = computeDiscountedLineTotals({ unitPriceHT, taxRate, quantity, discountUnitAmount: discount });
  return {
    id,
    productId: `p-${id}`,
    productReference: `REF-${id}`,
    productName,
    quantity,
    unitPriceHT,
    discountRate: totals.discountRate,
    discountAmount: totals.discountAmount,
    taxRate,
    taxAmount: totals.taxAmount,
    totalHT: totals.totalHT,
    totalTTC: totals.totalTTC,
  };
}

const coca = line("1", "Coca", 16.67, 20, 3, 1); // 16.67 HT -> 20.00 TTC, 1.00 DH off per unit
const ice = line("2", "Ice Passion 33cl", 25.83, 20, 4); // 25.83 HT -> 31.00 TTC, no discount
const eau = line("3", "Eau 1.5L (TVA 7%)", 4.67, 7, 6); // its own VAT rate: 4.67 x 1.07 = 5.00
const lines = [coca, ice, eau];

test("columns, in this exact order: Produit | Prix TTC | Qté | Total TTC - no Remise column", () => {
  const markup = renderToStaticMarkup(<InvoiceLinesTable lines={lines} />);
  assert.equal((markup.match(/<th /g) ?? []).length, 4);
  const heads = [...markup.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((head) => text(head[1]).trim());
  assert.deepEqual(heads, ["Produit", "Prix TTC", "Qté", "Total TTC"]);
  assert.equal(/Remise/i.test(markup), false, "no Remise column");
  assert.equal(/\/u\b/.test(markup), false, "no '1,00 DH/u' discount cell left");
  // every row has exactly 4 cells: no misaligned column
  for (const cells of bodyRows(markup)) assert.equal(cells.length, 4);
});

test("example: Coca (1 DH off per unit) | 20,00 DH | 3 | 57,00 DH - and Ice Passion 33cl | 31,00 DH | 4 | 124,00 DH", () => {
  const rows = bodyRows(renderToStaticMarkup(<InvoiceLinesTable lines={[coca, ice]} />));
  assert.deepEqual(rows, [
    ["Coca", "20,00 DH", "3", "57,00 DH"],
    ["Ice Passion 33cl", "31,00 DH", "4", "124,00 DH"],
  ]);
});

test("Prix is the normal unit price TTC with each line's own VAT rate, not the HT price", () => {
  const rows = bodyRows(renderToStaticMarkup(<InvoiceLinesTable lines={lines} />));
  assert.deepEqual(rows[2], ["Eau 1.5L (TVA 7%)", "5,00 DH", "6", "30,00 DH"]);
  assert.equal(text(renderToStaticMarkup(<InvoiceLinesTable lines={lines} />)).includes("16,67"), false, "the HT unit price is not shown");
});

test("a discounted line: Prix TTC stays the catalogue price (20,00 DH, never 19,00), Total TTC is the invoiced amount (57,00 DH, not 60,00)", () => {
  // the discount is really there, in the persisted line: 3 x (20.00 - 1.00)
  assert.equal(coca.totalTTC, 57);
  const rendered = text(renderToStaticMarkup(<InvoiceLinesTable lines={[coca]} />));
  assert.equal(rendered.trim().endsWith("Coca 20,00 DH 3 57,00 DH"), true, rendered);
  assert.equal(rendered.includes("19,00"), false, "the discount is not folded into the displayed price");
  assert.equal(rendered.includes("60,00"), false, "Total TTC is not recomputed from Prix x Qté");
  assert.equal(rendered.includes("1,00 DH"), false, "the discount itself is not displayed");
});

test("Total TTC is the stored line.totalTTC, never recomputed: historical roundings and the invoice total are kept (order 10/2026)", () => {
  // Order 10/2026 as stored (seed formula: quantity x HT x 1.2, no per-unit rounding).
  // Prix x Qté would give 125,97 / 129,56 / 599,96 / 167,98 = 1.023,47; the stored lines give 1.023,44.
  const stored = (id: string, name: string, ht: number, quantity: number, totalTTC: number): SaleLineDto => ({
    ...line(id, name, ht, 20, quantity),
    totalTTC,
  });
  const order = [
    stored("a", "Gants Gardien Select 88", 34.99, 3, 125.96),
    stored("b", "Barre Protéinée Chocolat", 26.99, 4, 129.55),
    stored("c", "Puma Future Ultimate FG", 124.99, 4, 599.95),
    stored("d", "Whey Gold Standard 2.27kg", 69.99, 2, 167.98),
  ];
  const rows = bodyRows(renderToStaticMarkup(<InvoiceLinesTable lines={order} />));
  assert.deepEqual(
    rows.map((row) => [row[1], row[2], row[3]]),
    [
      ["41,99 DH", "3", "125,96 DH"],
      ["32,39 DH", "4", "129,55 DH"],
      ["149,99 DH", "4", "599,95 DH"],
      ["83,99 DH", "2", "167,98 DH"],
    ],
  );
  const parse = (value: string) => Math.round(Number(value.replace(/[^\d,]/g, "").replace(",", ".")) * 100);
  assert.equal(rows.reduce((sum, row) => sum + parse(row[3]), 0), 102344, "the displayed lines add up to the invoice's Total TTC (1.023,44 DH)");
});

test("desktop: product takes the free width, numeric columns only their content, small paddings", () => {
  const markup = renderToStaticMarkup(<InvoiceLinesTable lines={lines} />);
  assert.match(markup, /<th[^>]*class="[^"]*w-full[^"]*"[^>]*>Produit/);
  assert.equal((markup.match(/<th[^>]*class="[^"]*w-px[^"]*text-right/g) ?? []).length, 3, "Prix, Qté, Total shrink to their content");
  assert.equal((markup.match(/<td[^>]*class="[^"]*w-px[^"]*text-right/g) ?? []).length, lines.length * 3);
  assert.equal(/px-4|py-4|h-12/.test(markup), false, "the large default paddings are overridden");
  assert.match(markup, /sm:px-3/, "desktop paddings stay small");
  assert.match(markup, /whitespace-normal break-words/, "the product name wraps instead of scrolling");
});

test("mobile: the four columns stay visible (nothing hidden), tighter paddings and font, no horizontal scroll", () => {
  const markup = renderToStaticMarkup(<InvoiceLinesTable lines={lines} />);
  assert.equal(/max-sm:hidden|hidden sm:|sm:hidden|\bhidden\b/.test(markup), false, "no column or label is hidden on a phone");
  assert.equal((markup.match(/<th /g) ?? []).length, 4);
  assert.match(markup, /<th[^>]*class="[^"]*px-1[^"]*"[^>]*>Prix TTC</, "numeric columns use 4px paddings on a phone");
  assert.match(markup, /<th[^>]*class="[^"]*px-1[^"]*"[^>]*>Total TTC</);
  assert.match(markup, /<td[^>]*class="[^"]*text-xs[^"]*sm:text-sm/, "smaller font on a phone");
  // the table never forces a width: no min-w on the table itself, and the product column can shrink
  assert.equal(/<table[^>]*class="[^"]*(min-w|w-\[)/.test(markup), false);
  assert.match(markup, /min-w-\[4\.5rem\]/, "the product column keeps a small minimum and wraps");
  const productCell = markup.match(/<td[^>]*>Coca<\/td>/)?.[0] ?? "";
  assert.match(productCell, /whitespace-normal/);
  assert.equal(/whitespace-nowrap/.test(productCell), false, "only the product name may wrap; the amounts never break");
});

test("the inline detail keeps the visible width of the scrollable invoice list, with tighter paddings on a phone", () => {
  const list = read("./invoices-table.tsx");
  assert.match(list, /<div className="@container">\s*<Table>/);
  assert.match(list, /<TableCell colSpan=\{dailyLayout \? 10 : 11\} className="bg-muted\/10 p-0">/);
  assert.match(list, /<div className="sticky left-0 w-\[100cqw\] p-2 whitespace-normal sm:p-4">/);
  assert.match(read("./invoice-detail-inline.tsx"), /rounded-2xl border border-border bg-muted\/20 p-3 sm:p-5/);
});

test("both order details (inline row and dialog) use this one table; nothing else changed in their totals", () => {
  for (const file of ["./invoice-detail-inline.tsx", "./invoice-detail-dialog.tsx"]) {
    const source = read(file);
    assert.match(source, /<InvoiceLinesTable lines=\{sale\.lines\} \/>/, file);
    assert.equal(/Remise|reconstructDiscountUnitAmount|unitPriceHT/.test(source), false, file);
    // the invoice totals block is untouched
    assert.match(source, /formatCurrency\(sale\.subtotalHT\)/, file);
    assert.match(source, /formatCurrency\(sale\.taxAmount\)/, file);
    assert.match(source, /formatCurrency\(sale\.totalTTC\)/, file);
  }
  // Prix TTC reuses the invoice PDF's catalogue-price function (no new VAT logic, no discount);
  // Total TTC reads the stored line amount and recomputes nothing.
  const table = read("./invoice-lines-table.tsx");
  const code = table.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /formatCurrency\(unitPriceTTCFromHT\(line\.unitPriceHT, line\.taxRate\)\)/);
  assert.match(code, /formatCurrency\(line\.totalTTC\)/);
  assert.match(read("../../lib/invoice-pdf.ts"), /unitPriceTTCFromHT\(line\.unitPriceHT, line\.taxRate\)/);
  assert.equal(/multiplyMoney|roundMoney|line\.quantity \*|\* line\.quantity|receiptUnitPriceTTC|reconstructDiscountUnitAmount|line\.discount/.test(code), false, "no recomputation, no discount");
  assert.equal(/\* 1\.2|1\.2\b|taxRate \/ 100/.test(code), false, "no hard-coded VAT rate");
});
