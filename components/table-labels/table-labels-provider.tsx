"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { customColumnLabel, resolveColumnLabel, type TableLabels } from "@/lib/table-labels/labels";
import { tablePageForPath, type TableColumnKey, type TableKey } from "@/lib/table-labels/registry";

/**
 * The organisation's custom column labels, loaded once by the dashboard layout
 * (server side, so a table never flashes its default labels) and shared with
 * every table. Without a provider (tests, screens outside the dashboard) every
 * column simply shows its default label.
 */
type TableLabelsContextValue = {
  labels: TableLabels;
  /** After a save in Paramètres: show the new labels at once. */
  setLabels: (labels: TableLabels) => void;
};

const TableLabelsContext = React.createContext<TableLabelsContextValue>({
  labels: {},
  setLabels: () => {},
});

export function TableLabelsProvider({
  initialLabels,
  children,
}: {
  initialLabels: TableLabels;
  children: React.ReactNode;
}) {
  // A save replaces the server value until the next full load (which then
  // carries the same labels) - no effect needed to keep them in sync.
  const [saved, setSaved] = React.useState<TableLabels | null>(null);
  const value = React.useMemo<TableLabelsContextValue>(
    () => ({ labels: saved ?? initialLabels, setLabels: setSaved }),
    [saved, initialLabels],
  );
  return <TableLabelsContext.Provider value={value}>{children}</TableLabelsContext.Provider>;
}

export function useTableLabelsContext() {
  return React.useContext(TableLabelsContext);
}

export type ColumnLabeler<K extends string> = ((column: K) => string) & {
  /** The organisation's label only (undefined = not renamed) - for a column
   *  whose default text differs between phone and desktop. */
  custom: (column: K) => string | undefined;
};

/**
 * `const label = useColumnLabels("invoices"); <TableHead>{label("date")}</TableHead>`
 * The page is read from the URL, so the same table component configured on two
 * pages shows each page's own labels.
 */
export function useColumnLabels<T extends TableKey>(table: T): ColumnLabeler<TableColumnKey<T>> {
  const pathname = usePathname();
  const { labels } = React.useContext(TableLabelsContext);
  const pageKey = tablePageForPath(pathname)?.key;
  return React.useMemo(
    () =>
      Object.assign((column: TableColumnKey<T>) => resolveColumnLabel(labels, pageKey, table, column), {
        custom: (column: TableColumnKey<T>) => customColumnLabel(labels, pageKey, table, column),
      }),
    [labels, pageKey, table],
  );
}
