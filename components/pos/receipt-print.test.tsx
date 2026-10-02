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

function html(sale: SaleDto, extra: { offlineReference?: string | null; paperWidth?: "58" | "80"; ruled?: boolean } = {}) {
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
  // (the only title rule with a font size is the DRIVER ticket's own 58mm one, scoped to .receipt-print-driver)
  const headSizeRules = [...css.matchAll(/([^{}]*\.receipt-print-head[^{]*)\{[^}]*font-size/g)].map((m) => m[1].trim());
  assert.ok(headSizeRules.every((selector) => selector.includes(".receipt-print-driver")), headSizeRules.join(" | "));
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

// ---------------------------------------------------------------------------
// Counter POS (PC) layout: `ruled` = dashed column separators, centred info block, centred PRIX TTC total
// ---------------------------------------------------------------------------

test("ruled: the total is PRIX TTC first, the real amount second, in one centred group", () => {
  const sale = saleOf([{ name: "A", unitTTC: 928, quantity: 1 }]);
  const markup = html(sale, { ruled: true });
  const match = markup.match(/<div class="receipt-print-total receipt-print-total-ruled"><span>PRIX TTC<\/span><strong>([^<]*)<\/strong><\/div>/);
  assert.ok(match, "label then amount");
  assert.equal(normalize(match[1]), normalize(html(sale).match(/<strong>(928[^<]*)<\/strong><span>TOTAL TTC/)![1]));
  assert.equal(markup.includes("TOTAL TTC"), false);
});

test("ruled: same rows, same data; only the table classes differ", () => {
  const sale = saleOf([{ name: "Coca", unitTTC: 40, quantity: 2 }, { name: "Fanta", unitTTC: 12.5, quantity: 3 }]);
  assert.deepEqual(rows(html(sale, { ruled: true })), rows(html(sale)));
  assert.match(html(sale, { ruled: true }), /receipt-print-ticket receipt-print-ruled/);
  assert.match(html(sale, { ruled: true }), /receipt-print-separator receipt-print-separator-flush/);
});

test("default (driver POS and everything else) is untouched: no ruled class, TOTAL TTC as before", () => {
  const markup = html(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }]));
  assert.equal(markup.includes("receipt-print-ruled"), false);
  assert.equal(markup.includes("PRIX TTC"), false);
  assert.match(markup, /<span>TOTAL TTC<\/span>/);
});

test("ruled CSS: exactly 3 DASHED vertical separators (borders, so they always print), no continuous rule left, scoped to the ruled ticket inside @media print", () => {
  const rule = ruleBody(".receipt-print-ruled .receipt-print-grid > span + span");
  assert.match(rule, /border-left: 1px dashed #000/);
  assert.equal(/solid/.test(rule), false, "no continuous vertical rule");
  assert.equal(css.includes("border-left: 1px solid #000"), false, "no solid vertical rule anywhere in the ticket CSS");
  assert.equal(css.includes(".receipt-print-ruled .receipt-print-grid > span {"), true);
  const printStart = css.lastIndexOf("@media print", css.indexOf(".receipt-print-ruled .receipt-print-grid > span + span"));
  assert.ok(printStart >= 0 && printStart < css.indexOf(".receipt-print-area {"));
  // 4 spans per row -> "span + span" gives a separator before columns 2, 3 and 4 only.
  const row = html(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }]), { ruled: true }).match(/<div class="receipt-print-grid receipt-print-head">(.*?)<\/div>/)![1];
  assert.equal((row.match(/<span/g) ?? []).length, 4);
  // the horizontal dashed separators are untouched
  assert.match(ruleBody(".receipt-print-separator"), /border-top: 1px dashed #000/);
});

