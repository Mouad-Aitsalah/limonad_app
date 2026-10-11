import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { TableLabelsSettingsView } from "@/components/parametres/table-labels-settings-view";
import type { TableLabels } from "@/lib/table-labels/labels";
import { TABLE_PAGES } from "@/lib/table-labels/registry";

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, hmrRefresh: noop };

function render(labels: TableLabels) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router as never}>
      <PathnameContext.Provider value="/parametres/tableaux">
        <TableLabelsSettingsView initialLabels={labels} />
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

test("Personnalisation des tableaux: page picker, the columns of the selected page, default / current / custom label, 3 actions", () => {
  const markup = render({ dashboard: { topCustomers: { revenue: "Chiffre d'affaires" } } });
  assert.ok(markup.includes("Page à personnaliser"));
  // the first page (Dashboard) and its 3 tables are shown, every column with a field
  assert.equal(TABLE_PAGES[0].key, "dashboard");
  for (const title of ["Top produits", "Top clients", "Prévisions d&#x27;achat"]) assert.ok(markup.includes(title), title);
  assert.equal((markup.match(/data-column="topCustomers\./g) ?? []).length, 4);
  // a saved label: shown as the current label and prefilled in its field; the default stays visible
  assert.match(markup, /data-column="topCustomers\.revenue"[\s\S]*?CA TTC[\s\S]*?Chiffre d&#x27;affaires[\s\S]*?value="Chiffre d&#x27;affaires"/);
  // a column not renamed: empty field with the default as placeholder
  assert.match(markup, /data-column="topCustomers\.customer"[\s\S]*?placeholder="Client"[^>]*value=""|data-column="topCustomers\.customer"[\s\S]*?value=""[^>]*placeholder="Client"/);
  for (const action of ["Annuler les modifications", "Réinitialiser les intitulés par défaut", "Enregistrer"]) assert.ok(markup.includes(action), action);
  // nothing changed yet: save and cancel are disabled
  assert.match(markup, /<button[^>]*disabled=""[^>]*>[\s\S]*?Enregistrer<\/button>/);
  // no repeated page title (the fixed header shows it)
  assert.equal(markup.includes("<h1"), false);
});

test("the save confirms clearly and publishes the new labels to every table at once", () => {
  const source = readFileSync(path.join(process.cwd(), "components/parametres/table-labels-settings-view.tsx"), "utf8");
  assert.match(source, /fetch\("\/api\/organization\/table-labels", \{\s*method: "PUT"/);
  assert.match(source, /body: JSON\.stringify\(\{ page: page\.key, labels: pageLabels \}\)/);
  assert.match(source, /const message = `Intitulés enregistrés pour la page « \$\{page\.label\} »\.`;/);
  assert.match(source, /publishLabels\(body\.labels\);\s*router\.refresh\(\);/);
  // changing page with unsaved edits asks first
  assert.match(source, /if \(dirty && !window\.confirm\(/);
});
