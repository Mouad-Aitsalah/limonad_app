import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AccountsExportOptions } from "@/components/comptes/accounts-export-button";
import { AccountsImportReport, AccountsImportSummary, AccountsImportTable, type AccountServerRow } from "@/components/comptes/accounts-import-parts";
import { ExportPanel, type ExportState } from "@/components/import-export/export-dialog";
import { productExportNotes } from "@/components/produits/products-export-button";
import { PRODUCT_COLUMNS, type ProductColumnKey } from "@/lib/import-export/products-format";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&amp;|&#x27;|&#39;/g, "'");
const noop = () => undefined;

const COLUMNS = [
  { key: "reference" as const, label: "Référence", header: "ref_produit", locked: true },
  { key: "name" as const, label: "Désignation", header: "designation" },
  { key: "targetStock" as const, label: "Stock", header: "QuantiteStock", hint: "Stock de VOTRE dépôt." },
];
const FORMATS = [
  { value: "xlsx" as const, label: "Excel (.xlsx)", hint: "Feuille « produits »" },
  { value: "zip" as const, label: "ZIP + photos", hint: "produits.xlsx + photos/" },
];
const panel = (state: ExportState, selected: string[] = ["name"], notes: string[] = []) =>
  renderToStaticMarkup(
    <ExportPanel
      columns={COLUMNS}
      selected={new Set(selected as Array<(typeof COLUMNS)[number]["key"]>)}
      onToggle={noop}
      formats={FORMATS}
      format="xlsx"
      onFormatChange={noop}
      notes={notes}
      state={state}
    />,
  );
/** The <input> tag carrying `attribute` (attribute order is React's, not the source's). */
const inputWith = (markup: string, attribute: string) => markup.match(new RegExp(`<input[^>]*${attribute}[^>]*>`))?.[0] ?? "";
const checkbox = (markup: string, key: string) => inputWith(markup, `data-column="${key}"`);

// ---- export window -------------------------------------------------------------------------

test("export: column choice - the reference is always included, the selection is reflected, stock is NOT selected by default", () => {
  const markup = panel({ kind: "idle" });
  assert.match(checkbox(markup, "reference"), /checked=""/);
  assert.match(checkbox(markup, "reference"), /disabled=""/);
  assert.match(text(markup), /\(toujours incluse\)/);
  assert.match(checkbox(markup, "name"), /checked=""/);
  assert.doesNotMatch(checkbox(markup, "targetStock"), /checked=""/);
  assert.match(inputWith(markup, 'data-format="xlsx"'), /checked=""/);
  assert.doesNotMatch(inputWith(markup, 'data-format="zip"'), /checked=""/);
  // the products defaults: QuantiteStock and photo are opt-in
  const defaults = PRODUCT_COLUMNS.filter((column) => column.defaultSelected).map((column) => column.key);
  assert.equal(defaults.includes("targetStock"), false);
  assert.equal(defaults.includes("photo"), false);
  assert.deepEqual(productExportNotes(new Set(defaults), "xlsx"), [], "the default choice is complete and needs no warning");
});

