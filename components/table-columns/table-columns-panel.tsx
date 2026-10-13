"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Columns3, Lock, RotateCcw } from "lucide-react";

import { useColumnLabels } from "@/components/table-labels/table-labels-provider";
import { useTableColumns } from "@/components/table-columns/table-columns-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  defaultTableColumns,
  isDefaultTableColumnPreference,
  moveTableColumn,
  withTableColumnVisibility,
} from "@/lib/table-columns/columns";
import type { TableColumnKey, TableKey } from "@/lib/table-labels/registry";

/**
 * "Personnaliser les colonnes" button + window (ADMIN only - nothing is
 * rendered for another role, and the API refuses them anyway). The window is
 * the app's own Dialog, so it is never clipped by the table's card and fits a
 * phone. Each change updates the table behind at once and is saved for the
 * current user only. Columns can be checked / unchecked and moved up / down;
 * required columns stay visible, "Actions" stays last. Display only: no data
 * is ever touched.
 */
export function TableColumnsPanel<T extends TableKey>({
  pageKey,
  table,
  tableName,
}: {
  /** Page key of lib/table-labels/registry TABLE_PAGES (the same table on two pages = two preferences). */
  pageKey: string;
  table: T;
  /** Table name shown in the window, e.g. "Factures". */
  tableName: string;
}) {
  // Same context as the table's own useTableColumns(): a change re-renders the table at once.
  const state = useTableColumns(pageKey, table);
  const label = useColumnLabels(table);
  const [open, setOpen] = React.useState(false);
  const idPrefix = React.useId();
  const { definition, preference } = state;

  if (!state.canCustomize || !definition || !preference) return null;

  const pinned = defaultTableColumns(definition).filter((key) => definition.pinnedEnd.includes(key));
  const isDefault = isDefaultTableColumnPreference(definition, preference);
  const columnLabel = (key: string) => label(key as TableColumnKey<T>);
  const visibleCount = preference.order.filter((key) => !preference.hidden.includes(key)).length + pinned.length;

  return (
    <>
      <Button type="button" variant="outline" size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Columns3 aria-hidden="true" className="h-4 w-4" />
        Personnaliser les colonnes
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-label={`Colonnes du tableau ${tableName}`}
          className="max-h-[88dvh] gap-4 overflow-y-auto sm:max-w-md"
        >
          <DialogHeader className="gap-1 pr-10">
            <DialogTitle>Colonnes · {tableName}</DialogTitle>
            <DialogDescription>
              Cochez les colonnes à afficher et réglez leur ordre. Pour votre compte uniquement ·{" "}
              <span aria-live="polite">{state.saving ? "enregistrement…" : "enregistré"}</span>
            </DialogDescription>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            {visibleCount} colonne{visibleCount > 1 ? "s" : ""} affichée{visibleCount > 1 ? "s" : ""}
          </p>

          <ul className="space-y-0.5" data-testid="table-columns-list">
            {preference.order.map((key, index) => {
              const required = definition.required.includes(key);
              const visible = !preference.hidden.includes(key);
              const inputId = `${idPrefix}-${key}`;
              return (
                <li key={key} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1 hover:bg-muted/40">
                  <label htmlFor={inputId} className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-sm">
                    <input
                      id={inputId}
                      type="checkbox"
                      className="size-4 shrink-0 accent-emerald-600 disabled:opacity-60"
                      checked={visible}
                      disabled={required}
                      onChange={(event) =>
                        state.save(withTableColumnVisibility(definition, preference, key, event.target.checked))
                      }
                    />
                    <span className={`truncate ${visible ? "text-foreground" : "text-muted-foreground"}`}>
                      {columnLabel(key)}
                    </span>
                    {required ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        <Lock aria-hidden="true" className="size-3" />
                        obligatoire
                      </span>
                    ) : null}
                  </label>
                  <div className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Monter la colonne ${columnLabel(key)}`}
                      disabled={index === 0}
                      onClick={() => state.save(moveTableColumn(preference, key, -1))}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Descendre la colonne ${columnLabel(key)}`}
                      disabled={index === preference.order.length - 1}
                      onClick={() => state.save(moveTableColumn(preference, key, 1))}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
            {pinned.map((key) => (
              <li key={key} className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-muted-foreground">
                <input type="checkbox" className="size-4 accent-emerald-600 opacity-60" checked disabled readOnly aria-label={columnLabel(key)} />
                <span>{columnLabel(key)}</span>
                <span className="inline-flex items-center gap-1 text-[11px]">
                  <Lock aria-hidden="true" className="size-3" />
                  toujours en dernier
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-snug text-muted-foreground">
              Masquer une colonne ne supprime aucune donnée.
            </p>
            <Button type="button" variant="outline" size="sm" disabled={isDefault} onClick={() => state.reset()}>
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              Restaurer par défaut
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
