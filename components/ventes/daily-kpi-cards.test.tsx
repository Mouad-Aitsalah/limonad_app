import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DailyKpiCards } from "@/components/ventes/daily-kpi-cards";
import { layoutDailyKpis } from "@/lib/daily-invoice-kpis";
import { formatCurrency } from "@/lib/utils";
import type { DailyInvoicesKpisDto } from "@/types/daily-invoice";

// The cards render a regular space before "DH" (so it can wrap): compare like with like.
const money = (value: number) => formatCurrency(value).split(String.fromCharCode(160)).join(" ");

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

const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").split(String.fromCharCode(160)).join(" ");

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
  for (const value of [money(2600), money(1250.5), money(969.25), money(300), money(80.25), "42"]) {
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
  assert.equal(zeroOut.split(`|${money(0)}|`).length - 1, 5, "five amount cards at 0,00");
  assert.ok(zeroOut.includes("|0|"), "invoice count 0");

  const big = kpis({ revenueTotal: 12345678.9, byMethod: [{ method: "CASH", label: "Espèces", amount: 9876543.21 }, { method: "CREDIT", label: "Crédit", amount: 0.5 }] });
  const bigOut = text(renderToStaticMarkup(<DailyKpiCards kpis={big} />));
  assert.ok(bigOut.includes(money(12345678.9)));
  assert.ok(bigOut.includes(money(9876543.21)));
  assert.ok(bigOut.includes(money(0.5)));
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
  assert.ok(out.includes("Carte") && out.includes(money(75)));
  assert.equal(text(renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />)).includes("Autres modes"), false, "nothing extra when there is no other bucket");
});

test("the three main cards are visually promoted and responsive", () => {
  const markup = renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />);
  assert.match(markup, /grid grid-cols-2 gap-2\.5 sm:grid-cols-3 sm:gap-3 lg:gap-4/, "2 columns on phone, 3 on tablet and desktop");
  assert.match(markup, /col-span-2 sm:col-span-1/, "CA total spans the phone row only");
  assert.match(markup, /text-2xl[^"]*lg:text-4xl[^"]*text-emerald-700/, "green CA amount");
  assert.match(markup, /text-sky-700/, "blue cash");
  assert.match(markup, /text-violet-700/, "violet credit");
  assert.match(markup, /grid grid-cols-2 gap-2\.5 sm:grid-cols-3 sm:gap-3/, "secondary row");
  assert.match(markup, /text-base[^"]*sm:text-lg/, "secondary amounts are smaller than the main ones");
  assert.match(markup, /max-sm:hidden/, "secondary icons give their room to the amount on phones");
});

test("phones / tablets get compact cards; the desktop sizes are kept from lg", () => {
  const markup = renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />);
  // main cards: p-3 / gap-2 below lg, the original p-6 / gap-5 from lg
  assert.match(markup, /gap-2 [^"]*p-3 [^"]*lg:gap-5 lg:p-6/);
  // icon 32px -> 44px, amounts 18-24px -> the original 3xl / 4xl / 2.6rem
  assert.match(markup, /h-8 w-8[^"]*lg:h-11 lg:w-11/);
  assert.match(markup, /text-lg sm:text-xl lg:text-3xl xl:text-4xl/);
  assert.match(markup, /text-2xl lg:text-4xl xl:text-\[2\.6rem\]/);
  // secondary cards
  assert.match(markup, /px-3 py-2\.5[^"]*lg:px-4 lg:py-3/);
  // "Factures" is a full-width strip on phones: label left, figure right
  assert.match(markup, /max-sm:flex max-sm:w-full max-sm:items-center max-sm:justify-between/);
});

test("a long amount can drop its unit under the figure instead of splitting it", () => {
  const big = kpis({ revenueTotal: 12487500 });
  const markup = renderToStaticMarkup(<DailyKpiCards kpis={big} />);
  assert.equal(markup.includes(String.fromCharCode(160)), false, "no no-break space left in the cards");
  assert.ok(markup.includes("12.487.500,00 DH"));
});

test("filters: same three fields and handlers; phones get 40px touch heights and tighter gaps, desktop keeps its spacing", () => {
  const view = readFileSync(new URL("./daily-invoices-view.tsx", import.meta.url), "utf8");
  assert.match(view, /grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3/);
  assert.match(view, /space-y-1 lg:space-y-1\.5/);
  assert.match(view, /className="max-lg:h-10"\s*type="date"/);
  assert.match(view, /max-lg:data-\[size=default\]:h-10/);
  for (const kept of ["Journée", "Utilisateur", "Mode de règlement", "setDay(event.target.value || initialData.day)", "onChange={setUserIds}", "setPaymentMethod(value ?? \"all\")"]) {
    assert.ok(view.includes(kept), kept);
  }
  const userFilter = readFileSync(new URL("./daily-invoices-user-filter.tsx", import.meta.url), "utf8");
  assert.match(userFilter, /justify-between font-normal max-lg:h-10/);
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
