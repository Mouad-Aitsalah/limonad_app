import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ProductsImportVariantsPanel } from "@/components/produits/products-import-variants-panel";
import type { ServerVariantGroup } from "@/lib/products-import-client";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&amp;|&#x27;|&#39;/g, "'");
const noop = () => undefined;

// ---- products-with-variants: the grouped preview ----------------------------------------------------

const variantGroup = (over: Partial<ServerVariantGroup> = {}): ServerVariantGroup => ({
  parentName: "Arsenal Survêtements",
  categoryName: "Sport",
  variants: 3,
  new: 3,
  update: 0,
  unchanged: 0,
  problems: 0,
  blockedRows: 0,
  blocked: false,
  reason: null,
  ...over,
});
const readyForm = { supplierId: "s1", taxRateText: "20", confirmed: true };
const applyButtonDisabled = (markup: string) =>
  /<button[^>]*\sdisabled=""[^>]*data-import="variants-apply"/.test(markup) || /<button[^>]*data-import="variants-apply"[^>]*\sdisabled=""/.test(markup);

test("variants panel: the VAT is pre-filled at 20 and applies to NEW products only, nothing applied until confirmed", () => {
  const markup = renderToStaticMarkup(
    <ProductsImportVariantsPanel
      columnsNotice="Fichier sans en-tête lu dans cet ordre : désignation, code-barres."
      suppliers={[{ id: "s1", name: "Fournisseur 1" }]}
      form={{ supplierId: "", taxRateText: "20", confirmed: false }}
      applied={null}
      loading={false}
      groups={null}
      onChange={noop}
      onApply={noop}
    />,
  );
  const rendered = text(markup);
  assert.match(rendered, /Fichier avec variantes/);
  assert.match(rendered, /Fichier sans en-tête lu dans cet ordre/);
  assert.match(rendered, /tout le groupe est bloqué/);
  assert.match(rendered, /Un groupe est écrit en une seule transaction : toutes ses variantes ou aucune\./);
  assert.match(rendered, /le stock du fichier est une cible \(jamais une addition\)/);
  assert.equal(/Aperçu uniquement/.test(rendered), false, "the write is available once the supplier and VAT are confirmed");
  assert.match(rendered, /Pour les NOUVEAUX produits seulement/);
  assert.match(rendered, /Les produits qui existent déjà gardent les leurs/);
  assert.match(markup, /value="20"/);
  assert.match(markup, /<option value="s1">Fournisseur 1<\/option>/);
  // not confirmed: the button is disabled and says why; the new products stay in error
  assert.equal(applyButtonDisabled(markup), true);
  assert.match(rendered, /Choisissez le fournisseur des nouveaux produits\./);
  assert.match(rendered, /Non confirmé : les nouveaux produits restent en erreur/);
});

test("variants panel: confirmed supplier and VAT enable the button; the applied values are shown", () => {
  const markup = renderToStaticMarkup(
    <ProductsImportVariantsPanel
      suppliers={[{ id: "s1", name: "Fournisseur 1" }]}
      form={readyForm}
      applied={{ supplierName: "Fournisseur 1", taxRate: 20 }}
      loading={false}
      groups={[variantGroup()]}
      onChange={noop}
      onApply={noop}
    />,
  );
  assert.equal(applyButtonDisabled(markup), false);
  assert.match(text(markup), /Appliqué : Fournisseur 1, TVA 20 %/);
  assert.match(markup, /data-import="variants-confirm"[^>]*checked=""|checked=""[^>]*data-import="variants-confirm"/);
});

test("variants panel: a blocked group is listed first with its reason; the valid lines it blocks are counted", () => {
  const rendered = text(
    renderToStaticMarkup(
      <ProductsImportVariantsPanel
        suppliers={[]}
        form={readyForm}
        applied={null}
        loading={false}
        groups={[
          variantGroup({ parentName: "Short Nike", variants: 2, new: 2 }),
          variantGroup({ parentName: "Arsenal Survêtements", variants: 3, new: 3, blocked: true, problems: 1, blockedRows: 2, reason: "ligne 4 : Référence 611 déjà utilisée." }),
        ]}
        onChange={noop}
        onApply={noop}
      />,
    ),
  );
  assert.match(rendered, /2 produit\(s\) parent · 1 groupe\(s\) bloqué\(s\)/);
  assert.ok(rendered.indexOf("Arsenal Survêtements") < rendered.indexOf("Short Nike"), "blocked groups come first");
  assert.match(rendered, /Bloqué — ligne 4 : Référence 611 déjà utilisée\. \(2 variante\(s\) valide\(s\) bloquée\(s\)\)/);
  assert.match(rendered, /Prêt/);
});

