import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const view = readFileSync(new URL("./loadings-view.tsx", import.meta.url), "utf8");

test("the four-figure recap above the loaded products is gone", () => {
  assert.equal(/<MetricCard/.test(view), false);
  assert.equal(/function MetricCard/.test(view), false);
  assert.equal(/draftTotals/.test(view), false);
  assert.equal(/md:grid-cols-4/.test(view), false, "no recap grid left");
});

test("the rest of the open fiche is untouched: header, loaded products, per-line columns and the draft message", () => {
  assert.match(view, /openLoading\.displayNumber/);
  assert.match(view, /<LoadingStatusBadge status=\{openLoading\.status\} \/>/);
  assert.match(view, /Produits charges/);
  assert.match(view, /L&apos;enregistrement du brouillon met immediatement a jour le stock reel/);
  // the per-line columns (same labels, same sources) are still there
  assert.match(view, /<ResponsiveText desktop="Charge initiale" mobile="Charge" \/>/);
  assert.match(view, /Restante theorique<\/TableHead>/);
  assert.match(view, /desktop="Restante reelle" mobile="Stock réel"/);
  assert.match(view, /truckLevelsByProductId\[line\.productId\] \?\? 0/);
});