test("export: loading, error and success states", () => {
  const loading = panel({ kind: "running", progress: { phase: "data", done: 500, total: 1200 } });
  assert.match(text(loading), /Lecture des données : 500 \/ 1200/);
  assert.match(loading, /<fieldset[^>]*disabled=""[^>]*data-export="columns"/, "choices are frozen while running");
  assert.match(text(panel({ kind: "running", progress: null })), /Préparation…/);

  const error = panel({ kind: "error", message: "Accès réservé à l'administrateur." });
  assert.match(error, /role="alert"/);
  assert.match(text(error), /Accès réservé à l'administrateur\./);

  const done = panel({
    kind: "done",
    result: { bytes: new Uint8Array(), fileName: "produits_2026-10-12_0930.zip", mime: "application/zip", rowCount: 3, warnings: ["1 photo(s) non exportée(s)."] },
  });
  assert.match(text(done), /3 ligne\(s\) exportée\(s\) : produits_2026-10-12_0930\.zip/);
  assert.match(text(done), /1 photo\(s\) non exportée\(s\)\./);
});

test("export: the remarks follow the choice (photos need the ZIP, creation columns, stock confirmation)", () => {
  const all = new Set<ProductColumnKey>(PRODUCT_COLUMNS.map((column) => column.key));
  assert.match(productExportNotes(all, "csv").join(), /choisissez « ZIP \+ photos »/);
  assert.match(productExportNotes(new Set<ProductColumnKey>(["name"]), "zip").join(), /ZIP sans la colonne Photo/);
  assert.match(productExportNotes(new Set<ProductColumnKey>(["salePriceTTC"]), "xlsx").join(), /pas en créer dans une autre organisation/);
  assert.match(productExportNotes(all, "zip").join(), /QuantiteStock : stock de votre dépôt.*confirmation/);
  assert.match(text(panel({ kind: "idle" }, [], ["Une remarque."])), /Une remarque\./);
});

test("export: account type filter and GPS switch", () => {
  const markup = renderToStaticMarkup(<AccountsExportOptions types={new Set(["CUSTOMER", "EMPLOYEE"])} onToggleType={noop} includeGps onToggleGps={noop} />);
  for (const [type, checked] of [["CUSTOMER", true], ["SUPPLIER", false], ["EXPENSE", false], ["TREASURY", false], ["EMPLOYEE", true]] as const) {
    const input = inputWith(markup, `data-type="${type}"`);
    assert.ok(input, type);
    assert.equal(/checked=""/.test(input), checked, type);
  }
  assert.match(text(markup), /Clients Fournisseurs Charges Trésorerie Employés/);
  assert.match(inputWith(markup, 'data-export="gps"'), /checked=""/);
  assert.match(text(markup), /Latitude et Longitude , 7 décimales/);
});

// ---- accounts import page ------------------------------------------------------------------

test("accounts import: preview shows the state, the ledger account, GPS and old -> new values", () => {
  const rows = [
    { line: 2, rawType: "Client", values: { excelRow: 2, code: "0042", type: "CUSTOMER" as const, name: "Atlas", latitude: 33.5731234, longitude: -7.5898341 }, errors: [], warnings: [] },
    { line: 3, rawType: "Produit", values: null, errors: ["Type_Compte « Produit » non reconnu."], warnings: [] },
    { line: 4, rawType: "Fournisseur", values: { excelRow: 4, code: "F1", type: "SUPPLIER" as const }, errors: [], warnings: ["Colonnes ignorées pour un fournisseur : Latitude."] },
  ];
  const serverRows = new Map<number, AccountServerRow>([
    [2, { excelRow: 2, code: "0042", name: "Atlas", type: "CUSTOMER", accountingCode: "34210042", status: "EXISTING_UPDATE", message: "Mise a jour detectee.", changes: { phone: { old: "0600", new: "0611" }, gps: { old: null, new: "33.5731234, -7.5898341" } } }],
    [4, { excelRow: 4, code: "F1", name: null, type: "SUPPLIER", accountingCode: null, status: "EXISTING_UNCHANGED", message: "Compte existant inchange.", changes: {} }],
  ]);
  const rendered = text(renderToStaticMarkup(<AccountsImportTable rows={rows} serverRows={serverRows} serverError={false} />));
  assert.match(rendered, /2 0042 Atlas Client 33\.5731234, -7\.5898341 34210042 À mettre à jour/);
  assert.match(rendered, /Téléphone : 0600 → 0611/);
  assert.match(rendered, /GPS : — → 33\.5731234, -7\.5898341/);
  assert.match(rendered, /3 — — Produit — — Erreur Type_Compte « Produit » non reconnu\./);
  assert.match(rendered, /Inchangé .*Colonnes ignorées pour un fournisseur : Latitude\./);
  // without an answer from the server, lines are never shown as checked
  assert.match(text(renderToStaticMarkup(<AccountsImportTable rows={rows.slice(0, 1)} serverRows={new Map()} serverError />)), /Non vérifié/);

  const summary = text(renderToStaticMarkup(<AccountsImportSummary total={3} summary={{ total: 2, new: 0, update: 1, unchanged: 1, conflicts: 0, errors: 0 }} localErrors={1} />));
  assert.match(summary, /Total : 3 À créer : 0 À mettre à jour : 1 Inchangés : 1 Rejetés : 1/);
  assert.match(text(renderToStaticMarkup(<AccountsImportSummary total={3} summary={null} localErrors={0} />)), /À créer : — .* Rejetés : —/);
});

test("accounts import: report = created / updated / ignored (unchanged) / rejected, per type, with the refused lines", () => {
  const rendered = text(
    renderToStaticMarkup(
      <AccountsImportReport
        report={{
          summary: { created: 4, updated: 1, unchanged: 2, conflicts: 1, errors: 1 },
          byType: { customersCreated: 1, customersUpdated: 1, suppliersCreated: 1, suppliersUpdated: 0, expensesCreated: 0, expensesUpdated: 0, treasuriesCreated: 1, treasuriesUpdated: 0, employeesCreated: 1, employeesUpdated: 0 },
          rows: [
            { excelRow: 5, code: "0042", status: "CONFLICT", message: "Ce code existe deja avec un type incompatible." },
            { excelRow: 6, code: "E-02", status: "ERROR", message: "Import des employés réservé à l'administrateur." },
            { excelRow: 7, code: "X", status: "CREATED", message: "Compte cree." },
          ],
          // lines the page did not send: 3 unchanged at the preview, 1 preview conflict, 1 unreadable line
          notSent: {
            unchanged: 3,
            rejected: [
              { excelRow: 9, code: "IEX-F-01", status: "CONFLICT", message: "Ce code existe deja avec un type incompatible." },
              { excelRow: 2, code: "—", status: "ERROR", message: "Type_Compte « Produit » non reconnu." },
            ],
          },
        }}
      />,
    ),
  );
  assert.match(rendered, /Créés : 4 · Mis à jour : 1 · Ignorés \(inchangés\) : 5 · Rejetés : 4/);
  assert.match(rendered, /Trésorerie — créées : 1 · mises à jour : 0 Employés — créés : 1 · mis à jour : 0/);
  assert.match(rendered, /Ligne 2 — — — Type_Compte « Produit » non reconnu\. Ligne 5 — 0042 — Ce code existe deja.* Ligne 6 — E-02 — Import des employés.* Ligne 9 — IEX-F-01/);
  assert.doesNotMatch(rendered, /Ligne 7/);
  // a report without the page's extra (older shape) still renders
  assert.match(
    text(renderToStaticMarkup(<AccountsImportReport report={{ summary: { created: 1, updated: 0, unchanged: 0, conflicts: 0, errors: 0 }, byType: {}, rows: [] }} />)),
    /Créés : 1 · Mis à jour : 0 · Ignorés \(inchangés\) : 0 · Rejetés : 0/,
  );
});

test("products import page: accepts ZIP, stock only after explicit confirmation (off by default), photos after the lines, photo report", () => {
  const page = read("../produits/products-import-preview.tsx");
  assert.match(page, /\.zip/);
  assert.match(page, /React\.useState\(false\);\s*\n[^\n]*\n?/);
  assert.match(page, /const \[applyStock, setApplyStock\] = React\.useState\(false\)/);
  assert.match(page, /data-import="apply-stock"/);
  assert.match(page, /postProductImportPreview\(validRows, \{ applyStock: withStock \}\)/, "changing the confirmation re-runs the preview");
  assert.match(page, /sendBatch: \(batch\) => postProductImportBatch\(batch, \{ applyStock \}\)/);
  assert.match(page, /if \(photoRows\.length && !stopRequestedRef\.current\) setPhotoReport\(await sendPhotos\(\)\)/, "photos go after the data, never if stopped");
  assert.match(page, /data-import="photo-report"/);
});

// ---- security (source level; the real 401 / 403 are exercised in the browser run) ----------

test("security: exports are admin only, photo import uses the products import roles, the organisation always comes from the session", () => {
  const core = read("../../lib/server/data-exports.ts");
  assert.match(core, /export const EXPORT_ROLES = \["admin"\] as const;/);
  assert.match(core, /export const PRODUCT_IMPORT_ROLES = \["admin", "depot_manager"\] as const;/);
  for (const name of ["exportProductsPage", "exportProductPhotos", "exportAccountsPage"]) {
    const body = core.slice(core.indexOf(`export async function ${name}`)).split("\nexport ")[0];
    assert.match(body, /requireOrganizationUser\(\[\.\.\.EXPORT_ROLES\]\)/, name);
    assert.doesNotMatch(body, /params\.organizationId|organizationId: params/, name);
  }
  const photos = core.slice(core.indexOf("export async function importProductPhotos"));
  assert.match(photos, /requireOrganizationUser\(\[\.\.\.PRODUCT_IMPORT_ROLES\]\)/);
  assert.match(photos, /applyProductPhotos\(prisma, user\.organizationId, items\)/);

  const routes = {
    productsExport: read("../../app/api/produits/export/route.ts"),
    productsExportPhotos: read("../../app/api/produits/export/photos/route.ts"),
    accountsExport: read("../../app/api/comptes/export/route.ts"),
    productPhotos: read("../../app/api/produits/import/photos/route.ts"),
    accountsImport: read("../../app/api/comptes/import/route.ts"),
    accountsPreview: read("../../app/api/comptes/import/preview/route.ts"),
  };
  for (const [name, source] of Object.entries(routes)) {
    assert.doesNotMatch(source, /organizationId["']?\s*\)|get\(["']organizationId|body\.organizationId|input\.organizationId/, `${name}: no organisation taken from the request`);
    assert.match(source, /AuthServiceError/, `${name}: 401 / 403 answered with the auth status`);
  }
  // every POST that WRITES (or sends stored photos) checks the origin; the previews only read
  for (const name of ["productsExportPhotos", "productPhotos", "accountsImport"] as const) {
    assert.match(routes[name], /rejectUntrustedOrigin\(request\)/, `${name}: CSRF guard on POST`);
  }
  assert.doesNotMatch(routes.accountsPreview, /applyAccountImport|\.create\(|\.update\(/, "the preview never writes");
  assert.match(routes.productPhotos, /MAX_BODY_CHARS[\s\S]*status: 413/, "photo batches are size-capped");
  assert.match(routes.accountsImport, /canImportEmployees: user\.role === "admin"/, "employees: admin only");
  assert.match(routes.accountsImport, /auditLog\.create/, "account imports are audited");

  // the buttons are only rendered for the admin
  assert.match(read("../../app/(dashboard)/comptes/page.tsx"), /canExport=\{sessionUser\?\.role === "admin"\}/);
  assert.match(read("../produits/products-view.tsx"), /\{canEditColumns \? \(\s*<ProductsExportButton/);
});

test("security: no export carries an internal id (cores select business fields only)", () => {
  for (const path of ["../../lib/server/products-export-core.ts", "../../lib/server/accounts-export-core.ts"]) {
    const source = read(path);
    // rows are built from explicit business fields; ids are only read to join stock / photos, never returned
    assert.doesNotMatch(source, /rows\.push\(\{[^}]*\bid\b/, path);
    assert.doesNotMatch(source, /organizationId: (product|row|list)\./, path);
  }
  const exportRow = read("../../lib/import-export/products-format.ts").match(/export type ProductExportRow = \{[\s\S]*?\n\};/)?.[0] ?? "";
  assert.ok(exportRow, "ProductExportRow found");
  assert.doesNotMatch(exportRow, /\bid\??:|(?<!tax)Id\??:/);
  const accountRow = read("../../lib/import-export/accounts-format.ts").match(/export type AccountExportRow = \{[\s\S]*?\n\};/)?.[0] ?? "";
  assert.ok(accountRow, "AccountExportRow found");
  assert.doesNotMatch(accountRow, /\bid\??:|(?<!tax)Id\??:/, "taxId is the IF number, a business value");
});
