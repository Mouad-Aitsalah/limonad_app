import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AnalysisKpiCard, AnalysisState, EmptyAnalysis, InfoHint } from "@/components/dashboard/commercial/analysis-ui";
import { CommercialAnalysisTabs } from "@/components/dashboard/commercial/commercial-analysis-tabs";
import { CoverageSection } from "@/components/dashboard/commercial/coverage-section";
import { SalesAnalysisSection } from "@/components/dashboard/commercial/sales-analysis-section";

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

test("the Dashboard block has two clearly titled sections, and only the first one is mounted (the other loads when opened)", () => {
  const markup = renderToStaticMarkup(<CommercialAnalysisTabs />);
  const content = text(markup);
  assert.match(content, /Analyse des ventes/);
  assert.match(content, /Couverture commerciale/);
  // the sales panel is shown at first; the coverage panel's own content (its week navigation) is not rendered yet
  assert.match(content, /Chauffeur/);
  assert.equal(/Semaine précédente|Précédente/.test(content), false);
});

test("sales section: the four filters are there from the first render, with a loading state", () => {
  const markup = renderToStaticMarkup(<SalesAnalysisSection />);
  const content = text(markup);
  for (const label of ["Chauffeur", "Mois", "Fournisseur", "Indicateur principal"]) {
    assert.match(content, new RegExp(label), label);
  }
  for (const metric of ["Quantité vendue", "Chiffre d'affaires", "Marge"]) {
    assert.match(content, new RegExp(metric), metric);
  }
  assert.match(markup, /role="status"/, "loading state");
  assert.equal(/role="alert"/.test(markup), false, "no error before anything failed");
});

test("coverage section: driver filter and week navigation are there from the first render, with a loading state", () => {
  const markup = renderToStaticMarkup(<CoverageSection />);
  const content = text(markup);
  assert.match(content, /Chauffeur/);
  assert.match(content, /Précédente/);
  assert.match(content, /Suivante/);
  assert.match(markup, /role="status"/);
});

test("shared states: an error is announced with a retry button, loading is a status, nothing otherwise", () => {
  const error = renderToStaticMarkup(<AnalysisState loading={false} error="Impossible de charger les données." onRetry={() => undefined} />);
  assert.match(error, /role="alert"/);
  assert.match(text(error), /Impossible de charger les données\./);
  assert.match(text(error), /Réessayer/);
  assert.match(renderToStaticMarkup(<AnalysisState loading onRetry={() => undefined} />), /role="status"/);
  assert.equal(renderToStaticMarkup(<AnalysisState loading={false} onRetry={() => undefined} />), "");
  assert.match(text(renderToStaticMarkup(<EmptyAnalysis>Aucune vente pour ces filtres.</EmptyAnalysis>)), /Aucune vente pour ces filtres\./);
});

test("KPI cards carry their explanation as a tooltip that is also readable without hovering", () => {
  const markup = renderToStaticMarkup(
    <AnalysisKpiCard id="margin" label="Marge totale" value="1 234 DH" hint="Chiffre d'affaires HT net moins le coût d'achat historique." />,
  );
  assert.match(markup, /data-kpi="margin"/);
  assert.match(markup, /title="Chiffre d&#x27;affaires HT net moins le coût d&#x27;achat historique\."/);
  assert.match(markup, /aria-label="Marge totale : /);
  assert.match(text(markup), /1 234 DH/);
  assert.equal(/role="note"/.test(renderToStaticMarkup(<AnalysisKpiCard id="x" label="L" value="V" />)), false, "no hint, no tooltip");
  assert.match(renderToStaticMarkup(<InfoHint text="t" label="l" />), /tabindex="0"/);
});
