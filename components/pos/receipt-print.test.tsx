import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import { receiptUnitPriceTTC } from "@/lib/receipt-line-price";
import type { SaleDto } from "@/types/operations-dto";

import { ReceiptPrint } from "./receipt-print";

type Item = { name: string; unitTTC: number; quantity: number; discountUnitAmount?: number; taxRate?: number };

/** A stored line exactly as createCounterSale would have computed it. */
function line(item: Item, index: number) {
  const taxRate = item.taxRate ?? 20;
  const unitPriceHT = item.unitTTC / (1 + taxRate / 100);
  const totals = computeDiscountedLineTotals({
    unitPriceHT,
    taxRate,
    quantity: item.quantity,
    discountUnitAmount: item.discountUnitAmount ?? 0,
  });
  return {
    id: `l${index}`,
    productId: `p${index}`,
    productName: item.name,
    productReference: `REF${index}`,
    quantity: item.quantity,
    unitPriceHT,
    taxRate,
    discountRate: totals.discountRate,
    discountAmount: totals.discountAmount,
    totalHT: totals.totalHT,
    taxAmount: totals.taxAmount,
    totalTTC: totals.totalTTC,
  };
}

function saleOf(items: Item[], overrides: Record<string, unknown> = {}): SaleDto {
  const lines = items.map(line);
  const totalTTC = lines.reduce((sum, l) => sum + l.totalTTC, 0);
  return {
    id: "s1",
    displayNumber: "33/2026",
    invoiceNumber: "VC-1",
    status: "PAID",
    paymentMethod: "CASH",
    paidAmount: totalTTC,
    creditAmount: 0,
    totalTTC,
    createdAt: "2026-09-25T10:00:00.000Z",
    validatedAt: "2026-09-25T10:00:00.000Z",
    customer: null,
    driver: null,
    createdByUserName: "Caissier",
    payments: [],
    lines,
    ...overrides,
  } as unknown as SaleDto;
}

function html(sale: SaleDto, extra: { offlineReference?: string | null; paperWidth?: "58" | "80" } = {}) {
  return renderToStaticMarkup(<ReceiptPrint sale={sale} identity={null} {...extra} />);
}

const normalize = (value: string) => value.replace(/[  ]/g, " ").trim();

/** [quantity, name, unit price, amount] of every printed product row. */
function rows(markup: string): string[][] {
  const out: string[][] = [];
  for (const block of markup.split('class="receipt-print-line"').slice(1)) {
    const cells = [...block.matchAll(/<span class="receipt-print-(?:qty|product|number)">([^<]*)<\/span>/g)]
      .slice(0, 4)
      .map((match) => normalize(match[1]));
    out.push(cells);
  }
  return out;
}

test("CAS 1 - no discount: normal price, no discount line", () => {
  const markup = html(saleOf([{ name: "Produit", unitTTC: 40, quantity: 10 }]));
  assert.deepEqual(rows(markup), [["10", "Produit", "40,00", "400,00"]]);
  assert.equal(markup.includes("Remise"), false);
  assert.equal(markup.includes("receipt-print-discount"), false);
});

test("CAS 2 - 1 DH/u discount: the printed price is 39,00 and no Remise line is printed", () => {
  const markup = html(saleOf([{ name: "Produit", unitTTC: 40, quantity: 10, discountUnitAmount: 1 }]));
  assert.deepEqual(rows(markup), [["10", "Produit", "39,00", "390,00"]]);
  assert.equal(markup.includes("Remise"), false);
  assert.equal(markup.includes("DH/u"), false);
});

test("CAS 3 - another discount: 24 - 2 = 22,00 x 20 = 440,00", () => {
  const markup = html(saleOf([{ name: "Produit", unitTTC: 24, quantity: 20, discountUnitAmount: 2 }]));
  assert.deepEqual(rows(markup), [["20", "Produit", "22,00", "440,00"]]);
  assert.equal(markup.includes("Remise"), false);
});

test("CAS 4 - several products: each one shows its own price after discount", () => {
  const markup = html(
    saleOf([
      { name: "A", unitTTC: 40, quantity: 10, discountUnitAmount: 1 },
      { name: "B", unitTTC: 24, quantity: 20, discountUnitAmount: 2 },
      { name: "C", unitTTC: 15.5, quantity: 3 },
      { name: "D", unitTTC: 12, quantity: 5, discountUnitAmount: 0.5, taxRate: 10 },
    ]),
  );
  assert.deepEqual(rows(markup), [
    ["10", "A", "39,00", "390,00"],
    ["20", "B", "22,00", "440,00"],
    ["3", "C", "15,50", "46,50"],
    ["5", "D", "11,50", "57,50"],
  ]);
  assert.equal(markup.includes("Remise"), false);
});

test("CAS 5 - no discount on any product: unchanged rendering", () => {
  const markup = html(saleOf([{ name: "A", unitTTC: 40, quantity: 2 }, { name: "B", unitTTC: 9.9, quantity: 4 }]));
  assert.deepEqual(rows(markup), [["2", "A", "40,00", "80,00"], ["4", "B", "9,90", "39,60"]]);
  assert.equal(markup.includes("Remise"), false);
});

