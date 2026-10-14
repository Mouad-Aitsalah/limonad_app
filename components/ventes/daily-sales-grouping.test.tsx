import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DailyKpiCards } from "@/components/ventes/daily-kpi-cards";
import { DailySalesGroupingView, SalesGroupingHeader, SalesGroupingReport } from "@/components/ventes/daily-sales-grouping-view";
import { formatMarkupRate, marginPartialNote } from "@/lib/daily-invoice-kpis";
import { formatCurrency } from "@/lib/utils";
import type { DailyInvoicesKpisDto, DailyMarginDto, DailySalesGroupingDto } from "@/types/daily-invoice";

/**
 * Lot 3 - the « Marge totale (HT) » card of the daily invoices and the dedicated
 * page « Regroupement des ventes » (static render of the real components).
 */

const money = (value: number) => formatCurrency(value).split(String.fromCharCode(160)).join(" ");
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").split(String.fromCharCode(160)).join(" ");
const read = (file: string) => readFileSync(file, "utf8");

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

/** What the server sends to a role WITHOUT the margin right: no margin field anywhere. */
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
      {
        productId: "p-oulmes",
        name: "Oulmès 1 L",
        reference: "OU1",
        priceGroups: [{ unitPriceTTC: 6, quantity: 2, amountTTC: 12 }],
        totalQuantity: 2,
        totalTTC: 12,
      },
    ],
    totals: { productCount: 2, totalQuantity: 6, linesTotalTTC: 91, roundingTotal: 0.5, revenueTotal: 91.5, reconciliationGap: 0, reconciled: true },
    userOptions: [{ id: "u1", name: "Chauffeur 1" }],
    ...over,
  };
}

/** The same report as the server sends it to the admin (margins at every level). */
function adminGrouping(): DailySalesGroupingDto {
  const base = grouping();
  return {
    ...base,
    products: [
      {
        ...base.products[0],
        priceGroups: [
          { ...base.products[0].priceGroups[0], margin: margin({ marginHT: 12.5, revenueHT: 50, markupRate: 25 }) },
          { ...base.products[0].priceGroups[1], margin: margin({ marginHT: 3.33, revenueHT: 15.83, markupRate: 21.04 }) },
        ],
        margin: margin(),
      },
      {
        ...base.products[1],
        priceGroups: [{ ...base.products[1].priceGroups[0], margin: margin({ marginHT: 0, revenueHT: 0, markupRate: null, partial: true, missingCostLines: 1 }) }],
        margin: margin({ marginHT: 0, revenueHT: 0, markupRate: null, partial: true, missingCostLines: 1 }),
      },
    ],
    margin: margin({ partial: true, missingCostLines: 1 }),
  };
}

const rowsOf = (markup: string, marker: string) =>
  markup.split(marker).slice(1).map((row) => text(row.slice(0, row.indexOf("</tr>"))));

// ---------- the daily invoices page: card and navigation ----------

test("« Marge totale (HT) » on the daily invoices: the amount on the left, the taux de marque on the right; no card without margin", () => {
  const markup = renderToStaticMarkup(<DailyKpiCards kpis={kpis({ margin: margin() })} />);
  const card = markup.slice(markup.indexOf('data-kpi="margin"'));
  assert.ok(card.indexOf("data-margin-amount") < card.indexOf("data-margin-rate"));
  assert.ok(text(card).includes(money(15.83)) && text(card).includes("24,1 %"));
  assert.equal(renderToStaticMarkup(<DailyKpiCards kpis={kpis()} />).includes("Marge"), false);
  assert.equal(formatMarkupRate(null), "—");
  assert.equal(marginPartialNote(margin()), null);
});

test("navigation: « Regroupement des ventes » is now a link to the dedicated page with the active filters - no modal any more", () => {
  const view = read("components/ventes/daily-invoices-view.tsx");
  assert.match(view, /<Link\s+href=\{dailySalesGroupingHref\(filters\)\}/);
  assert.match(view, /Regroupement des ventes/);
  assert.equal(/Dialog|DailySalesGroupingButton/.test(view), false, "no dialog in this path");
  assert.equal(existsSync("components/ventes/daily-sales-grouping-dialog.tsx"), false, "the modal component is gone");
  // and the daily page reads its filters back from the URL (the « Retour »)
  const page = read("app/(dashboard)/ventes/journalieres/page.tsx");
  assert.match(page, /initialFilters=\{dailyFiltersFromQuery\(query, initialData\.day\)\}/);
  assert.match(view, /window\.history\.replaceState\(window\.history\.state, "", href\)/, "the daily page keeps its URL in sync with its filters");
});

