import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DailyKpiCards } from "@/components/ventes/daily-kpi-cards";
import { SalesGroupingContent, salesGroupingQuery } from "@/components/ventes/daily-sales-grouping-dialog";
import { formatMarkupRate, marginPartialNote } from "@/lib/daily-invoice-kpis";
import { formatCurrency } from "@/lib/utils";
import type { DailyInvoicesKpisDto, DailyMarginDto, DailySalesGroupingDto } from "@/types/daily-invoice";

/** Lot 3 - the « Marge totale (HT) » card and the « Regroupement des ventes » view (static render of the real components). */

const money = (value: number) => formatCurrency(value).split(String.fromCharCode(160)).join(" ");
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").split(String.fromCharCode(160)).join(" ");

function margin(over: Partial<DailyMarginDto> = {}): DailyMarginDto {
  return {
    marginHT: 15.83,
    revenueHT: 65.83,
    markupRate: 24.05,
    partial: false,
    totalRevenueHT: 65.83,
    excludedRevenueHT: 0,
    missingCostLines: 0,
    approximateCostLines: 0,
    ...over,
  };
}

function kpis(over: Partial<DailyInvoicesKpisDto> = {}): DailyInvoicesKpisDto {
  return {
    invoiceCount: 2,
    revenueTotal: 79,
    byMethod: [
      { method: "CASH", label: "Espèces", amount: 60 },
      { method: "BANK_TRANSFER", label: "Virement", amount: 0 },
      { method: "CHECK", label: "Chèque", amount: 0 },
      { method: "CREDIT", label: "Crédit", amount: 19 },
    ],
    breakdownTotal: 79,
    reconciled: true,
    ...over,
  };
}

test("« Marge totale (HT) » next to Espèces, Crédit, CA total: the amount on the left, the taux de marque on the right", () => {
  const markup = renderToStaticMarkup(<DailyKpiCards kpis={kpis({ margin: margin() })} />);
  const card = markup.slice(markup.indexOf('data-kpi="margin"'));
  assert.match(text(markup), /\|Espèces\|.*\|Crédit\|.*\|CA total\|.*\|Marge totale \(HT\)\|/, "fourth card, after CA total");
  const amountAt = card.indexOf("data-margin-amount");
  const rateAt = card.indexOf("data-margin-rate");
  assert.ok(amountAt > 0 && rateAt > amountAt, "amount first (left), rate second (right)");
  assert.match(card, /justify-between/);
  assert.ok(text(card).includes(money(15.83)));
  assert.ok(text(card).includes("24,1 %"));
  assert.match(markup, /grid auto-rows-fr grid-cols-2 gap-2\.5 sm:gap-3 lg:grid-cols-4 lg:gap-4/, "2 x 2 on phone and tablet, one row of four from 1024 px");
  assert.equal(card.includes("data-margin-partial"), false);
});

test("no margin in the data (any role but admin) -> no card and the original three-card layout, unchanged", () => {
  const markup = renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />);
  assert.equal(markup.includes("Marge"), false);
  assert.equal(markup.includes('data-kpi="margin"'), false);
  assert.match(markup, /grid auto-rows-fr grid-cols-2 gap-2\.5 sm:grid-cols-3 sm:gap-3 lg:gap-4/);
});

test("rate « — » when there is no CA HT, and a « Marge partielle » note naming the excluded lines", () => {
  assert.equal(formatMarkupRate(null), "—");
  assert.equal(formatMarkupRate(24.05), "24,1 %");
  const partial = margin({ partial: true, missingCostLines: 2, approximateCostLines: 1, markupRate: null, marginHT: 0, revenueHT: 0 });
  const markup = renderToStaticMarkup(<DailyKpiCards kpis={kpis({ margin: partial })} />);
  assert.ok(text(markup).includes("|—|"));
  assert.match(text(markup), /Marge partielle · 2 lignes sans coût \(nul ou non renseigné\), 1 ligne au coût approximatif/);
  assert.equal(marginPartialNote(margin()), null);
});