test("ruled CSS: QTE / DESIGNATION get more room, the price and amount columns keep their exact widths", () => {
  const w80 = ruleBody('.receipt-print-area[data-document="sale"] .receipt-print-ruled .receipt-print-grid');
  assert.match(w80, /grid-template-columns: 8mm minmax\(0, 1fr\) 15mm 20mm/); // was 7mm for QTE
  const w58 = ruleBody('.receipt-print-area[data-document="sale"][data-paper="58"] .receipt-print-ruled .receipt-print-grid');
  assert.match(w58, /grid-template-columns: 6.5mm minmax\(0, 1fr\) 13mm 16mm/); // was 5mm
  assert.match(ruleBody(".receipt-print-ruled .receipt-print-grid > span:nth-child(2)"), /padding-left: 3mm/);
  // the plain ticket (driver POS) keeps its own widths
  assert.match(ruleBody('.receipt-print-area[data-document="sale"] .receipt-print-grid'), /grid-template-columns: 7mm minmax\(0, 1fr\) 15mm 20mm/);
});

test("ruled: the five info values are the SAME as the plain ticket, grouped in one centred block (x1.3 type)", () => {
  const sale = { ...saleOf([{ name: "Coca", unitTTC: 40, quantity: 2 }]), customer: { id: "c1", name: "Driss Chahboun", code: "3421/7" } } as unknown as SaleDto;
  const plain = html(sale);
  const ruled = html(sale, { ruled: true });
  assert.match(ruled, /receipt-print-meta-centered/);
  assert.equal(ruled.includes('class="receipt-print-meta"'), false);
  assert.equal(plain.includes("receipt-print-meta-centered"), false);
  const text = (markup: string) => markup.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
  for (const value of ["N° Facture : ", "Client : ", "Driss Chahboun", "N° client : "]) {
    assert.ok(text(ruled).includes(value), value);
    assert.ok(text(plain).includes(value), `plain: ${value}`);
  }
  // date and time are exactly the plain ticket's own strings
  const dateTime = ruled.match(/receipt-print-meta-datetime"><span>([^<]*)<\/span><span>([^<]*)<\/span>/)!;
  assert.ok(plain.includes(`>${dateTime[1]}<`) && plain.includes(`>${dateTime[2]}<`));
  assert.match(ruleBody(".receipt-print-meta-centered"), /font-size: 13px/);
  assert.match(ruleBody(".receipt-print-meta-centered"), /align-items: center/);
  assert.match(ruleBody('.receipt-print-area[data-paper="58"] .receipt-print-meta-centered'), /font-size: 11.7px/);
  assert.match(ruleBody(".receipt-print-meta-centered > div"), /overflow-wrap: anywhere/);
});

test("ruled CSS: PRIX TTC and the amount are centred together, amount larger; the amount value is untouched", () => {
  assert.match(ruleBody(".receipt-print-ruled .receipt-print-total-ruled"), /justify-content: center/);
  assert.match(ruleBody(".receipt-print-ruled .receipt-print-total-ruled > strong"), /font-size: 15px/);
  assert.equal(/margin: 0 0 0 auto/.test(css), false, "no far-right pushing left");
  const sale = saleOf([{ name: "A", unitTTC: 128, quantity: 1 }]);
  const amount = html(sale, { ruled: true }).match(/<span>PRIX TTC<\/span><strong>([^<]*)<\/strong>/)![1];
  assert.equal(normalize(amount), "128,00 DH");
});

// ---------------------------------------------------------------------------
// DRIVER ticket (plain ReceiptPrint): x1.3 type, bold, bigger total - and the counter POS ticket untouched
// ---------------------------------------------------------------------------

test("driver ticket: the plain ticket carries .receipt-print-driver, the counter (ruled) ticket never does", () => {
  const sale = saleOf([{ name: "A", unitTTC: 40, quantity: 2 }]);
  assert.match(html(sale), /receipt-print-ticket receipt-print-driver/);
  assert.equal(html(sale).includes("receipt-print-ruled"), false);
  assert.equal(html(sale, { ruled: true }).includes("receipt-print-driver"), false);
  // same data on both: only the class differs
  assert.deepEqual(rows(html(sale)), rows(html(sale, { ruled: true })));
});

test("driver CSS: every size is x1.3 of the former one, everything bold, the total is the biggest line", () => {
  assert.match(ruleBody(".receipt-print-ticket.receipt-print-driver"), /font-size: 13px/); // was 10px
  assert.match(ruleBody(".receipt-print-ticket.receipt-print-driver"), /font-weight: 700/);
  assert.match(ruleBody('.receipt-print-area[data-paper="58"] .receipt-print-ticket.receipt-print-driver'), /font-size: 11.7px/); // was 9px
  assert.match(ruleBody(".receipt-print-driver .receipt-print-brand"), /font-size: 20.8px/); // was 16px
  assert.match(ruleBody('.receipt-print-area[data-document="sale"]:not([data-paper="58"]) .receipt-print-driver .receipt-print-lines'), /font-size: 16.9px/); // was 13px
  const total = ruleBody(".receipt-print-driver .receipt-print-total");
  assert.match(total, /font-size: 20px/); // was 12px
  assert.match(total, /font-weight: 800/);
  assert.match(total, /flex-wrap: wrap/); // wraps instead of overlapping
  assert.match(ruleBody('.receipt-print-area[data-paper="58"] .receipt-print-driver .receipt-print-total'), /font-size: 14px/);
  assert.match(ruleBody(".receipt-print-driver .receipt-print-number"), /white-space: nowrap/);
  assert.match(ruleBody(".receipt-print-driver .receipt-print-product"), /max-height: 3.75em/); // 3 lines instead of 2
});

test("driver CSS: the bigger rows get wider price / amount columns on both paper widths (no lost digit)", () => {
  assert.match(ruleBody('.receipt-print-area[data-document="sale"] .receipt-print-driver .receipt-print-grid'), /grid-template-columns: 8mm minmax\(0, 1fr\) 18mm 22mm/);
  assert.match(ruleBody('.receipt-print-area[data-document="sale"][data-paper="58"] .receipt-print-driver .receipt-print-grid'), /grid-template-columns: 5.5mm minmax\(0, 1fr\) 13.5mm 16mm/);
  assert.match(ruleBody('.receipt-print-area[data-paper="58"] .receipt-print-driver .receipt-print-head'), /font-size: 9px/); // titles keep the former size on 58mm
  assert.match(ruleBody('.receipt-print-area[data-paper="58"] .receipt-print-driver .receipt-print-lines .receipt-print-number'), /font-size: 10.5px/);
  // 80mm: 76mm of content - 8 + 17 + 22 + 3 gaps leaves 25mm for the name; the 5 numeric characters of a 6-char amount at 16.9px bold fit 22mm
  const printable = 80 - 2 * 2;
  assert.ok(printable - (8 + 18 + 22 + 3) >= 25);
});

test("driver CSS: all the driver rules are scoped to .receipt-print-driver; the counter POS ticket's own rules did not move", () => {
  const start = css.indexOf("/* DRIVER ticket only");
  const end = css.indexOf('/* Unpaid ("facture du jour"');
  assert.ok(start > 0 && end > start);
  const block = css.slice(start, end);
  const selectors = [...block.matchAll(/^\s{2}([^\s/*@}][^{]*)\{/gm)].map((m) => m[1].trim());
  assert.ok(selectors.length >= 10);
  for (const selector of selectors) assert.ok(selector.includes(".receipt-print-driver"), selector);
  // the counter ticket (ruled) keeps its exact values
  assert.match(ruleBody('.receipt-print-area[data-document="sale"] .receipt-print-ruled .receipt-print-grid'), /grid-template-columns: 8mm minmax\(0, 1fr\) 15mm 20mm/);
  assert.match(ruleBody(".receipt-print-ruled .receipt-print-total-ruled > strong"), /font-size: 15px/);
  assert.match(ruleBody(".receipt-print-meta-centered"), /font-size: 13px/);
  // and the shared base ticket values are the original ones
  assert.match(ruleBody(".receipt-print-ticket"), /font-size: 10px/);
  assert.match(ruleBody(".receipt-print-total"), /font-size: 12px/);
});
