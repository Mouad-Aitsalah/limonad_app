import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  ForecastSectionSkeleton,
  ForecastSectionView,
  FORECAST_INDICATIVE_NOTE,
} from "@/components/dashboard/forecast/forecast-section-view";
import { formatComputedAt, formatForecastDay } from "@/lib/forecasting/forecast-format";
import type { DashboardForecastDto, DashboardForecastReady } from "@/types/dashboard-forecast";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .split(String.fromCharCode(160))
    .join(" ")
    .split("&#x27;")
    .join("'")
    .split("&amp;")
    .join("&")
    .replace(/\s+/g, " ");

// Test data only - nothing in this file is ever displayed by the application.
function ready(overrides: Partial<DashboardForecastReady> = {}): DashboardForecastReady {
  return {
    status: "ready",
    businessDay: "2026-10-03",
    isCurrent: true,
    computedAt: "2026-10-03T00:10:00.000Z",
    totalUnits7Days: 120,
    revenue7Days: 1450.5,
    daily: [
      { date: "2026-10-03", quantity: 20 },
      { date: "2026-10-04", quantity: 15 },
    ],
    rows: [
      {
        productId: "p1",
        reference: "COCA-2L",
        name: "Coca-Cola 2L pack très long nom",
        currentStock: 10,
        forecast7Days: 30,
        recommendedQuantity: 24,
        reliability: "sufficient",
        mae: 1.25,
        evaluable: true,
        noRecentSales: false,
        lastSaleDate: "2026-10-02",
        daysSinceLastSale: 0,
        stockRegularizationRequired: false,
        reason: "Le stock actuel (10) est inférieur au stock cible (34).",
      },
      {
        productId: "p2",
        reference: "عصير-1",
        name: "عصير البرتقال",
        currentStock: -3,
        forecast7Days: 8,
        recommendedQuantity: 0,
        reliability: "limited",
        mae: 0.5,
        evaluable: true,
        noRecentSales: false,
        lastSaleDate: null,
        daysSinceLastSale: null,
        stockRegularizationRequired: true,
        reason: "Stock négatif (-3) : à régulariser.",
      },
      {
        productId: "p3",
        reference: "EAU-5L",
        name: "Eau 5L",
        currentStock: 200,
        forecast7Days: 12,
        recommendedQuantity: 0,
        reliability: "very_limited",
        mae: null,
        evaluable: false,
        noRecentSales: true,
        lastSaleDate: "2026-08-25",
        daysSinceLastSale: 38,
        stockRegularizationRequired: false,
        reason: "Le stock actuel couvre le stock cible.",
      },
    ],
    hiddenRowCount: 0,
    reliabilityCounts: { sufficient: 1, limited: 1, very_limited: 1, none: 0 },
    quality: "limited",
    toOrderCount: 1,
    negativeStockCount: 1,
    noRecentSales: null,
    ...overrides,
  };
}

const render = (data: DashboardForecastDto) => text(renderToStaticMarkup(<ForecastSectionView data={data} />));

test("loading state: a labelled placeholder, no figure", () => {
  const markup = renderToStaticMarkup(<ForecastSectionSkeleton />);
  assert.match(markup, /data-testid="forecast-loading"/);
  assert.match(text(markup), /Chargement des prévisions/);
  assert.match(text(markup), /Intelligence & Prévisions IA/);
});

