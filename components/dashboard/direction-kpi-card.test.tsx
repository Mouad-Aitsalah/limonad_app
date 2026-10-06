import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DirectionKpiCard } from "@/components/dashboard/direction-kpi-card";
import {
  GEIST_BOLD_EM,
  KPI_UNKNOWN_CHAR_EM,
  KPI_VALUE_REFERENCE_EM,
  KPI_VALUE_SAFETY,
  kpiValueEm,
  kpiValueFontSize,
} from "@/components/dashboard/direction-kpi-value";
import { formatDashboardAmount } from "@/lib/dashboard-format";
import { KPI_TONES, KPI_VISUALS, kpiVisual } from "@/components/dashboard/direction-kpi-style";
import { DIRECTION_PERIOD_PRESETS, resolveDirectionPeriod } from "@/lib/dashboard-period";
import type { DirectionKpi } from "@/types/dashboard-direction";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

// ---- accent colours and icons (the palette of the brief) ---------------------------------

test("each KPI has its own soft accent: the palette of the brief", () => {
  const expected: Record<string, string> = {
    revenue: "green",
    "gross-margin": "blue",
    "estimated-result": "teal",
    "customer-receivables": "orange",
    "stock-value": "violet",
    "sales-count": "blue",
    "avg-basket": "violet",
    "purchases-ht": "cyan",
    "charges-ht": "red",
    "active-customers": "green",
  };
  for (const [id, tone] of Object.entries(expected)) assert.equal(kpiVisual(id).tone, tone, id);
  assert.equal(Object.keys(expected).length, 10);
  // the section "Intelligence & Prévisions IA" has its own two
  assert.equal(kpiVisual("forecast-units").tone, "violet");
  assert.equal(kpiVisual("forecast-revenue").tone, "green");
  // an unknown KPI still renders, in a neutral tone
  assert.equal(kpiVisual("something-new").tone, "slate");
});

test("the colours are pastel: a tinted circle (-50), a soft line (/70), never a solid saturated block", () => {
  for (const [tone, classes] of Object.entries(KPI_TONES)) {
    assert.match(classes.line, /^bg-[a-z]+-(300|400)\/70$/, tone);
    assert.match(classes.circle, /^bg-[a-z]+-50 ring-[a-z]+-100$/, tone);
    assert.match(classes.icon, /^text-[a-z]+-(500|600)$/, tone);
  }
  assert.ok(Object.keys(KPI_VISUALS).every((id) => KPI_VISUALS[id].icon), "every KPI has an icon");
});

// ---- the card --------------------------------------------------------------------------

const revenue: DirectionKpi = {
  id: "revenue",
  label: "Chiffre d'affaires",
  value: "14.718 DH",
  trend: { value: "+116,2 %", direction: "up" },
};

