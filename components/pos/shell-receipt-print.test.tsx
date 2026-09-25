import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { computeDiscountedLineTotals } from "@/lib/pos-discount";
import type { SaleDto } from "@/types/operations-dto";

import { ReceiptPrint } from "./receipt-print";

// The Android shell has its own tsconfig (jsx "react", Vite env types): it is loaded
// at run time only, so the web type-check never has to resolve the shell's sources,
// and the shell's classic JSX runtime finds React.
(globalThis as { React?: typeof React }).React = React;
const SHELL_MODULE = "../../mobile/driver/src/components/shell-receipt-print";
const { ShellReceiptPrint } = createRequire(import.meta.url)(SHELL_MODULE) as {
  ShellReceiptPrint: (props: { sale: SaleDto | null; identity: null; offlineReference?: string | null }) => React.ReactElement | null;
};

type Item = { name: string; unitTTC: number; quantity: number; discountUnitAmount?: number; taxRate?: number };

/** A stored line exactly as the sale services compute it (DH per unit off the TTC price). */
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
    createdByUserName: "Chauffeur",
    payments: [],
    lines,
    ...overrides,
  } as unknown as SaleDto;
}

const shell = (sale: SaleDto, offlineReference: string | null = null) =>
  renderToStaticMarkup(<ShellReceiptPrint sale={sale} identity={null} offlineReference={offlineReference} />);

const normalize = (value: string) => value.replace(/[  ]/g, " ").trim();

function rows(markup: string): string[][] {
  const out: string[][] = [];
  for (const block of markup.split('class="receipt-print-line"').slice(1)) {
    out.push(
      [...block.matchAll(/<span class="receipt-print-(?:qty|product|number)">([^<]*)<\/span>/g)]
        .slice(0, 4)
        .map((match) => normalize(match[1])),
    );
  }
  return out;
}

test("A - no discount: 40 x 10 -> price 40,00, amount 400,00, no discount line", () => {
  const markup = shell(saleOf([{ name: "Produit X", unitTTC: 40, quantity: 10 }]));
  assert.deepEqual(rows(markup), [["10", "Produit X", "40,00", "400,00"]]);
  assert.equal(markup.includes("Remise"), false);
  assert.equal(markup.includes("receipt-print-discount"), false);
});

test("B - 40 - 1 DH/u: price 39,00, amount 390,00, no discount line", () => {
  const markup = shell(saleOf([{ name: "Produit X", unitTTC: 40, quantity: 10, discountUnitAmount: 1 }]));
  assert.deepEqual(rows(markup), [["10", "Produit X", "39,00", "390,00"]]);
  assert.equal(markup.includes("Remise"), false);
  assert.equal(markup.includes("DH/u"), false);
});

test("C - 24 - 2 DH/u x 20: price 22,00, amount 440,00", () => {
  const markup = shell(saleOf([{ name: "Produit X", unitTTC: 24, quantity: 20, discountUnitAmount: 2 }]));
  assert.deepEqual(rows(markup), [["20", "Produit X", "22,00", "440,00"]]);
  assert.equal(markup.includes("Remise"), false);
});

test("D - several products with different discounts", () => {
  const markup = shell(
    saleOf([
      { name: "A", unitTTC: 40, quantity: 10, discountUnitAmount: 1 },
      { name: "B", unitTTC: 24, quantity: 20, discountUnitAmount: 2 },
      { name: "C", unitTTC: 12, quantity: 5, discountUnitAmount: 0.5, taxRate: 10 },
    ]),
  );
  assert.deepEqual(rows(markup), [
    ["10", "A", "39,00", "390,00"],
    ["20", "B", "22,00", "440,00"],
    ["5", "C", "11,50", "57,50"],
  ]);
  assert.equal(markup.includes("Remise"), false);
});

test("E - a product without discount next to a discounted one", () => {
  const markup = shell(
    saleOf([
      { name: "Sans", unitTTC: 15.5, quantity: 3 },
      { name: "Avec", unitTTC: 40, quantity: 10, discountUnitAmount: 1 },
    ]),
  );
  assert.deepEqual(rows(markup), [
    ["3", "Sans", "15,50", "46,50"],
    ["10", "Avec", "39,00", "390,00"],
  ]);
  assert.equal(markup.includes("Remise"), false);
});