test("the EN ATTENTE DE REGLEMENT box above the table is gone, the footer status stays", () => {
  const draft = html(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }], { status: "DRAFT", paidAmount: 0 }));
  assert.equal(draft.includes("receipt-print-pending"), false);
  assert.equal((draft.match(/EN ATTENTE DE RÈGLEMENT/g) ?? []).length, 1); // the footer status line only
  assert.match(draft, /Statut : EN ATTENTE DE RÈGLEMENT/);
  const paid = html(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }]));
  assert.match(paid, /Statut :\s*Réglée/);
  assert.match(paid, /Paiement : Espèces/);
});

test("an offline ticket keeps its own marker", () => {
  const markup = html(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }]), { offlineReference: "OFF-1" });
  assert.match(markup, /receipt-print-pending">TICKET HORS CONNEXION</);
});

test("the total is printed amount first, TOTAL TTC second, on the same line", () => {
  const markup = html(saleOf([{ name: "A", unitTTC: 928, quantity: 1 }]));
  const match = markup.match(/<div class="receipt-print-total"><strong>([^<]*)<\/strong><span>TOTAL TTC<\/span><\/div>/);
  assert.ok(match, "amount then label inside one .receipt-print-total");
  assert.equal(normalize(match[1]), "928,00 DH");
});

test("column titles and the rest of the ticket are still there", () => {
  const markup = html(saleOf([{ name: "A", unitTTC: 40, quantity: 2 }]));
  for (const label of ["QTE", "DESIGNATION", "Prix TTC", "Montant", "N° Facture : ", "Caisse : Caissier", "2 Articles"]) {
    assert.ok(markup.includes(label), label);
  }
});

// ---------------------------------------------------------------------------
// Print stylesheet: one @media print block, used by PC and phone alike
// ---------------------------------------------------------------------------

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const start = css.indexOf(selector + " {");
  assert.ok(start >= 0, `rule ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

test("row VALUES are 1.3x (10px -> 13px) on the 80 mm sale ticket; the column titles keep their original size", () => {
  const rowsRule = '.receipt-print-area[data-document="sale"]:not([data-paper="58"]) .receipt-print-lines';
  assert.match(ruleBody(rowsRule), /font-size: 13px/);
  assert.match(ruleBody(".receipt-print-ticket"), /font-size: 10px/);
  // Titles: no font size of their own anywhere (they inherit the ticket's 10px, as originally).
  assert.equal(/font-size/.test(ruleBody(".receipt-print-head")), false);
  assert.equal(/\.receipt-print-head[^{]*\{[^}]*font-size/.test(css), false);
  // The rows rule does not reach the titles: they are printed before, outside .receipt-print-lines.
  const markup = html(saleOf([{ name: "A", unitTTC: 40, quantity: 2 }]));
  const head = markup.indexOf("receipt-print-head");
  const lines = markup.indexOf("receipt-print-lines");
  assert.ok(head >= 0 && lines > head);
  assert.equal(markup.slice(lines).includes("receipt-print-head"), false);
  // Column widths are untouched.
  assert.match(ruleBody('.receipt-print-area[data-document="sale"] .receipt-print-grid'), /grid-template-columns: 7mm minmax\(0, 1fr\) 15mm 20mm/);
});

test("the total rules are explicit and sit inside the same print block as the ticket", () => {
  const printStart = css.lastIndexOf("@media print", css.indexOf(".receipt-print-total {"));
  assert.ok(printStart >= 0 && printStart < css.indexOf(".receipt-print-area {"));
  assert.match(ruleBody(".receipt-print-total"), /flex-direction: row/);
  assert.match(ruleBody(".receipt-print-total > strong"), /text-align: left/);
  assert.match(ruleBody(".receipt-print-total > span"), /text-align: right/);
});

// ---------------------------------------------------------------------------
// The printed price is display only and always agrees with the amount charged
// ---------------------------------------------------------------------------

test("quantity x printed unit price = printed amount, for every discount (sweep)", () => {
  let checked = 0;
  for (const priceCents of [100, 990, 1550, 2400, 4000, 12345, 92800]) {
    for (const taxRate of [0, 10, 20]) {
      for (const quantity of [1, 2, 3, 7, 10, 20]) {
        for (const discountCents of [0, 5, 50, 100, 200, 333]) {
          const stored = line(
            { name: "x", unitTTC: priceCents / 100, quantity, discountUnitAmount: discountCents / 100, taxRate },
            0,
          );
          const printed = Math.round(receiptUnitPriceTTC(stored) * 100) / 100;
          assert.equal(
            Math.round(quantity * printed * 100) / 100,
            Math.round(stored.totalTTC * 100) / 100,
            `${priceCents}/${taxRate}/${quantity}/${discountCents}`,
          );
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 700);
});

test("nothing is recomputed or stored: the helper is pure, a line without discount prints as before", () => {
  const stored = line({ name: "x", unitTTC: 40, quantity: 10 }, 0);
  const snapshot = JSON.stringify(stored);
  assert.equal(receiptUnitPriceTTC(stored), stored.unitPriceHT * (1 + stored.taxRate / 100));
  assert.equal(JSON.stringify(stored), snapshot);
});