test("the dedicated page: same module guard, same server function (driver refused), filters read from the URL", () => {
  const page = read("app/(dashboard)/ventes/journalieres/regroupement/page.tsx");
  assert.match(page, /await requireModulePage\("dailyInvoices"\);/);
  assert.match(page, /getDailySalesGrouping\(/);
  assert.match(page, /dailyParamsFromSearchParams\(query\)/);
  const server = read("lib/server/daily-invoices.ts");
  assert.match(server, /export async function getDailySalesGrouping\([\s\S]*?requireOrganizationUser\(\["admin", "depot_manager", "cashier"\]\)/, "no driver");
  const layout = read("app/(dashboard)/layout.tsx");
  assert.match(layout, /allowedRoles=\{\["admin", "depot_manager", "cashier"\]\}\s+redirectTo="\/driver"/, "a driver opening the URL is sent back to /driver");
});

// ---------- header, filters, Retour ----------

test("header: breadcrumb Ventes / Factures journalières / Regroupement des ventes, title, subtitle, « Retour » at the top right keeping the filters", () => {
  const markup = renderToStaticMarkup(<SalesGroupingHeader backHref="/ventes/journalieres?day=2026-10-14&paymentMethod=CREDIT" />);
  assert.match(text(markup), /\|Ventes\|\/\|Factures journalières\|\/\|Regroupement des ventes\|Regroupement des ventes\|Détail des quantités, prix appliqués et marges par produit\|/);
  assert.match(markup, /href="\/ventes\/journalieres\?day=2026-10-14&amp;paymentMethod=CREDIT"[^>]*data-back-link|data-back-link[^>]*href="\/ventes\/journalieres\?day=2026-10-14&amp;paymentMethod=CREDIT"/);
  assert.ok(text(markup).includes("Retour aux factures journalières"));
  assert.match(markup, /sm:flex-row sm:items-start sm:justify-between/, "button on the right from 640 px");
});

test("filters: the SAME component as the daily invoices, plus « Appliquer »; the fetch uses the shared query", () => {
  const markup = renderToStaticMarkup(
    <DailySalesGroupingView initialData={grouping()} initialFilters={{ day: "2026-10-14", userIds: [], paymentMethod: "all" }} currentDay="2026-10-14" />,
  );
  for (const label of ["Journée", "Utilisateur", "Mode de règlement", "Appliquer"]) assert.ok(text(markup).includes(`|${label}|`), label);
  const view = read("components/ventes/daily-sales-grouping-view.tsx");
  assert.match(view, /<DailyInvoicesFilterFields/);
  assert.match(view, /fetch\(`\/api\/daily-invoices\/sales-grouping\?\$\{query\}`\)/);
  assert.match(view, /const query = dailyFiltersToQuery\(draft\);/);
  assert.match(view, /backHref=\{dailyInvoicesHref\(applied\)\}/, "« Retour » uses the applied filters");
});

// ---------- cards ----------

test("cards for a role without the margin right: CA total and Quantité vendue only, two per row", () => {
  const markup = renderToStaticMarkup(<SalesGroupingReport data={grouping()} />);
  const cards = markup.slice(markup.indexOf("data-grouping-cards"), markup.indexOf("Détail par produit"));
  assert.ok(text(cards).includes(`|CA total|${money(91.5)}|`));
  assert.ok(text(cards).includes("|Quantité vendue|6|"));
  assert.equal(/Marge|Taux de marque/.test(markup), false, "nothing about margins");
  assert.match(cards, /grid auto-rows-fr grid-cols-2 gap-2\.5 sm:gap-3 lg:gap-4"/);
});

test("cards for the admin: CA total, Quantité vendue, Marge totale (HT) (amount left, rate right) and Taux de marque - four on a computer, two per row on a phone", () => {
  const markup = renderToStaticMarkup(<SalesGroupingReport data={adminGrouping()} />);
  const cards = markup.slice(markup.indexOf("data-grouping-cards"), markup.indexOf("Détail par produit"));
  assert.match(text(cards), /\|CA total\|.*\|Quantité vendue\|.*\|Marge totale \(HT\)\|.*\|Taux de marque\|24,1 %\|/);
  assert.match(cards, /grid auto-rows-fr grid-cols-2 gap-2\.5 sm:gap-3 lg:gap-4 lg:grid-cols-4/);
  assert.ok(text(cards).includes("Marge partielle · 1 ligne sans coût (nul ou non renseigné) exclue du calcul"));
});

// ---------- table ----------

test("table: one row per applied price (never merged), a dedicated sub-total row per product, quantities and amounts exact", () => {
  const markup = renderToStaticMarkup(<SalesGroupingReport data={grouping()} />);
  assert.ok(text(markup).includes("Détail par produit et prix de vente"));
  assert.match(text(markup), /\|Produit\|Prix unitaire TTC\|Quantité\|Montant TTC\|/);
  const prices = rowsOf(markup, "data-price-row");
  assert.equal(prices.length, 3);
  assert.ok(prices[0].includes(`|${money(20)}|3|${money(60)}|`), prices[0]);
  assert.ok(prices[1].includes(`|${money(19)}|1|${money(19)}|`), prices[1]);
  const subtotals = rowsOf(markup, "data-product-total");
  assert.ok(subtotals[0].includes(`|Sous-total|2 prix|4|${money(79)}|`), subtotals[0]);
  assert.ok(subtotals[1].includes(`|Sous-total|1 prix|2|${money(12)}|`), subtotals[1]);
});

test("table for the admin: Marge HT and Taux de marque columns, per price and per product; a product without reliable cost shows « — »", () => {
  const markup = renderToStaticMarkup(<SalesGroupingReport data={adminGrouping()} />);
  assert.match(text(markup), /\|Produit\|Prix unitaire TTC\|Quantité\|Montant TTC\|Marge HT\|Taux de marque\|/);
  const prices = rowsOf(markup, "data-price-row");
  assert.ok(prices[0].includes(`|${money(60)}|${money(12.5)}|25,0 %|`), prices[0]);
  assert.ok(prices[2].includes(`|${money(12)}|—|—|`), prices[2]);
  const subtotals = rowsOf(markup, "data-product-total");
  assert.ok(subtotals[0].includes(`|${money(79)}|${money(15.83)}|24,1 %|`), subtotals[0]);
  assert.ok(subtotals[1].includes("Marge partielle"), subtotals[1]);
  assert.match(markup, /min-w-\[720px\]/);
});

test("totals: products, commercial rounding and CA total reconcile; a gap is shown as an alert, never hidden", () => {
  const ok = renderToStaticMarkup(<SalesGroupingReport data={grouping()} />);
  const totals = text(ok.slice(ok.indexOf("data-grouping-totals")));
  assert.ok(totals.includes(`Total des produits (6 unités)|${money(91)}`));
  assert.ok(totals.includes(`Arrondis commerciaux|${money(0.5)}`));
  assert.ok(totals.includes(`CA total|${money(91.5)}`));
  assert.equal(ok.includes("data-grouping-gap"), false);
  const gap = renderToStaticMarkup(<SalesGroupingReport data={grouping({ totals: { ...grouping().totals, reconciliationGap: 1, reconciled: false } })} />);
  assert.match(gap, /role="alert" data-grouping-gap/);
  assert.ok(text(gap).includes(`Écart de ${money(1)}`));
});

test("states: no sale, an API error (the previous figures stay, explicitly labelled)", () => {
  const empty = renderToStaticMarkup(
    <SalesGroupingReport data={grouping({ products: [], invoiceCount: 0, totals: { productCount: 0, totalQuantity: 0, linesTotalTTC: 0, roundingTotal: 0, revenueTotal: 0, reconciliationGap: 0, reconciled: true } })} />,
  );
  assert.ok(empty.includes("data-grouping-empty"));
  assert.ok(text(empty).includes("Aucune vente pour ces filtres."));
  const failed = renderToStaticMarkup(<SalesGroupingReport data={grouping()} error="Accès refusé." />);
  assert.match(failed, /role="alert" data-grouping-error/);
  assert.ok(text(failed).includes("Accès refusé. Les chiffres affichés sont ceux des filtres précédents."));
});

test("expand / collapse per product and « Tout réduire », a product search, and a phone-friendly table (sideways scroll inside the card)", () => {
  const markup = renderToStaticMarkup(<SalesGroupingReport data={grouping()} />);
  assert.equal((markup.match(/aria-expanded="true"/g) ?? []).length, 2, "every product starts expanded");
  assert.ok(text(markup).includes("Tout réduire"));
  assert.match(markup, /type="search"[^>]*aria-label="Rechercher un produit"|aria-label="Rechercher un produit"[^>]*type="search"/);
  assert.match(markup, /overflow-x-auto/);
  assert.match(markup, /min-w-\[520px\]/);
  const view = read("components/ventes/daily-sales-grouping-view.tsx");
  assert.match(view, /fold\(`\$\{product\.name\} \$\{product\.reference\}`\)\.includes\(fold\(search\.trim\(\)\)\)/, "accent-insensitive search on name and reference");
  assert.match(view, /les totaux ci-dessous portent sur tous les produits/, "a search never changes the totals");
});