test("error state: a clear alert, and nothing else", () => {
  const markup = renderToStaticMarkup(<ForecastSectionView data={{ status: "error", message: "Les prévisions n'ont pas pu être chargées." }} />);
  assert.match(markup, /role="alert"/);
  assert.match(text(markup), /n'ont pas pu être chargées/);
  assert.equal(/Ventes prévues/.test(text(markup)), false);
});

test("empty states say what is missing instead of showing zeros", () => {
  const none = render({ status: "empty", reason: "no_snapshot" });
  assert.match(none, /Aucune prévision n'a encore été calculée/);
  assert.equal(/0 unités|0,00/.test(none), false);
  assert.match(render({ status: "empty", reason: "no_products" }), /assez d'historique/);
});

test("ready: both indicators, the chart block, the products, the last update and the indicative note", () => {
  const out = render(ready());
  assert.match(out, /Ventes prévues \(7 jours\)/);
  assert.match(out, /120 unités/);
  assert.match(out, /CA prévisionnel \(7 jours\)/);
  assert.match(out, /1\.450,50 DH/);
  assert.match(out, /Ventes prévues par jour/);
  for (const header of ["Référence", "Désignation", "Stock actuel", "Ventes prévues \\(7 j\\)", "Qté recommandée", "Fiabilité"]) {
    assert.match(out, new RegExp(header), header);
  }
  assert.match(out, /COCA-2L/);
  assert.match(out, /Coca-Cola 2L pack très long nom/);
  assert.match(out, /عصير البرتقال/);
  assert.ok(out.includes(FORECAST_INDICATIVE_NOTE));
  assert.match(out, /aucun bon de commande n'est créé/);
  assert.match(out, /Dernière mise à jour : 03\/10\/2026 à 0[12]:10/);
});

test("ready: quantities to order, negative stock and reliability levels are explicit", () => {
  const out = render(ready());
  assert.match(out, /24/);
  assert.match(out, /Stock à régulariser/);
  assert.match(out, /Aucun achat/);
  assert.match(out, /1 produit à réapprovisionner/);
  assert.match(out, /1 produit en stock négatif à régulariser avant tout achat/);
  for (const label of ["Fiable", "Limitée", "Très limitée"]) assert.ok(out.includes(label), label);
});

test("ready: the quality banner warns when the data is insufficient", () => {
  const out = render(
    ready({ quality: "insufficient", reliabilityCounts: { sufficient: 0, limited: 0, very_limited: 3, none: 0 } }),
  );
  assert.match(out, /Données insuffisantes/);
  assert.match(out, /purement indicatives/);
  assert.match(render(ready({ quality: "limited" })), /Qualité limitée/);
});

test("ready: without the stored per-day detail the chart is replaced by an explanation, not by invented bars", () => {
  const markup = renderToStaticMarkup(<ForecastSectionView data={ready({ daily: null })} />);
  assert.match(markup, /data-testid="forecast-no-daily"/);
  assert.match(text(markup), /détail par jour n'est pas encore disponible/);
});

test("ready: an earlier day's forecast is labelled as such; a missing time is stated, not invented", () => {
  const out = render(ready({ isCurrent: false, businessDay: "2026-10-02", computedAt: null }));
  assert.match(out, /Le calcul du jour n'est pas encore disponible : ce sont les prévisions du 02\/10\/2026/);
  assert.match(out, /calcul du 02\/10\/2026 \(heure non enregistrée\)/);
});

test("ready: hidden rows are counted; zero quantities render normally", () => {
  const out = render(
    ready({ hiddenRowCount: 7, totalUnits7Days: 0, revenue7Days: 0, toOrderCount: 0, negativeStockCount: 0 }),
  );
  assert.match(out, /\+ 7 autres produits non affichés/);
  assert.match(out, /0 unités/);
  assert.match(out, /0,00 DH/);
  assert.match(out, /Aucun réapprovisionnement nécessaire/);
});

test("responsive: a table from xl, one card per product below xl, no page-wide overflow", () => {
  const markup = renderToStaticMarkup(<ForecastSectionView data={ready()} />);
  assert.match(markup, /<div class="max-xl:hidden"><div[^>]*><table/);
  assert.match(markup, /<ul class="grid gap-2\.5 sm:grid-cols-2 xl:hidden" data-testid="forecast-mobile-list">/);
  assert.equal((markup.match(/<li /g) ?? []).length, 3);
  assert.match(markup, /sm:grid-cols-2/, "the two indicators sit side by side from sm");
});

test("formatting helpers", () => {
  assert.equal(formatForecastDay("2026-10-06"), "mar. 06/10");
  assert.match(formatComputedAt("2026-10-03T00:10:00.000Z"), /^03\/10\/2026 à 0[12]:10$/);
});

test("page wiring: the section sits after the indicator rows and before the charts, in a Suspense, only for authorised roles", () => {
  const page = read("../../../app/(dashboard)/dashboard/page.tsx");
  assert.match(page, /const showForecast = canViewForecast\(sessionUser\?\.role\);/);
  assert.match(page, /\{showForecast \? \(\s*<Suspense fallback=\{<ForecastSectionSkeleton \/>\}>\s*<DashboardForecastSection \/>\s*<\/Suspense>\s*\) : null\}/);
  const indicators = page.indexOf("kpis.activeCustomers");
  const section = page.indexOf("<DashboardForecastSection />");
  const charts = page.indexOf("<DirectionEvolutionChart");
  assert.ok(indicators > 0 && section > indicators && charts > section, "order: indicators < forecast < charts");
  // the existing sections are all still there
  for (const kept of ["DirectionPeriodBar", "DirectionCategoryChart", "DirectionTopProductsCard", "DirectionStockWatchCard", "DirectionTopCustomersCard", "DirectionWatchlistCard", "getDirectionDashboardData(params)"]) {
    assert.ok(page.includes(kept), kept);
  }
});

test("server wiring: session-scoped, admin + depot manager, the engine is never run on a page load", () => {
  const server = read("../../../lib/server/dashboard-forecast.ts");
  assert.match(server, /requireOrganizationUser\(FORECAST_VIEW_ROLES\)/);
  assert.match(server, /getDashboardForecastFor\(prisma, organizationId\)/);
  const reader = read("../../../lib/forecasting/dashboard-forecast.ts");
  for (const engine of ["buildSalesForecast", "buildPurchaseRecommendationsLive", "runPurchaseForecastSnapshot", "getPurchaseRecommendationsFor"]) {
    assert.equal(reader.includes(engine), false, `${engine} is not used by the dashboard read path`);
  }
});

test("accuracy: a MAE is shown only when it can be judged, otherwise \"Non évaluable\" (never a perfect 0)", () => {
  const out = render(ready());
  assert.match(out, /Précision/);
  assert.match(out, /± 1,25 u\.\/jour/);
  assert.match(out, /Non évaluable/);
  // a zero MAE that is not evaluable is not displayed as "± 0"
  const zero = render(
    ready({ rows: [{ ...ready().rows[0], mae: null, evaluable: false }], hiddenRowCount: 0 }),
  );
  assert.match(zero, /Non évaluable/);
  assert.equal(/± 0 u/.test(zero), false);
});

test("last sale: shown with its date and the days without sale when the product has no recent sales", () => {
  const out = render(ready());
  assert.match(out, /Dernière vente le 25\/08\/2026 \(38 jours sans vente\)/);
  // a product that sold recently shows no "last sale" line
  assert.equal((out.match(/Dernière vente le/g) ?? []).length, 2, "table + card of the one product without recent sales");
});

test("zero forecast because nothing sold recently: an explanatory message with the days and the last sale date", () => {
  const out = render(
    ready({
      totalUnits7Days: 0,
      revenue7Days: 0,
      noRecentSales: { daysWithoutSale: 38, lastSaleDate: "2026-08-25" },
    }),
  );
  assert.match(out, /Prévisions à 0 : aucune vente récente/);
  assert.match(out, /Aucune vente depuis 38 jours \(dernière vente le 25\/08\/2026\)/);
  assert.match(out, /L'historique existe/);
  assert.match(out, /0 unités/);
});

test("zero forecast message without a known date still explains, without inventing a figure", () => {
  const out = render(ready({ totalUnits7Days: 0, noRecentSales: { daysWithoutSale: null, lastSaleDate: null } }));
  assert.match(out, /Prévisions à 0 : aucune vente récente/);
  assert.match(out, /Aucune vente n'a été enregistrée sur la période récente/);
  assert.equal(/depuis \d+ jour/.test(out), false);
});

test("no explanatory message when the forecast is not zero", () => {
  const markup = renderToStaticMarkup(<ForecastSectionView data={ready()} />);
  assert.equal(markup.includes("forecast-no-recent-sales"), false);
});

test("singular: one day without sale", () => {
  const out = render(ready({ totalUnits7Days: 0, noRecentSales: { daysWithoutSale: 1, lastSaleDate: "2026-10-02" } }));
  assert.match(out, /Aucune vente depuis 1 jour \(dernière vente le 02\/10\/2026\)/);
});
