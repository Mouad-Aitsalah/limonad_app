import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { TABLE_COLUMNS, TABLE_PAGES } from "@/lib/table-labels/registry";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

/** Each renamable table and the component that renders its header. */
const WIRING: Record<keyof typeof TABLE_COLUMNS, string> = {
  topProducts: "components/dashboard/direction-top-products.tsx",
  topCustomers: "components/dashboard/direction-top-customers.tsx",
  forecastProducts: "components/dashboard/forecast/forecast-products-list.tsx",
  deposits: "components/cash-deposits/deposit-history-table.tsx",
  archiveMonths: "components/ventes/months-table.tsx",
  archiveSessions: "components/ventes/sessions-table.tsx",
  invoices: "components/ventes/invoices-table.tsx",
  invoiceLines: "components/ventes/invoice-lines-table.tsx",
  customerOrders: "components/customer-orders/customer-orders-view.tsx",
  customerOrderLines: "components/customer-orders/customer-order-detail-dialog.tsx",
  creditNotes: "components/credit-notes/credit-notes-history.tsx",
  products: "components/produits/products-table.tsx",
  categories: "components/categories/categories-table.tsx",
  warehouseStock: "components/stock/warehouse-stock-table.tsx",
  stockMovements: "components/stock/stock-movements-table.tsx",
  truckStock: "components/stock/truck-stock-panel.tsx",
  depots: "components/depots/depots-view.tsx",
  inventories: "components/inventory/inventory-view.tsx",
  trucks: "components/trucks/trucks-table.tsx",
  loadingLines: "components/loadings/loadings-view.tsx",
  loadingsHistory: "components/loadings/loadings-view.tsx",
  loadingDetail: "components/loadings/loading-detail-view.tsx",
  tourVisits: "components/trajets/trajets-view.tsx",
  purchases: "components/achats/purchases-table.tsx",
  accounts: "components/comptes/accounts-table.tsx",
  contacts: "components/contacts/contacts-table.tsx",
  employees: "components/employees/employees-view.tsx",
  payrollHistory: "components/employees/employee-payroll-history-table.tsx",
  journal: "components/accounting/accounting-journal-view.tsx",
  entryLines: "components/accounting/accounting-entries-view.tsx",
  customerJournal: "components/accounting/customer-settlements-view.tsx",
  customerBalances: "components/accounting/customer-balances-view.tsx",
  accountingAccounts: "components/accounting/accounting-accounts-view.tsx",
  users: "components/users/users-table.tsx",
};

/** The <TableHeader>/<thead> blocks of a source file. */
function headerBlocks(source: string): string[] {
  return [...source.matchAll(/<(TableHeader|thead)\b[\s\S]*?<\/(TableHeader|thead)>/g)].map((match) => match[0]);
}

test("every table of the registry is wired: its component reads its labels through useColumnLabels", () => {
  for (const [table, file] of Object.entries(WIRING)) {
    assert.match(read(file), new RegExp(`useColumnLabels\\("${table}"\\)`), `${table} in ${file}`);
  }
  // and every table of every page is in the wiring list
  for (const page of TABLE_PAGES) for (const pageTable of page.tables) assert.ok(pageTable.table in WIRING, pageTable.table);
});

test("no default label is left hard-coded in a wired table header (a rename would silently miss it)", () => {
  for (const [table, file] of Object.entries(WIRING)) {
    const labels = Object.values(TABLE_COLUMNS[table as keyof typeof TABLE_COLUMNS].columns) as string[];
    for (const block of headerBlocks(read(file))) {
      for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
        assert.equal(new RegExp(`>\\s*${escaped}\\s*</(TableHead|th|span)>`).test(block), false, `${file}: "${label}" still hard-coded`);
      }
    }
  }
});

test("the labels are loaded once by the dashboard layout, for every staff role, and only an admin can change them", () => {
  const layout = read("app/(dashboard)/layout.tsx");
  assert.match(layout, /const tableLabels = await getTableLabelsForShell\(\);/);
  assert.match(layout, /<TableLabelsProvider initialLabels=\{tableLabels\}>/);
  const settings = read("lib/server/organization-settings.ts");
  assert.match(settings, /export async function getTableLabelsForShell[\s\S]*?requireOrganizationUser\(\["admin", "depot_manager", "cashier"\]\)/);
  assert.match(settings, /export async function getTableLabelsForAdmin[\s\S]*?requireOrganizationUser\(\["admin"\]\)/);
  assert.match(settings, /export async function updateTablePageLabels[\s\S]*?requireOrganizationUser\(\["admin"\]\)/);
  assert.match(settings, /action: "TABLE_LABELS_UPDATED"/);
  // the /produits column choice and the labels share the JSON: each writer keeps the other's part
  assert.match(settings, /data: \{ productColumnSettings: \{ \.\.\.stored, \.\.\.settings \} as Prisma\.InputJsonObject \}/);
  assert.match(settings, /const next = withPageLabels\(before\.productColumnSettings, page\.key, pageLabels\);/);
  const route = read("app/api/organization/table-labels/route.ts");
  assert.match(route, /const csrfRejection = rejectUntrustedOrigin\(request\);/);
  // no database column, property or schema change for a label
  assert.equal(/model .*Label|tableColumnLabels/.test(read("prisma/schema.prisma")), false);
});
