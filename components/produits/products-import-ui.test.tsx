import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ProductsImportPager } from "@/components/produits/products-import-pager";
import { ProductsImportProgress } from "@/components/produits/products-import-progress";
import { ProductsImportReport } from "@/components/produits/products-import-report";
import type { BatchRowResult, ImportProgress, ImportReportView } from "@/lib/products-import-batches";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&amp;|&#x27;|&#39;/g, "'");
const noop = () => undefined;

// ---- pager -----------------------------------------------------------------------------

test("pager: 'Page 1 / 50', the lines shown, ← Précédent  1 2 3 4 5 … 50  Suivant →", () => {
  const markup = renderToStaticMarkup(<ProductsImportPager page={1} pageCount={50} from={1} to={200} totalRows={10000} onPageChange={noop} />);
  const rendered = text(markup);
  assert.match(rendered, /Page 1 \/ 50 · lignes 1–200 sur 10 000/);
  assert.match(rendered, /← Précédent 1 2 3 4 5 … 50 Suivant →/);
  assert.match(markup, /aria-current="page"/);
  // previous is disabled on the first page, next is not
  assert.match(markup, /<button[^>]*\sdisabled=""[^>]*>← Précédent/);
  assert.equal(/<button[^>]*\sdisabled=""[^>]*>Suivant/.test(markup), false);
});

test("pager: in the middle and on the last page", () => {
  const middle = text(renderToStaticMarkup(<ProductsImportPager page={25} pageCount={50} from={4801} to={5000} totalRows={10000} onPageChange={noop} />));
  assert.match(middle, /Page 25 \/ 50 · lignes 4 801–5 000 sur 10 000/);
  assert.match(middle, /1 … 24 25 26 … 50/);
  const lastMarkup = renderToStaticMarkup(<ProductsImportPager page={50} pageCount={50} from={9801} to={10000} totalRows={10000} onPageChange={noop} />);
  assert.match(text(lastMarkup), /1 … 46 47 48 49 50 Suivant →/);
  assert.match(lastMarkup, /<button[^>]*\sdisabled=""[^>]*>Suivant/);
});

test("pager: a list that fits one page shows the count and no navigation", () => {
  const rendered = text(renderToStaticMarkup(<ProductsImportPager page={1} pageCount={1} from={1} to={130} totalRows={130} onPageChange={noop} />));
  assert.match(rendered, /Page 1 \/ 1 · lignes 1–130 sur 130/);
  assert.equal(/Précédent|Suivant/.test(rendered), false);
});

// ---- progress --------------------------------------------------------------------------

const progress = (over: Partial<ImportProgress> = {}): ImportProgress => ({
  total: 10000,
  processed: 7400,
  failedRows: 0,
  created: 7120,
  updated: 280,
  unchanged: 0,
  conflicts: 0,
  errors: 0,
  batchesDone: 37,
  batchesTotal: 50,
  ...over,
});

