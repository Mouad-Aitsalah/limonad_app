import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AppPageHeader } from "@/components/ui/app-page-header";

/**
 * The page title is shown ONCE, in the fixed top header (components/layout/
 * header.tsx, label of the menu entry). The second title (+ its intro sentence)
 * that repeated it at the top of the content is gone; every button, filter,
 * table and functional note of these pages is still there.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const PAGES: Array<{ file: string; removed: string[]; kept: string[] }> = [
  { file: "app/(dashboard)/comptabilite/comptes/page.tsx", removed: ["<h1", "Gere le plan comptable"], kept: ["<AccountingAccountsView"] },
  { file: "app/(dashboard)/comptabilite/ecritures/page.tsx", removed: ["<h1", "Préparer, archiver et valider"], kept: ["<AccountingEntriesView"] },
  { file: "app/(dashboard)/comptabilite/journal/page.tsx", removed: ["<h1", "Consultez l&apos;ensemble"], kept: ["<AccountingJournalView"] },
  { file: "app/(dashboard)/comptabilite/parametres/page.tsx", removed: ["<h1", "Centralise l&apos;association"], kept: ["<AccountingSettingsView"] },
  { file: "app/(dashboard)/comptabilite/reglements-clients/page.tsx", removed: ["<h1"], kept: ["<CustomerSettlementsView"] },
  { file: "app/(dashboard)/comptabilite/solde-clients/page.tsx", removed: ["<h1"], kept: ["<CustomerBalancesView"] },
  { file: "app/(dashboard)/ventes/commandes-en-ligne/page.tsx", removed: ["<h1", "Commandes envoyées depuis"], kept: ["<CustomerOrdersView"] },
  { file: "app/(dashboard)/ventes/journalieres/page.tsx", removed: ["<h1"], kept: ["<DailyInvoicesView"] },
  { file: "app/(dashboard)/ventes/page.tsx", removed: ["<h1"], kept: ["<SalesView"] },
  { file: "app/(dashboard)/dashboard/page.tsx", removed: ['title="Dashboard Direction"', "Vue synthétique des ventes", "<AppPageHeader"], kept: ["<DirectionPeriodBar", "<DirectionTopCustomersCard"] },
  { file: "components/achats/new-purchase-view.tsx", removed: ["<h1", "Nouvel achat</"], kept: ["<PurchaseForm"] },
  { file: "components/achats/purchases-view.tsx", removed: ["<h1"], kept: ['href="/achats/nouveau"', "<PurchasesToolbar"] },
  { file: "components/credit-notes/credit-note-tabs.tsx", removed: ["<h1", "Gestion des retours clients"], kept: ["<TabsList"] },
  { file: "components/cash-deposits/cash-deposits-view.tsx", removed: ["<h1"], kept: ["Nouveau versement", "<DepositHistoryTable"] },
  { file: "components/comptes/accounts-view.tsx", removed: ["<h1"], kept: ["<AccountDialog", "<AccountsTable"] },
  { file: "components/contacts/contacts-view.tsx", removed: ["<h1"], kept: ["<ContactDialog", "<ContactsTable"] },
  { file: "components/employees/employee-payroll-view.tsx", removed: ["<h1"], kept: ["<EmployeePayrollHistoryTable"] },
  { file: "components/employees/employees-view.tsx", removed: ["<h1"], kept: ["<EmployeeDialog", "<SummaryCard"] },
  { file: "components/inventory/inventory-view.tsx", removed: ["<h1", "Comptage physique du stock"], kept: ["<MetricCard"] },
  { file: "components/loadings/loadings-view.tsx", removed: ["<h1", "Fiches de transfert de stock independantes"], kept: ["<TabsList"] },
  { file: "components/users/users-view.tsx", removed: ["<h1", "Comptes et roles"], kept: ["<UserDialog", "<UsersTable"] },
  { file: "components/parametres/company-identity-view.tsx", removed: ["<h1"], kept: ["<SettingsNav", "Identité de l&apos;entreprise"] },
  { file: "components/parametres/pricing-settings-view.tsx", removed: ["<h1"], kept: ["<SettingsNav", "<Switch"] },
  { file: "components/produits/products-view.tsx", removed: ['title="Produits"', "Catalogue produits", "Recherche, filtres et actions rapides"], kept: ["Importer des produits", "<ProductDialog", "<ProductsToolbar", "<ProductsTable", "countLabel="] },
  { file: "components/stock/stock-view.tsx", removed: ['title="Stock"'], kept: ["<StockAdjustmentDialog", 'title="Vue stock"', 'title="Mouvements de stock"'] },
  { file: "components/trajets/trajets-view.tsx", removed: ["Trajets des camions", "Suivez vos camions en direct"], kept: ["Actualiser"] },
  { file: "components/trucks/trucks-view.tsx", removed: ['title="Camions"', "Flotte de livraison", "Suivez la flotte COMDIS"], kept: ["<TruckDialog", "<TrucksToolbar", "countLabel="] },
  { file: "components/categories/categories-view.tsx", removed: ['title="Categories"', "Structure du catalogue"], kept: ["<CategoryDialog", "<CategoriesToolbar", "countLabel="] },
  // functional note kept: a depot is required for the POS and the cash deposits
  { file: "components/depots/depots-view.tsx", removed: ['title="Dépôts"', "Chaque organisation gère ici ses dépôts", "Dépôts de l'organisation"], kept: ["<DepotCreateDialog", "nécessaires au point de vente et aux versements", "countLabel="] },
  { file: "app/organisations/page.tsx", removed: ['title="Organisations"', "Creez, pilotez et isolez"], kept: ["<OrganizationFormDialog", "<OrganizationsView"] },
];

test("the repeated page titles and intro sentences are gone; buttons, filters, tables and functional notes stay", () => {
  for (const page of PAGES) {
    const source = read(page.file);
    for (const text of page.removed) assert.equal(source.includes(text), false, `${page.file}: "${text}" still there`);
    for (const text of page.kept) assert.ok(source.includes(text), `${page.file}: "${text}" missing`);
  }
});

test("titles that identify a RECORD (not the page) are kept", () => {
  assert.match(read("components/employees/employee-detail-view.tsx"), /<h1[\s\S]*?detail\.employee\.employeeCode/);
  assert.match(read("components/credit-notes/credit-note-detail-view.tsx"), /<h1[\s\S]*?creditNote\.number/);
  assert.match(read("components/loadings/loading-detail-view.tsx"), /<h1[\s\S]*?Transfert de stock \{loading\.displayNumber\}/);
  assert.match(read("components/organizations/organization-detail-view.tsx"), /title=\{organization\.name\}/);
});

test("AppPageHeader without a title renders only its actions (and an optional functional note), never an h1", () => {
  const actionsOnly = renderToStaticMarkup(<AppPageHeader actions={<button type="button">Nouveau</button>} />);
  assert.equal(actionsOnly.includes("<h1"), false);
  assert.ok(actionsOnly.includes(">Nouveau</button>"));
  const withNote = renderToStaticMarkup(<AppPageHeader description="Note utile." actions={<span>A</span>} />);
  assert.ok(withNote.includes("Note utile."));
  assert.equal(renderToStaticMarkup(<AppPageHeader />), "");
  // with a title (record pages) it is unchanged
  assert.match(renderToStaticMarkup(<AppPageHeader eyebrow="Organisation" title="ACME" />), /<h1[^>]*>ACME<\/h1>/);
});
