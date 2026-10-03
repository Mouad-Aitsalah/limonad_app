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
  assert.match(markup, /grid grid-cols-2 gap-2\.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-2 lg:gap-4/, "2 columns on phone, 3 on tablet, 2 on desktop");
  assert.match(markup, /col-span-2 sm:col-span-1 lg:col-span-2 lg:w-1\/2 lg:justify-self-center/, "CA total: phone row, tablet cell, desktop first row centred");
  assert.match(markup, /text-2xl[^"]*lg:text-3xl[^"]*text-emerald-700/, "green CA amount");
  assert.match(markup, /text-sky-700/, "blue cash");
  assert.match(markup, /text-violet-700/, "violet credit");
  assert.match(markup, /grid grid-cols-2 gap-2\.5 sm:grid-cols-3 sm:gap-3/, "secondary row");
  assert.match(markup, /text-base[^"]*sm:text-lg/, "secondary amounts are smaller than the main ones");
  assert.match(markup, /max-sm:hidden/, "secondary icons give their room to the amount on phones");
});

test("phones / tablets get compact cards; the desktop sizes are kept from lg", () => {
  const markup = renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />);
  // main cards: p-3 / gap-2 below lg, a compact px-5 py-4 / gap-2.5 on desktop (was p-6 / gap-5)
  assert.match(markup, /gap-2 [^"]*p-3 [^"]*lg:gap-2\.5 lg:px-5 lg:py-4/);
  assert.equal(/lg:p-6|lg:gap-5/.test(markup), false);
  // icon 32px on phones, 36px on desktop (was 44px); amounts smaller on desktop (was 3xl-4xl / 4xl-2.6rem)
  assert.match(markup, /h-8 w-8[^"]*lg:h-9 lg:w-9/);
  assert.match(markup, /text-lg sm:text-xl lg:text-2xl xl:text-3xl/);
  assert.match(markup, /text-2xl lg:text-3xl xl:text-4xl/);
  assert.equal(/lg:h-11|xl:text-\[2\.6rem\]/.test(markup), false);
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

test("desktop: CA total alone and centred on the first row, Espèces + Crédit equal on the second; phones / tablets keep their classes", () => {
  const markup = renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />);
  // only the `lg:` utilities of the main grid and cards were touched: the phone / tablet ones are the previous ones
  for (const kept of ["grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3", "col-span-2 sm:col-span-1", "gap-2 rounded-2xl p-3", "h-8 w-8", "text-[13px]", "text-lg sm:text-xl", "text-2xl"]) {
    assert.ok(markup.includes(kept), kept);
  }
  // Espèces and Crédit take one column each (no col-span), so they have identical widths
  const cards = markup
    .split('<div class="flex min-w-0 flex-col justify-between')
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf('"')));
  assert.equal(cards.length, 3);
  assert.match(cards[0], /lg:col-span-2/);
  assert.equal(/col-span/.test(cards[1]) || /col-span/.test(cards[2]), false);
  // secondary row: still three columns, unchanged
  assert.ok(markup.includes("grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3\"") || markup.includes('grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3"'));
  assert.equal(/lg:grid-cols-3/.test(markup), false);
  // colours kept
  assert.match(markup, /text-emerald-700/);
  assert.match(markup, /text-sky-700/);
  assert.match(markup, /text-violet-700/);
});