test("variants panel: no blocked group says so, and a long list is capped with the real total", () => {
  const none = text(
    renderToStaticMarkup(<ProductsImportVariantsPanel suppliers={[]} form={readyForm} applied={null} loading={false} groups={[variantGroup()]} onChange={noop} onApply={noop} />),
  );
  assert.match(none, /1 produit\(s\) parent · aucun groupe bloqué/);
  const many = Array.from({ length: 80 }, (_, index) => variantGroup({ parentName: `Parent ${index}` }));
  const capped = text(
    renderToStaticMarkup(<ProductsImportVariantsPanel suppliers={[]} form={readyForm} applied={null} loading={false} groups={many} onChange={noop} onApply={noop} />),
  );
  assert.match(capped, /50 premiers groupes affichés \(les bloqués d'abord\) sur 80/);
  assert.equal((capped.match(/Parent \d+/g) ?? []).length, 50);
});

test("the page: a variants file is written only once supplier and VAT are confirmed, in group-safe batches; the route checks everything again", () => {
  const page = read("./products-import-preview.tsx");
  // a historical file is read exactly as before; the variants format is only recognised on top
  assert.match(page, /readProductImportFile\(new Uint8Array\(await file\.arrayBuffer\(\)\), file\.name, \{ variantFormat: true \}\)/);
  // no write for a variants file until the page's supplier and VAT were confirmed and sent for the preview
  assert.match(page, /&& !importing && \(!variantMode \|\| appliedDefaults !== null\);/);
  assert.equal(/Aperçu uniquement/.test(page), false);
  // the groups travel whole: gathered by group, cut only between groups, each line with its group's size
  assert.match(page, /groupOf: variantGroupKeyOfLine,/);
  assert.match(page, /withVariantGroupSizes\(importableRows\.map\(toLine\), rows\)/);
  assert.match(page, /selectLinesToWrite\(/);
  // the lines the browser refused itself still count in their group
  assert.match(page, /externalErrors: externalVariantErrors\(localRows\),/);
  assert.match(page, /externalErrors: externalErrorsForBatch\(batch, rows\),/);
  // the supplier / VAT are sent only once confirmed
  assert.match(page, /confirmedCreationDefaults\(defaultsForm\)/);
  // a historical file sends the very same requests as before
  assert.match(page, /: await postProductImportPreview\(validRows, \{ applyStock: withStock \}\);/);
  assert.match(page, /sendBatch: \(batch\) => postProductImportBatch\(batch, \{ applyStock \}\),/);

  const write = read("../../app/api/produits/import/route.ts");
  assert.equal(/rowCarriesVariantData/.test(write), false, "the temporary refusal is gone - after the integration tests proved the write");
  // the server checks the defaults and the group sizes itself, before anything is written
  assert.match(write, /resolveCreationDefaults\(user\.organizationId, input\.creationDefaults\)/);
  assert.match(write, /\{ applyStock, creationDefaults, externalErrors: input\.externalErrors, requireGroupSize: true \}/);
  assert.ok(write.indexOf("requireGroupSize: true") < write.indexOf("applyProductImportBatch({"));
  assert.match(write, /groupsRolledBack: outcome\.groupsRolledBack/);
});

test("the preview route: defaults are checked in the organisation, extra fields only for the variants format, nothing is written", () => {
  const preview = read("../../app/api/produits/import/preview/route.ts");
  assert.match(preview, /resolveCreationDefaults\(user\.organizationId, input\.creationDefaults\)/);
  assert.match(preview, /externalErrors: input\.externalErrors/);
  assert.match(preview, /\.\.\.\(groups\.length \? \{ groups \} : \{\}\)/);
  assert.equal(/\.create\(|\.update\(|\.upsert\(|\.delete|\$executeRaw|applyProductImportBatch/.test(preview), false, "the preview writes nothing");
  const server = read("../../lib/server/products-import.ts");
  const resolve = server.slice(server.indexOf("export async function resolveCreationDefaults"));
  assert.match(resolve, /where: \{ id: defaults\.supplierId, organizationId \}/, "scoped to the caller's organisation");
  assert.equal(/\.create\(|\.update\(|\.upsert\(|\.delete/.test(resolve), false, "read-only");
  // the variant columns are read ONLY for a variants file: the historical query is the historical one
  const core = read("../../lib/server/products-import-core.ts");
  const classify = core.slice(core.indexOf("export async function classifyProductImportRowsWith"), core.indexOf("export function productImportLineTx")).replace(/\/\/.*$/gm, "");
  assert.match(classify, /\.\.\.\(identities\.length \? \{ variantGroupKey: true, variantKey: true \} : \{\}\)/);
  assert.match(classify, /: \{ organizationId, reference: \{ in: references \} \}/, "no variants line: the same where clause as ever");
  assert.equal((classify.match(/db\.product\.findMany/g) ?? []).length, 3, "the identity owners come from the SAME read: still three product reads");
});

// ---- D1: the group transaction exists, but variants are still not written -------------------------------

test("the Prisma store runs a whole group in one Serializable transaction with the time a group needs, retried on serialization failures", () => {
  const apply = read("../../lib/server/products-import-apply.ts");
  const group = apply.slice(apply.indexOf("runGroup:"), apply.indexOf("describeError:"));
  assert.match(group, /withSerializableRetry\(/);
  assert.match(group, /isolationLevel: "Serializable"/);
  assert.match(group, /timeout: PRODUCT_IMPORT_GROUP_TX_TIMEOUT_MS/);
  assert.match(group, /maxWait: PRODUCT_IMPORT_GROUP_TX_MAX_WAIT_MS/);
  // one transaction per GROUP, still one per line for the rest
  assert.equal((apply.match(/prisma\.\$transaction\(/g) ?? []).length, 2);
  const shared = read("../../lib/products-import-shared.ts");
  assert.match(shared, /PRODUCT_IMPORT_GROUP_TX_TIMEOUT_MS = 30_000/);
  assert.match(shared, /PRODUCT_IMPORT_GROUP_TX_MAX_WAIT_MS = 10_000/);
});

test("the variant columns are written by one place only, guarded in the UPDATE; the movements of a group are numbered once, at the end", () => {
  const core = read("../../lib/server/products-import-core.ts").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // created with the product ...
  assert.match(core, /\.\.\.variantCreateFields\(row\),/);
  // ... attached to an ordinary product only while its four columns are still NULL, or updated only while the identity is the same
  assert.match(core, /variantParentName: null, variantGroupKey: null, variantKey: null, variantAttributes: \{ equals: Prisma\.DbNull \}/);
  assert.match(core, /variantGroupKey: identity\.groupKey, variantKey: identity\.key/);
  assert.match(core, /relancez l'aperçu/);
  // a group's movements: recorded by commitMovements - ONE reservation of consecutive numbers, ONE insert
  assert.match(core, /sequences\.nextMovementNumbers\(tx, organizationId, pending\.length\)/);
  assert.match(core, /tx\.stockMovement\.createMany\(/);
  const apply = read("../../lib/server/products-import-apply.ts");
  assert.match(apply, /\{ deferMovements: true \}/);
  const writer = read("../../lib/products-import-writer.ts");
  assert.ok(writer.indexOf("await tx.commitMovements?.();") > writer.indexOf("const done = await writeRowInTx(tx, row, local);"), "after every line, last in the transaction");
});

test("the writer keeps its caches and counters out of a transaction until it has committed", () => {
  const writer = read("../../lib/products-import-writer.ts");
  const group = writer.slice(writer.indexOf("async function applyGroup("), writer.indexOf("function mapGroupRowError"));
  // inside the transaction the writer only fills a LOCAL copy ...
  const work = group.slice(group.indexOf("store.runGroup(async (tx) => {"), group.indexOf("// The transaction committed"));
  assert.match(work, /const local: CreatedIds = \{/);
  assert.equal(/created\.(categories|suppliers|brands)\.set/.test(work), false, "the batch caches are not touched inside the transaction");
  // ... and the batch caches are updated after it
  const after = group.slice(group.indexOf("// The transaction committed"), group.indexOf("} catch (error) {", group.indexOf("// The transaction committed")));
  assert.match(after, /created\.categories\.set\(key, id\)/);
  // the failure path touches no cache and no counter
  const failure = group.slice(group.indexOf("// Rolled back"));
  assert.equal(/created\.(categories|suppliers|brands)\.set/.test(failure), false);
});
