import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { InvoiceLinesTable } from "@/components/ventes/invoice-lines-table";
import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import type { SaleLineDto } from "@/types/operations-dto";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").split(String.fromCharCode(160)).join(" ").replace(/\s+/g, " ");

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

const lines = [
  line("1", "2L sidi ali", 16.67, 20, 5, 1), // 16.67 HT -> 20.00 TTC, 1.00 DH off per unit
  line("2", "Limonade 33cl", 15, 20, 20), // no discount: 18.00 TTC
  line("3", "Eau 1.5L (TVA 7%)", 4.67, 7, 6), // its own VAT rate: 4.67 x 1.07 = 5.00
];

test("columns: Produit | Quantité | Prix only - no Remise, no line Total", () => {
  const markup = renderToStaticMarkup(<InvoiceLinesTable lines={lines} />);
  assert.equal((markup.match(/<th /g) ?? []).length, 3);
  assert.match(text(markup), /Produit/);
  assert.match(markup, />Quantité</);
  assert.match(markup, />Qté</, "short label on a phone");
  assert.match(markup, /title="Prix unitaire TTC"[^>]*>Prix</);
  assert.equal(/Total/i.test(markup), false, "no line Total column");
  assert.equal(/Remise/i.test(markup), false, "no Remise column");
  assert.equal(/\/u\b/.test(markup), false, "no '1,00 DH/u' discount cell left");
  // every row has exactly 3 cells: no misaligned column
  for (const row of markup.split("<tr").slice(2)) {
    assert.equal((row.match(/<td /g) ?? []).length, 3);
  }
});

test("Prix is the normal unit price TTC with each line's own VAT rate, not the HT price", () => {
  const rendered = text(renderToStaticMarkup(<InvoiceLinesTable lines={lines} />));
  assert.match(rendered, /Limonade 33cl 20 18,00 DH/);
  assert.match(rendered, /Eau 1\.5L \(TVA 7%\) 6 5,00 DH/);
  assert.equal(rendered.includes("16,67"), false, "the HT unit price is not shown");
});

test("a discounted line still shows the catalogue price TTC (20,00 DH), never the discounted one (19,00 DH)", () => {
  const [discounted] = lines;
  // the discount is really there, in the persisted line totals: 5 x (20.00 - 1.00)
  assert.equal(discounted.totalTTC, 95);
  const rendered = text(renderToStaticMarkup(<InvoiceLinesTable lines={[discounted]} />));
  assert.equal(rendered.trim().endsWith("2L sidi ali 5 20,00 DH"), true, rendered);
  assert.equal(rendered.includes("19,00"), false, "the discount is not folded into the displayed price");
  assert.equal(rendered.includes("95,00"), false, "no line total displayed");
  assert.equal(rendered.includes("1,00"), false, "the discount itself is not displayed");
});

test("compact layout: the product takes the free width, numeric columns only their content, small paddings", () => {
  const markup = renderToStaticMarkup(<InvoiceLinesTable lines={lines} />);
  assert.match(markup, /<th[^>]*class="[^"]*w-full[^"]*"[^>]*>Produit/);
  assert.equal((markup.match(/<th[^>]*class="[^"]*w-px[^"]*text-right/g) ?? []).length, 2);
  assert.equal(/px-4|py-4|h-12/.test(markup), false, "the large default paddings are overridden");
  assert.match(markup, /whitespace-normal break-words/, "the product name wraps instead of scrolling on a phone");
  // nothing hidden on a phone any more but the long 'Quantité' label (-> 'Qté')
  assert.equal((markup.match(/max-sm:hidden/g) ?? []).length, 1);
});

test("the inline detail keeps the visible width of the scrollable invoice list (no detail lost off-screen)", () => {
  const list = read("./invoices-table.tsx");
  assert.match(list, /<div className="@container">\s*<Table>/);
  assert.match(list, /<TableCell colSpan=\{dailyLayout \? 10 : 11\} className="bg-muted\/10 p-0">/);
  assert.match(list, /<div className="sticky left-0 w-\[100cqw\] p-3 whitespace-normal sm:p-4">/);
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
  // the price reuses the invoice PDF's catalogue-price function, no new VAT logic, no discount
  const table = read("./invoice-lines-table.tsx");
  assert.match(table, /formatCurrency\(unitPriceTTCFromHT\(line\.unitPriceHT, line\.taxRate\)\)/);
  assert.match(read("../../lib/invoice-pdf.ts"), /unitPriceTTCFromHT\(line\.unitPriceHT, line\.taxRate\)/);
  assert.equal(/receiptUnitPriceTTC|reconstructDiscountUnitAmount|totalTTC/.test(table), false);
  assert.equal(/\* 1\.2|1\.2\b|taxRate \/ 100/.test(table), false, "no hard-coded VAT rate");
});