test("F - the EN ATTENTE DE REGLEMENT box above the table is gone; the footer status and the offline marker stay", () => {
  const draft = shell(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }], { status: "DRAFT", paidAmount: 0 }));
  assert.equal(draft.includes("receipt-print-pending"), false);
  assert.equal((draft.match(/EN ATTENTE DE REGLEMENT/g) ?? []).length, 1);
  assert.match(draft, /Statut : EN ATTENTE DE REGLEMENT/);
  const offline = shell(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }]), "OFF-1");
  assert.match(offline, /receipt-print-pending">TICKET HORS CONNEXION</);
  const paid = shell(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }]));
  assert.match(paid, /Statut :\s*Reglee/);
});

test("H - the total is printed amount first, TOTAL TTC second, same line", () => {
  const markup = shell(saleOf([{ name: "A", unitTTC: 928, quantity: 1 }]));
  const match = markup.match(/<div class="receipt-print-total"><strong>([^<]*)<\/strong><span>TOTAL TTC<\/span><\/div>/);
  assert.ok(match);
  assert.equal(normalize(match[1]), "928,00 DH");
});

test("the Android ticket prints exactly the same rows and total as the web ticket", () => {
  const sale = saleOf([
    { name: "A", unitTTC: 40, quantity: 10, discountUnitAmount: 1 },
    { name: "B", unitTTC: 24, quantity: 20, discountUnitAmount: 2 },
    { name: "C", unitTTC: 15.5, quantity: 3 },
  ]);
  const web = renderToStaticMarkup(<ReceiptPrint sale={sale} identity={null} />);
  const android = shell(sale);
  assert.deepEqual(rows(android), rows(web));
  const total = (markup: string) => markup.match(/receipt-print-total"><strong>([^<]*)</)?.[1];
  assert.equal(total(android), total(web));
  assert.equal(android.includes("Remise"), false);
  assert.equal(web.includes("Remise"), false);
});

// ---------------------------------------------------------------------------
// G - the shell's own print stylesheet (the one the APK uses)
// ---------------------------------------------------------------------------

const css = readFileSync(new URL("../../mobile/driver/src/styles.css", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const start = css.indexOf(selector + " {");
  assert.ok(start >= 0, `rule ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

test("G - the APK prints an 80 mm ticket: row VALUES are 1.3x (10px -> 13px), column titles keep their original size", () => {
  assert.match(shell(saleOf([{ name: "A", unitTTC: 40, quantity: 1 }])), /data-paper="80"/);
  assert.match(ruleBody(".receipt-print-ticket"), /font-size: 10px/);
  assert.match(
    ruleBody('.receipt-print-area[data-document="sale"]:not([data-paper="58"]) .receipt-print-lines'),
    /font-size: 13px/,
  );
  assert.equal(/font-size/.test(ruleBody(".receipt-print-head")), false);
  assert.equal(/\.receipt-print-head[^{]*\{[^}]*font-size/.test(css), false);
  assert.match(ruleBody('.receipt-print-area[data-document="sale"] .receipt-print-grid'), /grid-template-columns: 7mm minmax\(0, 1fr\) 15mm 20mm/);
});

test("the total rules are explicit and identical to the web ticket", () => {
  assert.match(ruleBody(".receipt-print-total"), /flex-direction: row/);
  assert.match(ruleBody(".receipt-print-total > strong"), /text-align: left/);
  assert.match(ruleBody(".receipt-print-total > span"), /text-align: right/);
  const web = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const body = (source: string, selector: string) => {
    const start = source.indexOf(selector + " {");
    return source.slice(start, source.indexOf("}", start)).replace(/\s+/g, " ");
  };
  for (const selector of [".receipt-print-total", ".receipt-print-total > strong", ".receipt-print-total > span"]) {
    assert.equal(body(css, selector), body(web, selector), selector);
  }
});
