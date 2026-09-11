"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Search } from "lucide-react";

import { cn } from "@/lib/utils";

export type MobileSelectionSheetProps<T> = {
  /** The sheet renders (into a body portal) only while this is true. */
  open: boolean;
  /** Sticky header title, e.g. "Sélectionner un client". */
  title: string;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  items: T[];
  getItemId: (item: T) => string;
  /** Id of the row that should carry the ✓ marker, or null. */
  selectedId: string | null;
  renderItem: (item: T, selected: boolean) => React.ReactNode;
  /** Called with the tapped row - the caller selects it and closes the sheet. */
  onSelect: (item: T) => void;
  /** Close the sheet only - no route change, cart untouched. */
  onClose: () => void;
  emptyMessage: string;
  /** Optional discreet line under the search (e.g. "Recherche..."). */
  statusMessage?: string | null;
};

/**
 * Full-screen mobile picker shared by the POS Client and Fournisseur
 * selectors (counter + driver). Presentation and interaction only: it never
 * fetches, never touches the cart - it just shows `items`, reports the tapped
 * one through `onSelect`, and closes through `onClose`. Desktop keeps its own
 * combobox; this component is mounted for mobile breakpoints only.
 */
export function MobileSelectionSheet<T>({
  open,
  title,
  searchPlaceholder,
  query,
  onQueryChange,
  items,
  getItemId,
  selectedId,
  renderItem,
  onSelect,
  onClose,
  emptyMessage,
  statusMessage,
}: MobileSelectionSheetProps<T>) {
  const searchRef = React.useRef<HTMLInputElement>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);

  // Lock the page behind the sheet, focus the search, and hand focus back to
  // the trigger when it closes.
  React.useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // `open` is parent state that starts false and only flips on a user tap, so
  // this component renders null through SSR and hydration and reaches the
  // portal on the client only.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-background"
      style={{ height: "100dvh" }}
    >
      <header
        className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-2 py-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Retour"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-accent active:bg-accent"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</h2>
      </header>

      <div className="shrink-0 border-b border-border bg-background px-4 py-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={searchRef}
            type="search"
            inputMode="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-xl border border-input bg-background pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        {statusMessage ? (
          <p className="mt-2 text-xs text-muted-foreground">{statusMessage}</p>
        ) : null}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        {items.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const id = getItemId(item);
              const selected = id === selectedId;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-transform duration-100 active:scale-[0.99] active:bg-accent",
                      selected && "bg-accent/50",
                    )}
                  >
                    {renderItem(item, selected)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
