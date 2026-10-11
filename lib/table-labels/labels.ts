import {
  defaultColumnLabel,
  findTablePage,
  pageTableColumns,
  TABLE_PAGES,
  type TableKey,
  type TablePage,
} from "@/lib/table-labels/registry";

/**
 * Custom column labels of the organisation, PER PAGE:
 *   { [pageKey]: { [tableKey]: { [columnKey]: "label" } } }
 * Stored under the "labels" key of Organization.productColumnSettings (the
 * organisation's display-settings JSON, which also holds the /produits column
 * choice under "columns" - the two never overwrite each other). A missing entry
 * = the default label. Pure: browser, server and tests import it.
 */
export type TableLabels = Record<string, Record<string, Record<string, string>>>;
export type PageTableLabels = Record<string, Record<string, string>>;

export const TABLE_LABEL_MAX_LENGTH = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Keeps only what the registry knows for THAT page: its tables, the columns
 * that page shows, non-empty trimmed text up to TABLE_LABEL_MAX_LENGTH. A
 * label equal to the default is not stored (it IS the default).
 */
export function sanitizePageLabels(page: TablePage, value: unknown): PageTableLabels {
  const out: PageTableLabels = {};
  if (!isRecord(value)) return out;
  for (const pageTable of page.tables) {
    const raw = value[pageTable.table];
    if (!isRecord(raw)) continue;
    const tableLabels: Record<string, string> = {};
    for (const { key, defaultLabel } of pageTableColumns(pageTable)) {
      const label = raw[key];
      if (typeof label !== "string") continue;
      const text = label.trim().replace(/\s+/g, " ");
      if (!text || text.length > TABLE_LABEL_MAX_LENGTH || text === defaultLabel) continue;
      tableLabels[key] = text;
    }
    if (Object.keys(tableLabels).length) out[pageTable.table] = tableLabels;
  }
  return out;
}

/** The labels part of the stored JSON, cleaned (unknown pages / tables / columns dropped). */
export function parseTableLabels(stored: unknown): TableLabels {
  const raw = isRecord(stored) ? stored.labels : undefined;
  const out: TableLabels = {};
  if (!isRecord(raw)) return out;
  for (const page of TABLE_PAGES) {
    const pageLabels = sanitizePageLabels(page, raw[page.key]);
    if (Object.keys(pageLabels).length) out[page.key] = pageLabels;
  }
  return out;
}

/** Labels too long or not text are refused (a clear error rather than a silent cut). */
export function findInvalidLabel(page: TablePage, value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const pageTable of page.tables) {
    const raw = value[pageTable.table];
    if (!isRecord(raw)) continue;
    for (const [key, label] of Object.entries(raw)) {
      if (label != null && typeof label !== "string") return `Intitulé invalide pour la colonne « ${key} ».`;
      if (typeof label === "string" && label.trim().length > TABLE_LABEL_MAX_LENGTH) {
        return `Un intitulé ne peut pas dépasser ${TABLE_LABEL_MAX_LENGTH} caractères.`;
      }
    }
  }
  return null;
}

/**
 * The stored display-settings JSON with ONE page's labels replaced (empty =
 * that page back to its defaults). Everything else - the /produits "columns"
 * choice, the other pages - is kept as it is.
 */
export function withPageLabels(stored: unknown, pageKey: string, pageLabels: PageTableLabels): Record<string, unknown> {
  const base = isRecord(stored) ? { ...stored } : {};
  const labels = parseTableLabels(base);
  if (Object.keys(pageLabels).length) labels[pageKey] = pageLabels;
  else delete labels[pageKey];
  if (Object.keys(labels).length) base.labels = labels;
  else delete base.labels;
  return base;
}

/** The label a column shows on a page: the organisation's one, else the default. */
export function resolveColumnLabel(labels: TableLabels, pageKey: string | undefined, table: TableKey, column: string): string {
  const custom = pageKey ? labels[pageKey]?.[table]?.[column] : undefined;
  return custom ?? defaultColumnLabel(table, column);
}

export function customColumnLabel(labels: TableLabels, pageKey: string | undefined, table: TableKey, column: string): string | undefined {
  return pageKey ? labels[pageKey]?.[table]?.[column] : undefined;
}

export { findTablePage };
