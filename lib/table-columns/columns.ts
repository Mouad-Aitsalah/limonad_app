import {
  findTablePage,
  pageTableColumns,
  type TableKey,
  type TablePageTable,
} from "@/lib/table-labels/registry";

/**
 * "Personnaliser les colonnes" (ADMIN only): which columns a table shows, and in
 * which order, for ONE user in ONE organisation (UserTablePreference). The
 * tables and their default columns/order come from the shared table registry
 * (lib/table-labels/registry.ts, TABLE_PAGES) - the default is exactly what
 * each table showed before this feature.
 *
 * Display only: a hidden column keeps its data (the rows, the search, the
 * filters, the sort, the pagination and the exports never change). A required
 * column can be moved but never hidden; a column pinned at the end ("Actions")
 * stays last and visible.
 *
 * Stored shape: { "order": [column keys], "hidden": [column keys] }. Anything
 * stale or invalid (unknown table, unknown column, duplicates, a required column
 * marked hidden, not an array...) is dropped on read, so the worst case is the
 * default columns. Pure: the browser, the server and the tests import it.
 */

export type ConfigurableTableDefinition = {
  /** "<page key>.<table key>" - the key stored in UserTablePreference.tableKey. */
  key: string;
  pageKey: string;
  table: TableKey;
  /** Always visible (they identify the row). */
  required: readonly string[];
  /** Always visible AND always last (row actions). */
  pinnedEnd: readonly string[];
};

export const CONFIGURABLE_TABLES: readonly ConfigurableTableDefinition[] = [
  { key: "salesArchive.invoices", pageKey: "salesArchive", table: "invoices", required: ["order"], pinnedEnd: ["actions"] },
  { key: "salesArchive.archiveSessions", pageKey: "salesArchive", table: "archiveSessions", required: ["session"], pinnedEnd: ["actions"] },
  { key: "salesArchive.archiveMonths", pageKey: "salesArchive", table: "archiveMonths", required: ["month"], pinnedEnd: [] },
  { key: "dailyInvoices.invoices", pageKey: "dailyInvoices", table: "invoices", required: ["order"], pinnedEnd: ["actions"] },
  { key: "stock.warehouseStock", pageKey: "stock", table: "warehouseStock", required: ["product"], pinnedEnd: [] },
  { key: "stock.truckStock", pageKey: "stock", table: "truckStock", required: ["product"], pinnedEnd: ["actions"] },
  { key: "stock.stockMovements", pageKey: "stock", table: "stockMovements", required: ["number"], pinnedEnd: [] },
  { key: "accounts.accounts", pageKey: "accounts", table: "accounts", required: ["accountNumber", "name"], pinnedEnd: ["actions"] },
];

export type TableColumnPreference = { order: string[]; hidden: string[] };
export type TableColumnPreferences = Record<string, TableColumnPreference>;

export function tableColumnsKey(pageKey: string, table: TableKey): string {
  return `${pageKey}.${table}`;
}

export function findConfigurableTable(key: string): ConfigurableTableDefinition | undefined {
  return CONFIGURABLE_TABLES.find((table) => table.key === key);
}

/** The page's own column list for that table, in the table's current order. */
export function defaultTableColumns(definition: ConfigurableTableDefinition): string[] {
  const page = findTablePage(definition.pageKey);
  const pageTable = page?.tables.find((entry: TablePageTable) => entry.table === definition.table);
  return pageTable ? pageTableColumns(pageTable).map((column) => column.key) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Whatever is stored or sent -> a clean preference for that table: the order
 * keeps the known columns once each (pinned columns excluded), any column
 * missing from it is appended in its default place order, and only optional
 * columns can be hidden.
 */
export function sanitizeTableColumnPreference(
  definition: ConfigurableTableDefinition,
  value: unknown,
): TableColumnPreference {
  const defaults = defaultTableColumns(definition);
  const movable = defaults.filter((key) => !definition.pinnedEnd.includes(key));
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const order: string[] = [];
  for (const key of stringArray(raw.order)) {
    if (movable.includes(key) && !order.includes(key)) order.push(key);
  }
  for (const key of movable) if (!order.includes(key)) order.push(key);
  const hidden = movable.filter(
    (key) => stringArray(raw.hidden).includes(key) && !definition.required.includes(key),
  );
  return { order, hidden };
}

/** The columns to render, in order (pinned columns last), hidden ones left out. */
export function visibleTableColumns(
  definition: ConfigurableTableDefinition,
  preference: TableColumnPreference | undefined,
): string[] {
  const clean = sanitizeTableColumnPreference(definition, preference);
  const pinned = defaultTableColumns(definition).filter((key) => definition.pinnedEnd.includes(key));
  return [...clean.order.filter((key) => !clean.hidden.includes(key)), ...pinned];
}

export function isDefaultTableColumnPreference(
  definition: ConfigurableTableDefinition,
  preference: TableColumnPreference,
): boolean {
  const defaults = defaultTableColumns(definition).filter((key) => !definition.pinnedEnd.includes(key));
  return preference.hidden.length === 0 && preference.order.join("|") === defaults.join("|");
}

/** The stored rows -> preferences of the configurable tables only (stale rows ignored). */
export function parseTableColumnPreferences(
  rows: ReadonlyArray<{ tableKey: string; settings: unknown }>,
): TableColumnPreferences {
  const out: TableColumnPreferences = {};
  for (const row of rows) {
    const definition = findConfigurableTable(row.tableKey);
    if (definition) out[definition.key] = sanitizeTableColumnPreference(definition, row.settings);
  }
  return out;
}

/** Moves one column up (-1) or down (+1) in the order; pinned columns never move. */
export function moveTableColumn(
  preference: TableColumnPreference,
  key: string,
  direction: -1 | 1,
): TableColumnPreference {
  const index = preference.order.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= preference.order.length) return preference;
  const order = [...preference.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { ...preference, order };
}

export function withTableColumnVisibility(
  definition: ConfigurableTableDefinition,
  preference: TableColumnPreference,
  key: string,
  visible: boolean,
): TableColumnPreference {
  if (definition.required.includes(key) || definition.pinnedEnd.includes(key)) return preference;
  const hidden = visible ? preference.hidden.filter((item) => item !== key) : [...new Set([...preference.hidden, key])];
  return { ...preference, hidden };
}