function grouping(over: Partial<DailySalesGroupingDto> = {}): DailySalesGroupingDto {
  return {
    day: "2026-10-14",
    dayLabel: "14/10/2026",
    invoiceCount: 2,
    products: [
      {
        productId: "p-sidi",
        name: "Sidi Ali 2 L",
        reference: "SA2",
        priceGroups: [
          { unitPriceTTC: 20, quantity: 3, amountTTC: 60 },
          { unitPriceTTC: 19, quantity: 1, amountTTC: 19 },
        ],
        totalQuantity: 4,
        totalTTC: 79,
      },
    ],
    totals: { productCount: 1, totalQuantity: 4, linesTotalTTC: 79, roundingTotal: 0.5, revenueTotal: 79.5, reconciliationGap: 0, reconciled: true },
    ...over,
  };
}

test("the grouping: one row per price (price, quantity, amount), then the product total, then products + rounding = CA total", () => {
  const markup = renderToStaticMarkup(<SalesGroupingContent data={grouping()} />);
  const rows = markup.split("data-price-row").slice(1).map((row) => text(row.slice(0, row.indexOf("</tr>"))));
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes(`|${money(20)}|3|${money(60)}|`), rows[0]);
  assert.ok(rows[1].includes(`|${money(19)}|1|${money(19)}|`), rows[1]);
  const total = markup.slice(markup.indexOf("data-product-total"));
  assert.ok(text(total).startsWith(`|Total|4|${money(79)}|`) || text(total).includes(`|Total|4|${money(79)}|`));
  const totals = text(markup.slice(markup.indexOf("data-grouping-totals")));
  assert.ok(totals.includes(`Total des produits (4 unités)|${money(79)}`));
  assert.ok(totals.includes(`Arrondis commerciaux|${money(0.5)}`));
  assert.ok(totals.includes(`CA total|${money(79.5)}`));
  assert.equal(markup.includes("Écart"), false);
  assert.equal(markup.includes("Marge"), false, "no margin sent -> none shown");
});

test("the grouping shows the margin per product and in total only when the server sent it; a reconciliation gap is shown", () => {
  const data = grouping({
    products: [{ ...grouping().products[0], margin: margin() }],
    margin: margin({ partial: true, missingCostLines: 1 }),
    totals: { ...grouping().totals, reconciliationGap: 1, reconciled: false },
  });
  const markup = renderToStaticMarkup(<SalesGroupingContent data={data} />);
  assert.equal((markup.match(/data-margin=""/g) ?? markup.match(/data-margin/g) ?? []).length >= 2, true);
  assert.ok(text(markup).includes("Marge totale (HT)"));
  assert.ok(text(markup).includes("Marge partielle · 1 ligne sans coût"));
  assert.ok(text(markup).includes("Écart de"));
});

test("the grouping is requested with exactly the active filters of the page", () => {
  assert.equal(salesGroupingQuery({ day: "2026-10-14", userIds: [], paymentMethod: "all" }), "day=2026-10-14");
  assert.equal(
    salesGroupingQuery({ day: "2026-10-14", userIds: ["u1", "u2"], paymentMethod: "CASH" }),
    "day=2026-10-14&userIds=u1%2Cu2&paymentMethod=CASH",
  );
  const view = readFileSync("components/ventes/daily-invoices-view.tsx", "utf8");
  assert.match(view, /<DailySalesGroupingButton filters=\{\{ day, userIds, paymentMethod \}\} \/>/);
  const dialog = readFileSync("components/ventes/daily-sales-grouping-dialog.tsx", "utf8");
  assert.match(dialog, /Regroupement des ventes/);
  assert.match(dialog, /fetch\(`\/api\/daily-invoices\/sales-grouping\?\$\{salesGroupingQuery\(filters\)\}`\)/);
});
