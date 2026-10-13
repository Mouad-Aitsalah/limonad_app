import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { TableColumnsPanel } from "@/components/table-columns/table-columns-panel";
import { TableColumnsProvider } from "@/components/table-columns/table-columns-provider";
import { MonthsTable } from "@/components/ventes/months-table";
import { SessionsTable } from "@/components/ventes/sessions-table";
import { WarehouseStockTable } from "@/components/stock/warehouse-stock-table";
import { AuthContext, type AuthContextValue } from "@/hooks/use-auth";
import {
  CONFIGURABLE_TABLES,
  defaultTableColumns,
  findConfigurableTable,
  isDefaultTableColumnPreference,
  moveTableColumn,
  parseTableColumnPreferences,
  sanitizeTableColumnPreference,
  visibleTableColumns,
  withTableColumnVisibility,
} from "@/lib/table-columns/columns";
import { pageTableColumns, TABLE_PAGES } from "@/lib/table-labels/registry";
import type { UserRole } from "@/types/auth";
import type { PosSessionDto, SalesMonthDto, StockLevelDto } from "@/types/operations-dto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
const headers = (markup: string) => [...markup.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((match) => match[1].replace(/<[^>]+>/g, "").trim());

const def = (key: string) => findConfigurableTable(key)!;

// --- Which tables -----------------------------------------------------------------

test("exactly the tables of the four pages are configurable, with their current columns as default", () => {
  assert.deepEqual(
    CONFIGURABLE_TABLES.map((table) => table.key),
    [
      "salesArchive.invoices",
      "salesArchive.archiveSessions",
      "salesArchive.archiveMonths",
      "dailyInvoices.invoices",
      "stock.warehouseStock",
      "stock.truckStock",
      "stock.stockMovements",
      "accounts.accounts",
    ],
  );
  for (const table of CONFIGURABLE_TABLES) {
    const pageTable = TABLE_PAGES.find((page) => page.key === table.pageKey)!.tables.find((entry) => entry.table === table.table)!;
    assert.deepEqual(defaultTableColumns(table), pageTableColumns(pageTable).map((column) => column.key), table.key);
    for (const key of [...table.required, ...table.pinnedEnd]) assert.ok(defaultTableColumns(table).includes(key), `${table.key}.${key}`);
    // the default preference renders exactly the former columns, in the former order
    assert.deepEqual(visibleTableColumns(table, undefined), defaultTableColumns(table), table.key);
  }
});

// --- Preferences ------------------------------------------------------------------

test("invalid or stale preferences fall back safely to the default columns", () => {
  const stock = def("stock.warehouseStock");
  for (const value of [undefined, null, "x", [], { order: "x" }, { order: [1, 2], hidden: "category" }]) {
    assert.deepEqual(sanitizeTableColumnPreference(stock, value), { order: defaultTableColumns(stock), hidden: [] }, JSON.stringify(value));
  }
  // unknown / duplicated columns dropped, missing ones appended, a required column can never be hidden
  assert.deepEqual(
    sanitizeTableColumnPreference(stock, { order: ["value", "ghost", "value", "product"], hidden: ["product", "category", "ghost"] }),
    { order: ["value", "product", "category", "currentStock", "minimumStock", "status"], hidden: ["category"] },
  );
  // stale rows (unknown tables) are ignored
  assert.deepEqual(Object.keys(parseTableColumnPreferences([{ tableKey: "old.table", settings: {} }, { tableKey: "stock.warehouseStock", settings: {} }])), ["stock.warehouseStock"]);
});

test("hide / show / move: hidden columns come back, 'Actions' stays last and visible, required columns stay visible", () => {
  const invoices = def("salesArchive.invoices");
  let preference = sanitizeTableColumnPreference(invoices, undefined);
  assert.equal(isDefaultTableColumnPreference(invoices, preference), true);
  preference = withTableColumnVisibility(invoices, preference, "net", false);
  preference = withTableColumnVisibility(invoices, preference, "order", false); // required: ignored
  preference = withTableColumnVisibility(invoices, preference, "actions", false); // pinned: ignored
  preference = moveTableColumn(preference, "payment", -1);
  preference = moveTableColumn(preference, "order", -1); // already first: unchanged
  assert.deepEqual(visibleTableColumns(invoices, preference), [
    "order", "date", "customer", "driverUser", "items", "total", "payment", "status", "actions",
  ]);
  assert.equal(preference.order.includes("actions"), false, "Actions is not movable");
  // shown again: the column is back at its place
  preference = withTableColumnVisibility(invoices, preference, "net", true);
  assert.deepEqual(visibleTableColumns(invoices, preference), [
    "order", "date", "customer", "driverUser", "items", "total", "payment", "net", "status", "actions",
  ]);
  assert.equal(isDefaultTableColumnPreference(invoices, preference), false);
});

// --- Rendering -----------------------------------------------------------------------

const months: SalesMonthDto[] = [
  { key: "2026-10", label: "Octobre", year: 2026, monthNumber: 10, ordersCount: 3, totalSales: 300, totalRefunds: 10, totalNet: 290 } as SalesMonthDto,
];

test("a table renders the chosen columns in the chosen order; a hidden column is simply not rendered", () => {
  const plain = renderToStaticMarkup(<MonthsTable months={months} onSelectMonth={() => {}} />);
  assert.deepEqual(headers(plain), ["Mois", "Année", "Commandes", "Total vendu", "Remboursements", "Total net", ""]);

  const customised = renderToStaticMarkup(
    <TableColumnsProvider
      initialPreferences={{ "salesArchive.archiveMonths": { order: ["month", "net", "orders", "sold", "refunds", "year"], hidden: ["year", "refunds"] } }}
    >
      <MonthsTable months={months} onSelectMonth={() => {}} />
    </TableColumnsProvider>,
  );
  assert.deepEqual(headers(customised), ["Mois", "Total net", "Commandes", "Total vendu", ""]);
  assert.ok(customised.includes("Octobre"));
  assert.equal(customised.includes(">2026<"), false, "the hidden year cell is not rendered");
  // the data itself is untouched: the same row, back with every column by default
  assert.equal(months[0].year, 2026);
});

test("another page or another user's preference never applies (explicit page key, provider per session)", () => {
  const sessions = [
    { id: "s1", displayNumber: "POS/1", openedAt: null, closedAt: null, ordersCount: 2, totalSales: 20, totalRefunds: 0, totalNet: 20, status: "OPEN" } as unknown as PosSessionDto,
  ];
  // a daily-invoices preference does not touch the archive sessions
  const markup = renderToStaticMarkup(
    <TableColumnsProvider initialPreferences={{ "dailyInvoices.invoices": { order: [], hidden: ["date"] } }}>
      <SessionsTable sessions={sessions} onViewOrders={() => {}} />
    </TableColumnsProvider>,
  );
  assert.equal(headers(markup).length, 9);
  for (const [file, pageKey] of [
    ["components/ventes/sessions-table.tsx", "salesArchive"],
    ["components/ventes/months-table.tsx", "salesArchive"],
    ["components/stock/warehouse-stock-table.tsx", "stock"],
    ["components/stock/stock-movements-table.tsx", "stock"],
    ["components/stock/truck-stock-panel.tsx", "stock"],
    ["components/comptes/accounts-table.tsx", "accounts"],
  ] as const) {
    assert.match(read(file), new RegExp(`useTableColumns\\("${pageKey}", "\\w+"\\)`), file);
  }
});

test("stock: the desktop table follows the preference, the phone cards keep every value", () => {
  const rows = [
    {
      id: "l1", productId: "p1", productName: "Eau", productReference: "EAU-1", categoryId: "c", categoryName: "Boissons",
      quantity: 4, minimumStock: 2, stockValue: 40, status: "IN_STOCK", locationCode: "DEP", locationType: "DEPOT",
    } as unknown as StockLevelDto,
  ];
  const markup = renderToStaticMarkup(
    <TableColumnsProvider initialPreferences={{ "stock.warehouseStock": { order: ["product", "value", "category", "currentStock", "minimumStock", "status"], hidden: ["category"] } }}>
      <WarehouseStockTable rows={rows} />
    </TableColumnsProvider>,
  );
  assert.deepEqual(headers(markup), ["Produit", "Valeur", "Stock actuel", "Stock minimum", "Statut"]);
  assert.ok(markup.includes("lg:hidden"), "phone cards still rendered");
});

function withRole(role: UserRole | null, children: React.ReactNode) {
  const value = { currentUser: role ? { id: "u", nom: "U", email: "u@x", role, organizationId: "o" } : null } as unknown as AuthContextValue;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

test("'Personnaliser les colonnes' is offered to an ADMIN only", () => {
  const panel = <TableColumnsPanel pageKey="stock" table="warehouseStock" tableName="Stock" />;
  assert.match(renderToStaticMarkup(withRole("admin", panel)), /Personnaliser les colonnes/);
  for (const role of ["cashier", "depot_manager", "driver", "super_admin", null] as const) {
    assert.equal(renderToStaticMarkup(withRole(role, panel)), "", String(role));
  }
  // a table that is not configurable on that page shows nothing either
  assert.equal(renderToStaticMarkup(withRole("admin", <TableColumnsPanel pageKey="dashboard" table="topProducts" tableName="Top" />)), "");
});

test("each target page offers the button above its tables", () => {
  const wiring: Array<[string, RegExp]> = [
    ["components/ventes/orders-tab.tsx", /<TableColumnsPanel pageKey="salesArchive" table="invoices" tableName="Commandes" \/>/],
    ["components/ventes/sessions-tab.tsx", /<TableColumnsPanel pageKey="salesArchive" table="archiveSessions" tableName="Sessions" \/>/],
    ["components/ventes/months-tab.tsx", /<TableColumnsPanel pageKey="salesArchive" table="archiveMonths" tableName="Mois" \/>/],
    ["components/ventes/daily-invoices-view.tsx", /<TableColumnsPanel pageKey="dailyInvoices" table="invoices" tableName="Factures" \/>/],
    ["components/stock/stock-view.tsx", /<TableColumnsPanel pageKey="stock" table="warehouseStock" tableName="Stock" \/>/],
    ["components/stock/stock-view.tsx", /<TableColumnsPanel pageKey="stock" table="stockMovements" tableName="Mouvements de stock" \/>/],
    ["components/stock/truck-stock-panel.tsx", /<TableColumnsPanel pageKey="stock" table="truckStock" tableName="Stock camion" \/>/],
    ["components/comptes/accounts-view.tsx", /<TableColumnsPanel pageKey="accounts" table="accounts" tableName="Comptes" \/>/],
  ];
  for (const [file, pattern] of wiring) assert.match(read(file), pattern, file);
});

test("hiding columns never changes the data, the sort, the search, the pagination or the export", () => {
  const accounts = read("components/comptes/accounts-table.tsx");
  // the sort keeps working on every sortable column, from its header button
  assert.match(accounts, /onClick=\{\(\) => onSortChange\(sortable\.key\)\}/);
  const view = read("components/comptes/accounts-view.tsx");
  assert.match(view, /useAccountsPage\(\{ search: debouncedSearch, type, status, city \}, initialPage\)/);
  assert.match(view, /<AccountsExportButton currentType=\{type\} \/>/);
  // the API never receives the column choice
  for (const file of ["components/comptes/use-accounts-page.ts", "components/ventes/use-sales-orders-page.ts", "components/ventes/use-daily-invoices-page.ts", "components/stock/use-stock-movements-page.ts"]) {
    assert.equal(/columns|hidden/.test(read(file)), false, file);
  }
});

test("server: ADMIN only, scoped to the session's own user and organisation, loaded once by the layout", () => {
  const service = read("lib/server/table-preferences.ts");
  for (const fn of ["getMyTablePreferences", "saveMyTablePreference", "resetMyTablePreference"]) {
    assert.match(service, new RegExp(`export async function ${fn}\\([\\s\\S]*?const user = await requireOrganizationUser\\(\\["admin"\\]\\);`), fn);
  }
  assert.match(service, /if \(user\.role !== "admin"\) return \{\};/);
  assert.equal((service.match(/\{ userId: user\.id, organizationId: user\.organizationId \}/g) ?? []).length, 4);
  const core = read("lib/table-columns/preferences-core.ts");
  assert.equal(/userId: scope\.userId, organizationId: scope\.organizationId/.test(core), true);
  const route = read("app/api/table-preferences/route.ts");
  assert.match(route, /export async function PUT\(request: Request\) \{\s*const csrfRejection = rejectUntrustedOrigin\(request\);/);
  assert.match(route, /export async function DELETE\(request: Request\) \{\s*const csrfRejection = rejectUntrustedOrigin\(request\);/);
  const layout = read("app/(dashboard)/layout.tsx");
  assert.match(layout, /const tablePreferences = await getTablePreferencesForShell\(\);/);
  assert.match(layout, /<TableColumnsProvider initialPreferences=\{tablePreferences\}>/);
});