test("progress: 'Import des produits', 7 400 / 10 000, 74 %, Traités / Nouveaux / Mis à jour / Erreurs", () => {
  const markup = renderToStaticMarkup(<ProductsImportProgress progress={progress()} stopping={false} onStop={noop} />);
  const rendered = text(markup);
  assert.match(rendered, /Import des produits/);
  assert.match(rendered, /7 400 \/ 10 000/);
  assert.match(rendered, /74 %/);
  assert.match(rendered, /Traités : 7 400/);
  assert.match(rendered, /Nouveaux : 7 120/);
  assert.match(rendered, /Mis à jour : 280/);
  assert.match(rendered, /Erreurs : 0/);
  assert.match(rendered, /Lot 38 \/ 50/);
  assert.match(markup, /role="progressbar"[^>]*aria-valuenow="7400"/);
  assert.match(markup, /style="width:74%"/);
  assert.match(rendered, /Arrêter l'import/);
});

test("progress: counted on the lines really imported (8 000), failed lines are shown, 'stopping' is announced", () => {
  const rendered = text(
    renderToStaticMarkup(<ProductsImportProgress progress={progress({ total: 8000, processed: 3800, failedRows: 200, created: 3800, updated: 0, batchesDone: 20, batchesTotal: 40 })} stopping onStop={noop} />),
  );
  assert.match(rendered, /4 000 \/ 8 000/);
  assert.match(rendered, /50 %/);
  assert.match(rendered, /Lignes en échec : 200/);
  assert.match(rendered, /Arrêt après le lot en cours/);
});

// ---- final report ----------------------------------------------------------------------

const report = (over: Partial<ImportReportView> = {}): ImportReportView => ({
  title: "Import terminé",
  withProblems: false,
  created: 7000,
  updated: 1000,
  unchanged: 1000,
  conflicts: 0,
  errors: 0,
  failures: [],
  notProcessedRows: 0,
  categoriesCreated: 3,
  suppliersCreated: 2,
  stockMovementsCreated: 8000,
  ...over,
});

test("report: a clean run says 'Import terminé' with Nouveaux / Mis à jour / Inchangés / Conflits / Erreurs", () => {
  const rendered = text(renderToStaticMarkup(<ProductsImportReport report={report()} problemRows={[]} />));
  assert.match(rendered, /Import terminé(?! avec erreurs)/);
  for (const label of ["Nouveaux : 7 000", "Mis à jour : 1 000", "Inchangés : 1 000", "Conflits : 0", "Erreurs : 0"]) {
    assert.match(rendered, new RegExp(label));
  }
  assert.equal(/Lots en échec|Relancez/.test(rendered), false);
});

test("report: failed batches are never shown as a clean run - the batch and its Excel lines are listed", () => {
  const markup = renderToStaticMarkup(
    <ProductsImportReport
      report={report({
        title: "Import terminé avec erreurs",
        withProblems: true,
        failures: [{ batch: 12, rowCount: 200, firstRow: 2401, lastRow: 2600, message: "Import du lot impossible : connexion au serveur impossible." }],
        notProcessedRows: 200,
      })}
      problemRows={[]}
    />,
  );
  const rendered = text(markup);
  assert.match(rendered, /Import terminé avec erreurs/);
  assert.match(rendered, /Lots en échec/);
  assert.match(rendered, /Lot 12 — lignes Excel 2 401 à 2 600 \(200 lignes\) — Import du lot impossible/);
  assert.match(rendered, /Lignes non traitées : 200/);
  assert.match(rendered, /Relancez le même fichier/);
});

test("report: the refused-lines list is capped at 100 (1 000 problems must not become 1 000 list items)", () => {
  const problems: BatchRowResult[] = Array.from({ length: 250 }, (_, index) => ({
    excelRow: index + 2,
    reference: `PRD-${index + 1}`,
    name: `P${index + 1}`,
    status: "CONFLICT",
    message: "Conflit d'unicité sur cette ligne.",
  }));
  const markup = renderToStaticMarkup(<ProductsImportReport report={report({ title: "Import terminé avec erreurs", withProblems: true, conflicts: 250 })} problemRows={problems} />);
  assert.equal((markup.match(/Ligne \d+ —/g) ?? []).length, 100);
  assert.match(text(markup), /… et 150 autre\(s\)/);
});

// ---- the page and the routes (source guards) -------------------------------------------

test("the page sends the batches through the sequential runner and paginates the preview", () => {
  const page = read("./products-import-preview.tsx");
  assert.match(page, /runBatchedImport\(\{/);
  assert.match(page, /sendBatch: \(batch\) => postProductImportBatch\(batch\)/);
  assert.match(page, /paginateRows\(filteredRows, page\)/);
  assert.match(page, /pageData\.rows\.map\(/, "only the current page is rendered");
  assert.equal(/visibleRows/.test(page), false, "the whole list is no longer rendered at once");
  assert.equal(/Promise\.all|Promise\.allSettled/.test(page), false, "no parallel requests");
  // the file is refused with the real numbers before anything is sent
  assert.match(page, /parsed\.length > PRODUCT_IMPORT_MAX_ROWS/);
  assert.match(page, /setError\(importRowLimitMessage\(parsed\.length\)\)/);
  // only NEW / UPDATE lines are ever sent
  assert.match(page, /isImportableStatus\(serverRows\.get\(row\.line\)\?\.status\)/);
});

test("global counters are never a fake 0: '…' while checking, '—' when the check failed or has not run", () => {
  const page = read("./products-import-preview.tsx");
  assert.match(page, /const countsReady = serverSummary != null && !serverError && !serverLoading;/);
  assert.match(page, /if \(serverLoading\) return "…";/);
  assert.match(page, /return countsReady \? formatImportCount\(counts\[key\]\) : "—";/);
  assert.match(page, /setServerRows\(new Map\(\)\);\s*setServerSummary\(null\);\s*setServerError\(/, "a failed check clears the counters and shows its error");
  assert.match(page, /Réessayer la vérification/);
  assert.match(page, /"Non vérifié"/);
  assert.match(page, /\{label\} \(\{countLabel\(key\)\}\)/);
  // the page size only changes the display: the counters read the full list
  assert.match(page, /ALL: rows\.length/);
});

test("the batches are strictly sequential: an awaited loop, no parallel request anywhere in the chain", () => {
  const runner = read("../../lib/products-import-batches.ts");
  assert.match(runner, /while \(queue\.length > 0\)/);
  assert.match(runner, /response = await options\.sendBatch\(batch, \{ batch: batchNumber \}\);/);
  const apply = read("../../lib/server/products-import-apply.ts");
  const writer = read("../../lib/products-import-writer.ts");
  const client = read("../../lib/products-import-client.ts");
  for (const [name, source] of [["runner", runner], ["apply", apply], ["writer", writer], ["client", client]] as const) {
    assert.equal(/Promise\.all|Promise\.allSettled|Promise\.race/.test(source), false, `${name}: no parallel work`);
  }
});

test("routes: the write takes one batch (batch schema, 60 s, deferred lines), the preview takes the whole file in one request", () => {
  const write = read("../../app/api/produits/import/route.ts");
  assert.match(write, /productImportBatchSchema\.parse\(body\)/);
  assert.equal(/productImportSchema/.test(write), false, "a write request is never the whole file");
  assert.match(write, /export const maxDuration = 60;/);
  assert.match(write, /applyProductImportBatch\(\{/);
  assert.match(write, /deferred: outcome\.deferred,/);
  assert.match(write, /describeImportValidationError\(error, body, "batch"\)/);

  const preview = read("../../app/api/produits/import/preview/route.ts");
  assert.match(preview, /productImportSchema\.parse\(body\)/);
  assert.equal((preview.match(/classifyProductImportRows\(/g) ?? []).length, 1, "one grouped classification for the whole file");
  assert.match(preview, /describeImportValidationError\(error, body, "file"\)/);
  // the answer only carries what the browser does not already have
  const answer = preview.slice(preview.indexOf("rows: rows.map"));
  assert.equal(/reference:|name:|purchasePriceTTC:|salePriceTTC:/.test(answer), false, "no echo of the file's own cells");
});

test("performance: the classification is 4 grouped reads whatever the file size - no query per line", () => {
  const server = read("../../lib/server/products-import.ts");
  const classify = server.slice(server.indexOf("export async function classifyProductImportRows"));
  for (const query of ["prisma.product.findMany", "prisma.supplier.findMany", "prisma.category.findMany", "prisma.stockLevel.findMany"]) {
    assert.equal((classify.match(new RegExp(query.replace(/\./g, "\\."), "g")) ?? []).length, 1, query);
  }
  assert.equal(/for \(|for await|\.map\(async|\.forEach\(async/.test(classify), false, "no loop with a query inside");
  assert.match(classify, /reference: \{ in: references \}/);
  assert.match(classify, /code: \{ in: supplierCodes \}/);
});

test("business rules unchanged: same statuses and messages, same per-line transaction and stock target", () => {
  const rules = read("../../lib/products-import-rules.ts");
  for (const message of [
    "Référence en double dans le fichier.",
    "Fournisseur inactif : ${row.supplierCode}",
    "Nouveau produit.",
    "Mise à jour détectée.",
    "Produit inchangé.",
  ]) {
    assert.ok(rules.includes(message), message);
  }
  // an unknown supplier is created at import, no longer refused by the classification
  assert.equal(rules.includes("Fournisseur introuvable"), false);
  assert.match(rules, /supplierCreate: !supplier,/);

  // the per-line rules (now in the store-agnostic writer) ...
  const writer = read("../../lib/products-import-writer.ts");
  assert.match(writer, /message: "Produit déjà présent\."/);
  assert.match(writer, /processUntilBudget\(/);
  assert.match(writer, /createdSupplierIds\.set\(row\.supplierCode, applied\.supplierId\)/);
  // ... and the Prisma store: same transaction, same stock target and movement
  const apply = read("../../lib/server/products-import-apply.ts");
  assert.match(apply, /isolationLevel: "Serializable",/);
  assert.match(apply, /referenceType: "PRODUCT_IMPORT"/);
  assert.match(apply, /reason: "Import Excel produits"/);
  assert.match(apply, /if \(delta === 0\) return false;/);
  // no Prisma schema / migration touched for this feature
  assert.equal(/prisma\.\$executeRaw|\$queryRaw/.test(apply), false);
});

test("the report shows how many suppliers were created for the whole file", () => {
  const rendered = text(renderToStaticMarkup(<ProductsImportReport report={report({ suppliersCreated: 3 })} problemRows={[]} />));
  assert.match(rendered, /Fournisseurs créés : 3/);
  const page = read("./products-import-preview.tsx");
  assert.match(page, /\(nouveau\)/, "a supplier to create is flagged in the preview table");
  assert.match(page, /fournisseur\(s\) à créer/);
});
