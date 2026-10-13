import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { pageTableColumns, TABLE_COLUMNS, TABLE_PAGES } from "@/lib/table-labels/registry";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// The table itself needs the router and the auth context, so its markup is
// checked at the source level (and visually in the browser).

test("daily layout is an opt-in prop, off by default", () => {
  const table = read("./invoices-table.tsx");
  assert.match(table, /dailyLayout\?: boolean;/);
  assert.match(table, /dailyLayout = false/);
});

test("daily layout: the user column is titled 'Utilisateur', the Net column and its cells are not rendered", () => {
  const table = read("./invoices-table.tsx");
  // the prop picks the page whose columns apply (each page keeps its own default
  // columns and its own "Personnaliser les colonnes" preference)
  assert.match(table, /useTableColumns\(dailyLayout \? "dailyInvoices" : "salesArchive", "invoices"\)/);
  const daily = TABLE_PAGES.find((page) => page.key === "dailyInvoices")!.tables.find((entry) => entry.table === "invoices")!;
  const archive = TABLE_PAGES.find((page) => page.key === "salesArchive")!.tables.find((entry) => entry.table === "invoices")!;
  assert.deepEqual(
    pageTableColumns(daily).map((column) => column.key),
    ["order", "date", "customer", "user", "items", "total", "payment", "status", "actions"],
  );
  assert.deepEqual(
    pageTableColumns(archive).map((column) => column.key),
    ["order", "date", "customer", "driverUser", "items", "total", "net", "payment", "status", "actions"],
  );
  // headers go through the organisation's labels (Paramètres -> Personnalisation des tableaux);
  // their defaults are the former texts
  assert.match(table, /\{label\(column\)\}/);
  assert.equal(TABLE_COLUMNS.invoices.columns.user, "Utilisateur");
  assert.equal(TABLE_COLUMNS.invoices.columns.driverUser, "Chauffeur / utilisateur");
  assert.equal(TABLE_COLUMNS.invoices.columns.net, "Net");
  // the net cell is rendered only for the "net" column, with its former classes
  assert.match(table, /case "net":\s*return \(\s*<TableCell key=\{column\} className="text-right font-medium tabular-nums">\s*\{formatCurrency\(invoice\.net\)\}/);
  // the expanded detail row spans exactly the visible columns + the chevron
  assert.match(table, /colSpan=\{columns\.length \+ 1\}/);
});

test("the displayed user is unchanged: the driver's name, otherwise the creating user", () => {
  assert.match(read("./invoices-table.tsx"), /\{invoice\.driver\?\.name \?\? invoice\.createdByUserName\}/);
});

test("the other columns are all still there", () => {
  const table = read("./invoices-table.tsx");
  const heads: Array<[keyof typeof TABLE_COLUMNS.invoices.columns, string]> = [
    ["order", "Commande"], ["date", "Date"], ["customer", "Client"], ["items", "Articles"],
    ["total", "Total"], ["payment", "Paiement"], ["status", "Statut"], ["actions", "Actions"],
  ];
  for (const [key, head] of heads) {
    // every column keeps its own cell renderer (the headers are rendered from the column list)
    assert.ok(table.includes(`case "${key}":`), head);
    assert.equal(TABLE_COLUMNS.invoices.columns[key], head);
  }
  for (const cell of ["invoice.displayNumber", "formatDateTime(invoice.createdAt)", "invoice.articleCount", "formatCurrency(invoice.totalTTC)", "InvoiceStatusBadge"]) {
    assert.ok(table.includes(cell), cell);
  }
});

test("only the daily page opts in; the archives table and the drill-down dialog keep the original columns", () => {
  assert.match(read("./daily-invoices-view.tsx"), /<InvoicesTable invoices=\{data\.items\} onSaleChanged=\{refetch\} dailyLayout \/>/);
  for (const other of ["./orders-tab.tsx", "./invoices-drilldown-dialog.tsx"]) {
    assert.equal(/dailyLayout/.test(read(other)), false, other);
  }
});

test("the net amount itself is not removed from the data or the API", () => {
  assert.match(read("../../types/operations-dto.ts"), /net: number;/);
});
