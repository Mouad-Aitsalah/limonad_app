import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { LoadingReceiptPrint } from "@/components/loadings/loading-receipt-print";
import { TABLE_COLUMNS } from "@/lib/table-labels/registry";
import {
  countedSummary,
  formatGap,
  gapTone,
  remainingGap,
  theoreticalRemaining,
} from "@/lib/truck-loading-remaining";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const text = (markup: string) => markup.replace(/<br\/?>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;|&#39;/g, "'");

// ---- Decalage = restant reel - restant theorique ---------------------------------------------

test("decalage: 75 vs 80 = -5 (manque), equal = 0 (concordance), above = +5 (surplus), not counted = no gap and a dash", () => {
  assert.equal(remainingGap(75, 80), -5);
  assert.equal(gapTone(-5), "shortage");
  assert.equal(formatGap(-5), "-5");
  assert.equal(remainingGap(80, 80), 0);
  assert.equal(gapTone(0), "match");
  assert.equal(formatGap(0), "0");
  assert.equal(remainingGap(85, 80), 5);
  assert.equal(gapTone(5), "surplus");
  assert.equal(formatGap(5), "+5");
  assert.equal(remainingGap(null, 80), null, "an absent count is never a real 0");
  assert.equal(remainingGap(0, 80), -80, "a real 0 IS a count");
  assert.equal(gapTone(null), "missing");
  assert.equal(formatGap(null), "—");
  assert.equal(formatGap(null, "-"), "-");
  assert.equal(remainingGap(10, null), null, "no theoretical, no gap");
});

test("restant theorique: frozen at the close, live on an open fiche, nothing on a cancelled one", () => {
  const line = { theoreticalRemainingQuantity: null, truckCurrentQuantity: 42, actualRemainingQuantity: null };
  assert.equal(theoreticalRemaining(line, "DRAFT"), 42, "open fiche: the truck stock now");
  assert.equal(theoreticalRemaining({ ...line, theoreticalRemainingQuantity: 30 }, "VALIDATED"), 30, "closed: the close figure, not today's stock");
  assert.equal(theoreticalRemaining(line, "CANCELLED"), null);
  assert.deepEqual(countedSummary([{ actualRemainingQuantity: 0 }, { actualRemainingQuantity: null }, { actualRemainingQuantity: 7 }]), { counted: 2, total: 3 });
});

// ---- printed ticket (browser, 80 mm) ---------------------------------------------------------

test("printed ticket: date, driver, truck, the 6 columns, dashes for a missing count, signed gaps, counted products", () => {
  const markup = renderToStaticMarkup(
    <LoadingReceiptPrint
      ticket={{
        date: "2026-10-12",
        driverName: "Karim",
        truckLabel: "CAM-01 - 123-A-1",
        lines: [
          { productName: "Coca 33", initialQuantity: 100, reloadedQuantity: 30, theoreticalQuantity: 80, actualQuantity: 75 },
          { productName: "Eau 1,5L", initialQuantity: 60, reloadedQuantity: 0, theoreticalQuantity: 12, actualQuantity: 12 },
          { productName: "Hawai", initialQuantity: 48, reloadedQuantity: 12, theoreticalQuantity: 30, actualQuantity: 35 },
          { productName: "Pom's", initialQuantity: 10, reloadedQuantity: 0, theoreticalQuantity: 4, actualQuantity: null },
        ],
      }}
    />,
  );
  const rendered = text(markup);
  assert.match(markup, /data-paper="80"/);
  assert.match(markup, /data-document="loading"/);
  assert.match(rendered, /Date : 12\/10\/2026 Chauffeur : Karim Camion : CAM-01 - 123-A-1/);
  assert.match(rendered, /PRODUIT CHARGE INIT\. RECH\. REST\. THÉO\. REST\. RÉEL DÉCAL\./);
  assert.match(rendered, /Coca 33 100 30 80 75 -5 Eau 1,5L 60 0 12 12 0 Hawai 48 12 30 35 \+5 Pom's 10 0 4 - -/);
  assert.match(rendered, /Produits comptés : 3 \/ 4/);
  // every row carries its tone for the print styles (bold shortage, bold italic surplus)
  assert.deepEqual([...markup.matchAll(/data-gap="(\w+)"/g)].map((m) => m[1]), ["shortage", "match", "surplus", "missing"]);
  assert.equal((markup.match(/class="receipt-print-loading-row"/g) ?? []).length + 1, (markup.match(/receipt-print-loading-row/g) ?? []).length, "one head row + 4 product rows");
});

test("print styles: dashed vertical separators between columns, dashed rules between products, aligned quantities, existing tickets untouched", () => {
  const css = read("../../app/globals.css");
  assert.match(css, /\.receipt-print-loading-row > span \+ span \{\s*border-left: calc\(1px \* var\(--loading-scale\)\) dashed #000;/);
  assert.match(css, /\.receipt-print-loading-row \{[^}]*border-bottom: calc\(1px \* var\(--loading-scale\)\) dashed #000;/);
  assert.match(css, /\.receipt-print-loading-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) 11\.5mm repeat\(4, 10\.2mm\);/);
  assert.match(css, /\.receipt-print-number,\s*\.receipt-print-right \{\s*text-align: right;\s*font-variant-numeric: tabular-nums;/);
  assert.match(css, /\[data-gap="shortage"\] \.receipt-print-loading-gap \{\s*font-weight: 800;/);
  // the invoice ticket rules are still there, unchanged
  assert.match(css, /\.receipt-print-area\[data-document="sale"\] \.receipt-print-ruled \.receipt-print-grid \{\s*grid-template-columns: 8mm minmax\(0, 1fr\) 15mm 20mm;/);
});

// ---- pages -------------------------------------------------------------------------------------

test("the transfer page: a « Décalage » column, the restant theorique read live, the counted indicator, a close that no longer requires every count", () => {
  const view = read("./loadings-view.tsx");
  assert.equal(TABLE_COLUMNS.loadingLines.columns.gap, "Décalage");
  assert.match(view, /<TableHead className="text-right max-lg:hidden">\{lineLabel\("gap"\)\}<\/TableHead>/);
  assert.match(view, /<GapCell gap=\{remainingGap\(line\.actualRemainingQuantity, lineTheoretical\(line\)\)\} \/>/);
  assert.match(view, /\{lineTheoretical\(line\) \?\? "—"\}/);
  assert.match(view, /truckCurrentQuantity: line\.truckCurrentQuantity,/, "refreshed from the server after every save");
  assert.match(view, /Produits comptes : \{countedSummary\(draftLines\)\.counted\} \/ \{draftLines\.length\}/);
  assert.doesNotMatch(view, /Veuillez saisir la quantite restante reelle pour tous les produits/);
  assert.match(view, /window\.confirm\(/, "missing counts are confirmed, not blocked");
  assert.match(view, /theoreticalQuantity: lineTheoretical\(line\),\s*actualQuantity: line\.actualRemainingQuantity,/, "the ticket prints the same figures");
});

test("the detail page: « Décalage » column, frozen theoretical, counted indicator, closed fiches editable without every count", () => {
  const detail = read("./loading-detail-view.tsx");
  assert.equal(TABLE_COLUMNS.loadingDetail.columns.gap, "Décalage");
  assert.match(detail, /<TableHead className="text-right">\{label\("gap"\)\}<\/TableHead>/);
  assert.match(detail, /const theoretical = theoreticalRemaining\(line, loading\.status\);/);
  assert.match(detail, /const gap = remainingGap\(line\.actualRemainingQuantity, theoretical\);/);
  assert.match(detail, /\{formatGap\(gap\)\}/);
  assert.match(detail, /label="Produits comptes"/);
  assert.doesNotMatch(detail, /Veuillez saisir la quantite restante reelle pour tous les produits/);
});

test("printed ticket is x1.4 through ONE mechanism (a CSS variable), scoped to the transfer ticket, paper unchanged", () => {
  const css = read("../../app/globals.css");
  const printBlock = css.slice(css.indexOf("@media print {"));
  // 80 mm paper, 2 mm padding (76 mm of content) - not touched
  assert.match(printBlock, /size: 80mm auto;/);
  assert.match(printBlock, /\.receipt-print-area \{[^}]*width: 80mm !important;[^}]*padding: 2mm !important;/);
  assert.match(printBlock, /\[data-document="loading"\] \{\s*box-sizing: border-box !important;\s*--loading-scale: 1\.4;\s*--loading-head-scale: 1\.2;/);
  // every enlarged size derives from the variable: former value * 1.4
  for (const rule of [
    /\.receipt-print-ticket \{\s*font-size: calc\(10px \* var\(--loading-scale\)\);/,
    /\.receipt-print-brand \{\s*font-size: calc\(16px \* var\(--loading-scale\)\);/,
    /\.receipt-print-loading-title \{\s*font-size: calc\(14px \* var\(--loading-scale\)\);/,
    /\.receipt-print-separator \{\s*margin: calc\(1\.8mm \* var\(--loading-scale\)\) 0;\s*border-top: calc\(1px \* var\(--loading-scale\)\) dashed #000;/,
    /\.receipt-print-loading-row \{[^}]*font-size: calc\(11px \* var\(--loading-scale\)\);/,
    /\.receipt-print-loading-note \{\s*font-size: calc\(8px \* var\(--loading-scale\)\);/,
    /\.receipt-print-loading-head \{[^}]*font-size: calc\(7\.5px \* var\(--loading-head-scale\)\);/,
  ]) {
    assert.match(printBlock, rule);
  }
  // no compounded scaling anywhere in the print rules of this ticket
  const loadingRules = printBlock.slice(printBlock.indexOf("--loading-scale: 1.4;"), printBlock.indexOf("Product columns, left to right"));
  assert.doesNotMatch(loadingRules.replace(/\/\*[\s\S]*?\*\//g, ""), /zoom|transform|scale\(/);
  // a product name is never clipped
  assert.match(loadingRules, /\[data-document="loading"\] \.receipt-print-product \{\s*max-height: none;/);
  // the shared ticket classes keep their former sizes for the other tickets
  assert.match(printBlock, /\.receipt-print-ticket \{\s*width: 100%;\s*color: #000;\s*font-family: Arial, system-ui, sans-serif;\s*font-size: 10px;/);
  assert.match(printBlock, /\.receipt-print-brand \{\s*font-size: 16px;/);
  assert.match(printBlock, /\.receipt-print-separator \{\s*margin: 1\.8mm 0;\s*border-top: 1px dashed #000;/);
});