test("the card: white, rounded, a thin coloured line on top, the icon in a tinted circle at the top right", () => {
  const markup = renderToStaticMarkup(<DirectionKpiCard kpi={revenue} emphasis />);
  assert.match(markup, /data-kpi="revenue"/);
  assert.match(markup, /bg-white/);
  assert.match(markup, /rounded-\[22px\]/);
  assert.match(markup, /<span aria-hidden="true" data-kpi-line="true" class="[^"]*absolute inset-x-0 top-0 h-\[3px\][^"]*bg-emerald-400\/70/);
  // the icon sits in a circle (rounded-full) tinted with the accent, at the end of the header row
  assert.match(markup, /data-kpi-icon="true"[^>]*class="[^"]*rounded-full[^"]*bg-emerald-50 ring-emerald-100/);
  assert.match(markup, /<svg[^>]*stroke-width="1\.75"[^>]*text-emerald-600[^>]*aria-hidden="true"/, "a slightly finer stroke than lucide's default 2");
  assert.match(markup, /justify-between/);
  // very light shadow and a hairline border for the separation
  assert.match(markup, /border-slate-200\/60/);
  assert.match(markup, /shadow-\[0_1px_2px_rgb\(16_32_56\/0\.04\),0_10px_26px_-16px_rgb\(16_32_56\/0\.16\)\]/);
});

test("more generous inner spacing: 24 px, tightened to 20 px only in a very narrow card", () => {
  const markup = renderToStaticMarkup(<DirectionKpiCard kpi={revenue} />);
  assert.match(markup, /\[--kpi-pad:1\.25rem\] @min-\[12rem\]:\[--kpi-pad:1\.5rem\]/);
  assert.match(markup, /px-\(--kpi-pad\)/);
});

test("hierarchy: the figure dominates (28-32 px, bold, dark), then the label (13 px, grey), then the trend (11.5 px, muted)", () => {
  const markup = renderToStaticMarkup(<DirectionKpiCard kpi={revenue} emphasis />);
  const value = markup.match(/<p data-kpi-value="true"[^>]*>/)?.[0] ?? "";
  assert.match(value, /font-bold/);
  assert.match(value, /text-\[var\(--text-primary\)\]/);
  assert.match(value, /font-size:calc\(min\(2rem,/, "up to 32 px on the first row");
  assert.match(renderToStaticMarkup(<DirectionKpiCard kpi={revenue} />), /font-size:calc\(min\(1\.75rem,/, "up to 28 px on the second row");
  assert.match(markup, /<p class="[^"]*text-\[0\.82rem\][^"]*font-medium text-\[var\(--text-secondary\)\]">Chiffre d&#x27;affaires<\/p>/);
  assert.match(markup, /text-\[0\.72rem\] text-muted-foreground">vs période précédente/);
});

test("the card shows the server's value, trend and caption exactly as shaped - percentages keep their decimal", () => {
  const rendered = text(renderToStaticMarkup(<DirectionKpiCard kpi={revenue} emphasis />));
  assert.match(rendered, /Chiffre d'affaires/);
  assert.match(rendered, /14\.718 DH/);
  assert.match(rendered, /\+116,2 %/);
  assert.match(rendered, /vs période précédente/);

  const down = text(renderToStaticMarkup(<DirectionKpiCard kpi={{ ...revenue, id: "gross-margin", value: "1.261 DH", trend: { value: "-18,6 %", direction: "down" } }} />));
  assert.match(down, /-18,6 %/);
  assert.match(down, /1\.261 DH/);

  // a count stays a plain integer
  const count = text(renderToStaticMarkup(<DirectionKpiCard kpi={{ id: "sales-count", label: "Nombre de ventes", value: "31", trend: { value: "+102,9 %", direction: "up" } }} />));
  assert.match(count, /\b31\b/);
  assert.equal(/31[,.]\d/.test(count), false);

  // a KPI without trend shows its caption, and no comparison line
  const receivables = text(renderToStaticMarkup(<DirectionKpiCard kpi={{ id: "customer-receivables", label: "Créances clients", value: "5.664 DH", helper: "Solde actuel" }} />));
  assert.match(receivables, /Solde actuel/);
  assert.equal(/vs période précédente/.test(receivables), false);
});

test("every one of the 10 KPIs renders with its own icon circle and line colour", () => {
  const ids = ["revenue", "gross-margin", "estimated-result", "customer-receivables", "stock-value", "sales-count", "avg-basket", "purchases-ht", "charges-ht", "active-customers"];
  const lines = new Set<string>();
  for (const id of ids) {
    const markup = renderToStaticMarkup(<DirectionKpiCard kpi={{ id, label: id, value: "1 DH" }} />);
    assert.match(markup, /data-kpi-line/, id);
    assert.match(markup, /data-kpi-icon/, id);
    lines.add(KPI_TONES[kpiVisual(id).tone].line);
  }
  assert.equal(lines.size, 8 - 1, "seven distinct accent colours across the ten cards (blue, violet and green are shared as the brief asks)");
});

test("the figure is sized from the card width and its own width (container query), and never wraps", () => {
  const value = formatDashboardAmount(1548698.94); // "1.548.699 DH", wider than the reference
  const markup = renderToStaticMarkup(<DirectionKpiCard kpi={{ ...revenue, value }} emphasis />);
  assert.match(markup, /@container/);
  assert.match(markup, /data-kpi-value="true" class="whitespace-nowrap/);
  // its own width in em, in the card width minus its padding, at most 2rem, times the guard
  assert.match(markup, /font-size:calc\(min\(2rem, \(100cqw - 2 \* var\(--kpi-pad, 1\.5rem\)\) \/ 6\.228\) \* var\(--kpi-fit, 1\)\)/);
});

// Pixel size the CSS gives in a card whose figure has `available` px (card width - 2 x padding).
const sizeIn = (value: string, available: number, maxPx: number) => Math.min(maxPx, available / Math.max(KPI_VALUE_REFERENCE_EM, kpiValueEm(value)));

test("Geist widths: the figure is measured character by character (proportional digits), with a 2 % margin", () => {
  assert.equal(KPI_VALUE_SAFETY, 1.02);
  // Geist's digits are NOT equal: "1" is the narrowest, "0" the widest
  assert.ok(GEIST_BOLD_EM["1"] < 0.45 && GEIST_BOLD_EM["0"] > 0.65);
  // the separator formatDashboardAmount really puts before "DH" is known to the table
  const separator = [...formatDashboardAmount(1234)].find((character) => !/[\d.DH]/.test(character)) ?? "";
  assert.ok(separator in GEIST_BOLD_EM, `separator U+${separator.charCodeAt(0).toString(16)}`);
  // what the browser measured for these strings (Geist Bold, -0.03em, 1000 px): the estimate covers each of them
  const measured: Array<[string, number]> = [
    [formatDashboardAmount(142269), 5.2572],
    [formatDashboardAmount(1548699), 6.1132],
    [formatDashboardAmount(200000), 5.7562],
    [formatDashboardAmount(9022), 4.2982],
    [formatDashboardAmount(0), 2.2452],
    ["120 unités", 4.7732],
  ];
  for (const [value, real] of measured) assert.ok(kpiValueEm(value) >= real, `${value}: ${kpiValueEm(value).toFixed(3)} >= ${real}`);
  // an unexpected character never makes the estimate too small
  assert.ok(kpiValueEm("M") >= KPI_UNKNOWN_CHAR_EM);
});

test("every typical value shares the reference size (an even row); only a genuinely wider value is smaller", () => {
  // reference = a six-digit amount with average digits, "123.456 DH"
  assert.ok(Math.abs(KPI_VALUE_REFERENCE_EM - 5.451) < 0.001, KPI_VALUE_REFERENCE_EM.toFixed(4));
  const reference = kpiValueFontSize("39", 2);
  for (const value of [formatDashboardAmount(0), "7", "39", formatDashboardAmount(231), formatDashboardAmount(9022), formatDashboardAmount(142269), "120 unités"]) {
    assert.equal(kpiValueFontSize(value, 2), reference, value);
  }
  assert.notEqual(kpiValueFontSize(formatDashboardAmount(1548699), 2), reference);
  assert.match(kpiValueFontSize("39", 1.75), /^calc\(min\(1\.75rem, /);
});

test("desktop sizes: ~27 px at 1440 (147 px for the figure), ~22.6 px at 1280 (123 px), capped at 32 / 28 px on wide cards", () => {
  for (const value of ["39", formatDashboardAmount(9022), formatDashboardAmount(142269)]) {
    assert.ok(Math.abs(sizeIn(value, 147, 32) - 26.97) < 0.05, `${value} at 1440`);
    assert.ok(Math.abs(sizeIn(value, 123, 32) - 22.56) < 0.05, `${value} at 1280`);
    assert.equal(sizeIn(value, 293, 32), 32, `${value} on a phone (first row)`);
    assert.equal(sizeIn(value, 293, 28), 28, `${value} on a phone (second row)`);
  }
  // and the text always fits: estimated width x size <= available width
  for (const value of [formatDashboardAmount(142269), formatDashboardAmount(1548699), formatDashboardAmount(-1548699), "120 unités"]) {
    for (const available of [123, 147, 293]) {
      assert.ok(kpiValueEm(value) * sizeIn(value, available, 32) <= available + 1e-9, `${value} in ${available}px`);
    }
  }
});

test("the browser guard: it measures the figure and shrinks it through --kpi-fit only when it would overflow", () => {
  const value = read("./direction-kpi-value.tsx");
  assert.match(value, /^"use client";/);
  assert.match(value, /element\.style\.setProperty\("--kpi-fit", "1"\);/);
  assert.match(value, /if \(available > 0 && needed > available\) \{/);
  assert.match(value, /Math\.max\(0\.5, Math\.floor\(\(available \/ needed\) \* 100\) \/ 100\)/);
  assert.match(value, /new ResizeObserver\(onResize\)/);
  assert.match(value, /document\.fonts\?\.ready\.then\(fit\)/);
  assert.match(value, /return \(\) => observer\?\.disconnect\(\);/);
});

test("the header row has a fixed minimum height so the figures of a row line up even when a label wraps", () => {
  assert.match(renderToStaticMarkup(<DirectionKpiCard kpi={revenue} />), /min-h-10 items-start justify-between/);
  assert.match(renderToStaticMarkup(<DirectionKpiCard kpi={revenue} />), /h-full/);
});

// ---- the page: grid, order, nothing removed --------------------------------------------

test("the page keeps its ten KPIs in the same two rows of five, in a responsive grid", () => {
  const page = read("../../app/(dashboard)/dashboard/page.tsx");
  const first = ["revenue", "grossMargin", "estimatedResult", "customerReceivables", "stockValue"];
  const second = ["salesCount", "avgBasket", "purchasesHT", "chargesHT", "activeCustomers"];
  let cursor = 0;
  for (const key of [...first, ...second]) {
    const at = page.indexOf(`kpi={kpis.${key}}`, cursor);
    assert.ok(at >= cursor, `${key} is in order`);
    cursor = at;
  }
  assert.equal((page.match(/<div className=\{KPI_ROW_CLASS\}>/g) ?? []).length, 2);
  const rowClass = page.match(/const KPI_ROW_CLASS =\s*"([^"]+)"/)?.[1] ?? "";
  for (const needed of ["grid-cols-1", "sm:grid-cols-2", "xl:grid-cols-5", "gap-5"]) assert.ok(rowClass.includes(needed), needed);
  // the odd card of a row of five spans two columns on a tablet, and not on a wide screen
  assert.match(rowClass, /sm:\[&>\*:last-child:nth-child\(odd\)\]:col-span-2/);
  assert.match(rowClass, /xl:\[&>\*:last-child:nth-child\(odd\)\]:col-span-1/);
  // the five first cards keep their emphasis, the note between the rows is still there
  assert.equal((page.match(/ emphasis \/>/g) ?? []).length, 5);
  assert.match(page, /Résultat estimé : indicateur de gestion/);
});

// ---- the period filters: look only, same behaviour -------------------------------------

test("period filters: the seven buttons and their behaviour are unchanged, only the look is", () => {
  assert.deepEqual(
    DIRECTION_PERIOD_PRESETS.map((preset) => preset.label),
    ["Aujourd'hui", "Hier", "7 jours", "30 jours", "Ce mois", "Mois précédent"],
  );
  assert.deepEqual(DIRECTION_PERIOD_PRESETS.map((preset) => preset.key), ["today", "yesterday", "7d", "30d", "month", "prev_month"]);
  const custom = resolveDirectionPeriod({ from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual([custom.key, custom.label], ["custom", "Personnalisé"]);

  const bar = read("./direction-period-bar.tsx");
  // the same handlers, the same URL, the same rules
  assert.match(bar, /router\.replace\(`\$\{pathname\}\$\{buildDirectionPeriodQuery\(\{ period: key \}\)\}`\)/);
  assert.match(bar, /router\.replace\(`\$\{pathname\}\$\{buildDirectionPeriodQuery\(\{ from, to \}\)\}`\)/);
  assert.match(bar, /if \(!from \|\| !to\) return;/);
  assert.match(bar, /setCustomOpen\(false\);\s*goToPreset\(preset\.key\);/);
  assert.match(bar, /onClick=\{\(\) => setCustomOpen\(\(open\) => !open\)\}/);
  assert.match(bar, /disabled=\{!from \|\| !to\}/);
  assert.match(bar, /Personnalisé/);
  // the look: one white segmented control, active filled, the others quiet
  assert.match(bar, /role="group"/);
  assert.match(bar, /variant=\{active \? "default" : "ghost"\}/);
  assert.match(bar, /aria-pressed=\{active\}/);
});

// ---- the "Intelligence & Prévisions IA" section ----------------------------------------

test("the AI section takes the look of the KPI cards; its text and its figures are unchanged", () => {
  const view = read("./forecast/forecast-section-view.tsx");
  assert.match(view, /function ForecastSectionFrame/);
  assert.match(view, /bg-gradient-to-r from-violet-400\/80 via-blue-400\/70 to-emerald-400\/80/);
  assert.match(view, /rounded-full bg-violet-50 ring-1 ring-violet-100/);
  assert.match(view, /export const FORECAST_SECTION_TITLE = "Intelligence & Prévisions IA";/);
  // its currency figure keeps its cents: it is not one of the ten KPIs
  assert.match(view, /value: formatCurrency\(data\.revenue7Days\),/);
  assert.equal(/formatDashboardAmount/.test(view), false);
  // no forecast logic touched
  assert.equal(/buildSalesForecast|runPurchaseForecastSnapshot/.test(view), false);
});
