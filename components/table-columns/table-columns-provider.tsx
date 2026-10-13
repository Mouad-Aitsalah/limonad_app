"use client";

import * as React from "react";
import { toast } from "sonner";

import { AuthContext } from "@/hooks/use-auth";
import {
  defaultTableColumns,
  findConfigurableTable,
  sanitizeTableColumnPreference,
  tableColumnsKey,
  visibleTableColumns,
  type ConfigurableTableDefinition,
  type TableColumnPreference,
  type TableColumnPreferences,
} from "@/lib/table-columns/columns";
import { findTablePage, pageTableColumns, type TableColumnKey, type TableKey } from "@/lib/table-labels/registry";

/**
 * The signed-in admin's column preferences (lib/table-columns), loaded once by
 * the dashboard layout so a table never flashes its default columns. A change
 * shows at once and is saved for this user only (PUT /api/table-preferences);
 * a refused save puts the previous columns back. Without a provider (tests,
 * screens outside the dashboard) every table shows its default columns.
 */
type TableColumnsContextValue = {
  preferences: TableColumnPreferences;
  setPreference: (tableKey: string, preference: TableColumnPreference | null) => void;
};

const TableColumnsContext = React.createContext<TableColumnsContextValue>({
  preferences: {},
  setPreference: () => {},
});

export function TableColumnsProvider({
  initialPreferences,
  children,
}: {
  initialPreferences: TableColumnPreferences;
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] = React.useState(initialPreferences);
  const setPreference = React.useCallback((tableKey: string, preference: TableColumnPreference | null) => {
    setPreferences((current) => {
      const next = { ...current };
      if (preference) next[tableKey] = preference;
      else delete next[tableKey];
      return next;
    });
  }, []);
  const value = React.useMemo(() => ({ preferences, setPreference }), [preferences, setPreference]);
  return <TableColumnsContext.Provider value={value}>{children}</TableColumnsContext.Provider>;
}

export type TableColumnsState<K extends string> = {
  /** The columns to render, in order (hidden ones left out). */
  columns: K[];
  isVisible: (column: K) => boolean;
  /** Null when this table is not configurable on that page. */
  definition: ConfigurableTableDefinition | null;
  /** The effective preference (default when the user never customised). */
  preference: TableColumnPreference | null;
  /** Only an admin customises (the API refuses every other role anyway). */
  canCustomize: boolean;
  saving: boolean;
  save: (preference: TableColumnPreference) => void;
  reset: () => void;
};

/**
 * `const { columns } = useTableColumns("stock", "warehouseStock")` - the page
 * key is explicit (the same table component lives on several pages, each with
 * its own columns and its own preference).
 */
export function useTableColumns<T extends TableKey>(pageKey: string, table: T): TableColumnsState<TableColumnKey<T>> {
  type K = TableColumnKey<T>;
  const { preferences, setPreference } = React.useContext(TableColumnsContext);
  // No AuthProvider (unit tests) = nobody can customise; the API refuses non-admins anyway.
  const role = React.useContext(AuthContext)?.currentUser?.role;
  const [saving, setSaving] = React.useState(false);
  // Saves are chained so two quick changes reach the server in order.
  const queueRef = React.useRef<Promise<void>>(Promise.resolve());

  const definition = findConfigurableTable(tableColumnsKey(pageKey, table)) ?? null;
  const stored = definition ? preferences[definition.key] : undefined;
  const preference = definition ? sanitizeTableColumnPreference(definition, stored) : null;
  const columns = (definition ? visibleTableColumns(definition, stored) : pageDefaultColumns(pageKey, table)) as K[];

  const send = React.useCallback(
    (next: TableColumnPreference | null, previous: TableColumnPreference | undefined) => {
      if (!definition) return;
      setPreference(definition.key, next);
      queueRef.current = queueRef.current.then(async () => {
        setSaving(true);
        try {
          const response = next
            ? await fetch("/api/table-preferences", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ table: definition.key, ...next }),
              })
            : await fetch(`/api/table-preferences?table=${encodeURIComponent(definition.key)}`, { method: "DELETE" });
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { message?: string };
            throw new Error(body.message ?? "Impossible d'enregistrer les colonnes.");
          }
        } catch (error) {
          setPreference(definition.key, previous ?? null);
          toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer les colonnes.");
        } finally {
          setSaving(false);
        }
      });
    },
    [definition, setPreference],
  );

  return {
    columns,
    isVisible: (column: K) => columns.includes(column),
    definition,
    preference,
    canCustomize: Boolean(definition) && role === "admin",
    saving,
    save: (next) => send(next, stored),
    reset: () => send(null, stored),
  };
}

/** A table that is not configurable on that page keeps the page's own columns. */
function pageDefaultColumns(pageKey: string, table: TableKey): string[] {
  const pageTable = findTablePage(pageKey)?.tables.find((entry) => entry.table === table);
  if (pageTable) return pageTableColumns(pageTable).map((column) => column.key);
  const definition = findConfigurableTable(tableColumnsKey(pageKey, table));
  return definition ? defaultTableColumns(definition) : [];
}
