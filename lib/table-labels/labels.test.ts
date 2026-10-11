import assert from "node:assert/strict";
import { test } from "node:test";

import { getNavigationLinks } from "@/components/layout/navigation";
import {
  findInvalidLabel,
  parseTableLabels,
  resolveColumnLabel,
  sanitizePageLabels,
  withPageLabels,
  TABLE_LABEL_MAX_LENGTH,
} from "@/lib/table-labels/labels";
import { findTablePage, pageTableColumns, TABLE_COLUMNS, TABLE_PAGES, tablePageForPath } from "@/lib/table-labels/registry";

const page = (key: string) => findTablePage(key)!;

test("registry: every page is a real menu entry, every page column exists in its table, keys are unique", () => {
  const menu = new Set(getNavigationLinks("admin").map((link) => `${link.label}|${link.href}`));
  const keys = new Set<string>();
  for (const item of TABLE_PAGES) {
    assert.ok(menu.has(`${item.label}|${item.href}`), `${item.key}: "${item.label}" ${item.href} is not a menu entry`);
    assert.equal(keys.has(item.key), false, item.key);
    keys.add(item.key);
    for (const pageTable of item.tables) {
      const columns = TABLE_COLUMNS[pageTable.table].columns as Record<string, string>;
      for (const { key, defaultLabel } of pageTableColumns(pageTable)) {
        assert.ok(key in columns, `${item.key}.${pageTable.table}.${key}`);
        assert.ok(defaultLabel.length > 0);
      }
    }
  }
  assert.equal(TABLE_PAGES.length, 25);
});

test("the page is found from the URL, the most specific entry wins", () => {
  const cases: Array<[string, string | undefined]> = [
    ["/ventes", "salesArchive"],
    ["/ventes/journalieres", "dailyInvoices"],
    ["/ventes/commandes-en-ligne", "customerOrders"],
    ["/employes", "employees"],
    ["/employes/emp-1", "employees"],
    ["/employes/avances-salaire", "payroll"],
    ["/chargements/loading-1", "loadings"],
    ["/produits/import", "products"],
    ["/achats", "purchases"],
    ["/achats/nouveau", undefined],
    ["/pos", undefined],
    ["/pos/versements", "deposits"],
    ["/parametres/tableaux", undefined],
  ];
  for (const [pathname, expected] of cases) assert.equal(tablePageForPath(pathname)?.key, expected, pathname);
  assert.equal(tablePageForPath(null), undefined);
});

test("a page's labels are cleaned: unknown tables / columns, empty, default and too-long texts are not stored", () => {
  const cleaned = sanitizePageLabels(page("dailyInvoices"), {
    invoices: {
      customer: "  Acheteur   final ",
      net: "Net (absent de cette page)",
      user: "Utilisateur",
      date: "   ",
      payment: "x".repeat(TABLE_LABEL_MAX_LENGTH + 1),
      bogus: "x",
    },
    users: { email: "Courriel" },
    invoiceLines: { quantity: "Quantité" },
  });
  assert.deepEqual(cleaned, { invoices: { customer: "Acheteur final" }, invoiceLines: { quantity: "Quantité" } });
  assert.match(findInvalidLabel(page("dailyInvoices"), { invoices: { payment: "x".repeat(61) } }) ?? "", /60 caractères/);
  assert.equal(findInvalidLabel(page("dailyInvoices"), { invoices: { payment: "Règlement" } }), null);
});

test("each page is independent: the same invoices table has its own labels on Archives and on Factures journalières", () => {
  let stored: unknown = { columns: { photo: false } };
  stored = withPageLabels(stored, "dailyInvoices", { invoices: { customer: "Acheteur" } });
  stored = withPageLabels(stored, "salesArchive", { invoices: { customer: "Client final" } });
  const labels = parseTableLabels(stored);
  assert.equal(resolveColumnLabel(labels, "dailyInvoices", "invoices", "customer"), "Acheteur");
  assert.equal(resolveColumnLabel(labels, "salesArchive", "invoices", "customer"), "Client final");
  // a column not renamed keeps its default; a page without a configuration too
  assert.equal(resolveColumnLabel(labels, "dailyInvoices", "invoices", "date"), "Date");
  assert.equal(resolveColumnLabel(labels, "products", "products", "reference"), "Reference");
  assert.equal(resolveColumnLabel(labels, undefined, "invoices", "customer"), "Client");
  // the Produits column choice stored in the same JSON is untouched
  assert.deepEqual((stored as { columns: unknown }).columns, { photo: false });
});

test("saving one page never touches another; an empty page goes back to its defaults", () => {
  let stored: unknown = withPageLabels(null, "users", { users: { email: "Courriel" } });
  stored = withPageLabels(stored, "products", { products: { reference: "Réf." } });
  stored = withPageLabels(stored, "users", {});
  assert.deepEqual(parseTableLabels(stored), { products: { products: { reference: "Réf." } } });
  stored = withPageLabels(stored, "products", {});
  assert.equal("labels" in (stored as object), false);
});

test("garbage in the stored JSON never breaks a table", () => {
  for (const value of [null, undefined, 3, "x", [], { labels: [] }, { labels: { users: "x" } }, { labels: { nope: { users: { email: "a" } } } }]) {
    assert.deepEqual(parseTableLabels(value), {}, JSON.stringify(value));
  }
});
