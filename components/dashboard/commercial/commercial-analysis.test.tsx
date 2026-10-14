import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AnalysisKpiCard, AnalysisState, EmptyAnalysis, InfoHint } from "@/components/dashboard/commercial/analysis-ui";
import { CommercialAnalysisTabs } from "@/components/dashboard/commercial/commercial-analysis-tabs";
import { CoverageSection } from "@/components/dashboard/commercial/coverage-section";
import {
  MultiSelectFilter,
  multiSelectSummary,
  normalizeSelection,
  selectionParam,
  type MultiSelectOption,
} from "@/components/dashboard/commercial/multi-select-filter";
import { SalesAnalysisSection } from "@/components/dashboard/commercial/sales-analysis-section";

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

test("the Dashboard block has two clearly titled sections, and only the first one is mounted (the other loads when opened)", () => {
  const markup = renderToStaticMarkup(<CommercialAnalysisTabs />);
  const content = text(markup);
  assert.match(content, /Analyse des ventes/);
  assert.match(content, /Couverture commerciale/);
  // the sales panel is shown at first; the coverage panel's own content (its week navigation) is not rendered yet
  assert.match(content, /Utilisateurs/);
  assert.equal(/Semaine précédente|Précédente/.test(content), false);
});

test("sales section: the four filters are there from the first render, with a loading state", () => {
  const markup = renderToStaticMarkup(<SalesAnalysisSection />);
  const content = text(markup);
  for (const label of ["Utilisateurs", "Tous les utilisateurs", "Mois", "Fournisseurs", "Tous les fournisseurs", "Indicateur principal"]) {
    assert.match(content, new RegExp(label), label);
  }
  for (const metric of ["Quantité vendue", "Chiffre d'affaires", "Marge"]) {
    assert.match(content, new RegExp(metric), metric);
  }
  assert.match(markup, /role="status"/, "loading state");
  assert.equal(/role="alert"/.test(markup), false, "no error before anything failed");
});

test("coverage section: users filter and week navigation are there from the first render, with a loading state", () => {
  const markup = renderToStaticMarkup(<CoverageSection />);
  const content = text(markup);
  assert.match(content, /Utilisateurs/);
  assert.match(content, /Tous les utilisateurs/);
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

const OPTIONS: MultiSelectOption[] = [
  { value: "none", label: "Sans fournisseur", special: true },
  { value: "s1", label: "Sidi Ali" },
  { value: "s2", label: "Jus SA" },
];

test("multi-select: the trigger says « all » for an empty selection, the name for one, a count beyond", () => {
  assert.equal(multiSelectSummary(OPTIONS, [], "Tous les fournisseurs", "fournisseurs"), "Tous les fournisseurs");
  assert.equal(multiSelectSummary(OPTIONS, ["s2"], "Tous les fournisseurs", "fournisseurs"), "Jus SA");
  assert.equal(multiSelectSummary(OPTIONS, ["s1", "none"], "Tous les fournisseurs", "fournisseurs"), "2 fournisseurs sélectionnés");
});

test("multi-select: selection kept in the options order, without repeats nor unknown values; stable query value", () => {
  assert.deepEqual(normalizeSelection(OPTIONS, ["s2", "ghost", "none", "s2"]), ["none", "s2"]);
  assert.equal(selectionParam(["s2", "s1", "s2"]), "s1,s2");
  assert.equal(selectionParam([]), "");
});

test("multi-select: the selected values are shown as removable chips; nothing selected = no chip", () => {
  const markup = renderToStaticMarkup(
    <MultiSelectFilter label="Fournisseurs" options={OPTIONS} value={["s1", "none"]} onChange={() => undefined} allLabel="Tous les fournisseurs" plural="fournisseurs" />,
  );
  const content = text(markup);
  assert.match(content, /2 fournisseurs sélectionnés/);
  assert.match(markup, /aria-label="Fournisseurs : sélection"/);
  assert.match(markup, /aria-label="Retirer Sans fournisseur"/);
  assert.match(markup, /aria-label="Retirer Sidi Ali"/);
  assert.equal(/Retirer Jus SA/.test(markup), false);
  const none = renderToStaticMarkup(
    <MultiSelectFilter label="Fournisseurs" options={OPTIONS} value={[]} onChange={() => undefined} allLabel="Tous les fournisseurs" plural="fournisseurs" />,
  );
  assert.match(text(none), /Tous les fournisseurs/);
  assert.equal(/: sélection/.test(none), false);
});

test("sales section source: users / suppliers sent as lists, « Sans fournisseur » only when such products exist, 4 products then all", () => {
  const source = readFileSync(new URL("./sales-analysis-section.tsx", import.meta.url), "utf8");
  assert.match(source, /params\.set\("userIds", userParam\)/);
  assert.match(source, /params\.set\("supplierIds", supplierParam\)/);
  assert.match(source, /shown\?\.hasProductsWithoutSupplier \? \[\{ value: NO_SUPPLIER, label: "Sans fournisseur"/);
  assert.match(source, /visibleProductRows\(shown\?\.products \?\? \[\], productsExpanded\)/);
  assert.match(source, /Voir tous les produits/);
  assert.match(source, /Réduire/);
});

test("coverage section source: « Non attribués » is an option of its own and a distinct block", () => {
  const source = readFileSync(new URL("./coverage-section.tsx", import.meta.url), "utf8");
  assert.match(source, /\{ value: UNASSIGNED, label: "Non attribués"/);
  assert.match(source, /data-unassigned/);
  assert.match(source, /shown\.unassigned/);
});
