import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
  assert.match(table, /\{dailyLayout \? "Utilisateur" : "Chauffeur \/ utilisateur"\}/);
  assert.match(table, /\{dailyLayout \? null : <TableHead className="text-right">Net<\/TableHead>\}/);
  assert.match(table, /\{dailyLayout \? null : \(\s*<TableCell className="text-right font-medium tabular-nums">\s*\{formatCurrency\(invoice\.net\)\}/);
  // the expanded detail row spans exactly the visible columns: 10 (daily) / 11 (original)
  assert.match(table, /colSpan=\{dailyLayout \? 10 : 11\}/);
});

test("the displayed user is unchanged: the driver's name, otherwise the creating user", () => {
  assert.match(read("./invoices-table.tsx"), /\{invoice\.driver\?\.name \?\? invoice\.createdByUserName\}/);
});

test("the other columns are all still there", () => {
  const table = read("./invoices-table.tsx");
  for (const head of ["Commande", "Date", "Client", "Articles", "Total", "Paiement", "Statut", "Actions"]) {
    assert.ok(table.includes(`>${head}</TableHead>`), head);
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
