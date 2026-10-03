import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DailyKpiCards } from "@/components/ventes/daily-kpi-cards";
import { layoutDailyKpis } from "@/lib/daily-invoice-kpis";
import { formatCurrency } from "@/lib/utils";
import type { DailyInvoicesKpisDto } from "@/types/daily-invoice";

function kpis(overrides: Partial<DailyInvoicesKpisDto> = {}): DailyInvoicesKpisDto {
  const byMethod = [
    { method: "CASH", label: "Espèces", amount: 1250.5 },
    { method: "BANK_TRANSFER", label: "Virement", amount: 300 },
    { method: "CHECK", label: "Chèque", amount: 80.25 },
    { method: "CREDIT", label: "Crédit", amount: 969.25 },
  ];
  return {
    invoiceCount: 42,
    revenueTotal: 2600,
    byMethod,
    breakdownTotal: 2600,
    reconciled: true,
    ...overrides,
  };
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/[  ]/g, " ");

test("the figures are exactly the existing KPI values, only placed differently", () => {
  const data = kpis();
  const layout = layoutDailyKpis(data);
  assert.deepEqual(layout.primary, { revenueTotal: 2600, cash: 1250.5, credit: 969.25 });
  assert.deepEqual(layout.secondary, { invoiceCount: 42, transfer: 300, check: 80.25 });
  assert.deepEqual(layout.extras, []);
});

test("first row: CA total, Espèces, Crédit; second row: Factures, Virement, Chèque (in that order)", () => {
  const out = text(renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />));
  const order = ["CA total", "Espèces", "Crédit", "Factures", "Virement", "Chèque"].map((label) => out.indexOf(`|${label}|`));
  assert.ok(order.every((index) => index >= 0), `all labels present: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "display order");
});

test("each KPI shows its own amount (formatted like the rest of the app)", () => {
  const out = text(renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />));
  for (const value of [formatCurrency(2600), formatCurrency(1250.5), formatCurrency(969.25), formatCurrency(300), formatCurrency(80.25), "42"]) {
    assert.ok(out.includes(`|${value}|`), value);
  }
});

test("low, high and zero values all render (no empty card)", () => {
  const zero = kpis({
    invoiceCount: 0,
    revenueTotal: 0,
    byMethod: [
      { method: "CASH", label: "Espèces", amount: 0 },
      { method: "BANK_TRANSFER", label: "Virement", amount: 0 },
      { method: "CHECK", label: "Chèque", amount: 0 },
      { method: "CREDIT", label: "Crédit", amount: 0 },
    ],
    breakdownTotal: 0,
  });
  const zeroOut = text(renderToStaticMarkup(<DailyKpiCards kpis={zero} />));
  assert.equal(zeroOut.split(`|${formatCurrency(0)}|`).length - 1, 5, "five amount cards at 0,00");
  assert.ok(zeroOut.includes("|0|"), "invoice count 0");

  const big = kpis({ revenueTotal: 12345678.9, byMethod: [{ method: "CASH", label: "Espèces", amount: 9876543.21 }, { method: "CREDIT", label: "Crédit", amount: 0.5 }] });
  const bigOut = text(renderToStaticMarkup(<DailyKpiCards kpis={big} />));
  assert.ok(bigOut.includes(formatCurrency(12345678.9)));
  assert.ok(bigOut.includes(formatCurrency(9876543.21)));
  assert.ok(bigOut.includes(formatCurrency(0.5)));
});

test("a method missing from the data counts as 0, never as an error or a made-up value", () => {
  const layout = layoutDailyKpis(kpis({ byMethod: [] }));
  assert.deepEqual(layout.primary, { revenueTotal: 2600, cash: 0, credit: 0 });
  assert.deepEqual(layout.secondary, { invoiceCount: 42, transfer: 0, check: 0 });
});

test("other buckets reported by the server (Carte, Mixte...) stay visible instead of vanishing", () => {
  const data = kpis({
    byMethod: [
      ...kpis().byMethod,
      { method: "CARD", label: "Carte", amount: 75 },
      { method: "MIXED", label: "Mixte", amount: 20 },
    ],
  });
  assert.deepEqual(layoutDailyKpis(data).extras.map((b) => b.method), ["CARD", "MIXED"]);
  const out = text(renderToStaticMarkup(<DailyKpiCards kpis={data} />));
  assert.ok(out.includes("Autres modes"));
  assert.ok(out.includes("Carte") && out.includes(formatCurrency(75)));
  assert.equal(text(renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />)).includes("Autres modes"), false, "nothing extra when there is no other bucket");
});

test("the three main cards are visually promoted and responsive", () => {
  const markup = renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />);
  assert.match(markup, /grid gap-4 sm:grid-cols-2 lg:grid-cols-3/, "3 on one line on desktop, 2 columns on tablet, 1 on phone");
  assert.match(markup, /sm:col-span-2 lg:col-span-1/, "CA total spans the tablet row");
  assert.match(markup, /text-3xl[^"]*text-emerald-700/, "green CA amount");
  assert.match(markup, /text-sky-700/, "blue cash");
  assert.match(markup, /text-violet-700/, "violet credit");
  assert.match(markup, /grid grid-cols-2 gap-3 sm:grid-cols-3/, "secondary row");
  assert.match(markup, /text-base[^"]*sm:text-lg/, "secondary amounts are smaller than the main ones");
  assert.match(markup, /max-sm:hidden/, "secondary icons give their room to the amount on phones");
});

test("the page keeps its filters, table and data flow; the server and other screens are untouched", () => {
  const view = readFileSync(new URL("./daily-invoices-view.tsx", import.meta.url), "utf8");
  assert.match(view, /<DailyKpiCards kpis=\{kpis\} \/>/);
  for (const kept of ["DailyInvoicesUserFilter", "paymentMethodOptions", "useDailyInvoicesPage({ day, userIds, paymentMethod }, initialData)", "goToNextPage", "goToPreviousPage", "<InvoicesTable invoices={data.items} onSaleChanged={refetch} />", "kpis.reconciled"]) {
    assert.ok(view.includes(kept), kept);
  }
  const server = readFileSync(new URL("../../lib/server/daily-invoices.ts", import.meta.url), "utf8");
  assert.equal(/daily-invoice-kpis|DailyKpiCards/.test(server), false);
  for (const file of ["../pos/pos-layout.tsx", "../driver-pos/driver-pos-view.tsx"]) {
    assert.equal(/DailyKpiCards/.test(readFileSync(new URL(file, import.meta.url), "utf8")), false, file);
  }
});
