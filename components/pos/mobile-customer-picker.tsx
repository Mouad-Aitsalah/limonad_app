"use client";

import * as React from "react";
import { Check, ChevronDown, User } from "lucide-react";

import { MobileSelectionSheet } from "@/components/pos/mobile-selection-sheet";
import { cn } from "@/lib/utils";
import type { CustomerDto } from "@/types/operations-dto";

const SEARCH_DEBOUNCE_MS = 350;

type MobileCustomerPickerProps = {
  value: CustomerDto | null;
  onChange: (customer: CustomerDto | null) => void;
  /** Small preloaded set shown before the operator types (same source the
   *  desktop combobox uses). */
  initialSuggestions: CustomerDto[];
  placeholder?: string;
  /** Applied to the trigger wrapper so the caller can hide it above its
   *  mobile breakpoint (`lg:hidden` counter, `xl:hidden` driver). */
  className?: string;
};

/**
 * Mobile-only stand-in for <CustomerCombobox>: a field-sized trigger that
 * opens a full-screen <MobileSelectionSheet> to pick the client. Selecting a
 * row calls the exact same `onChange` the combobox does (POS keeps its
 * Client <-> N° client sync untouched) and closes the sheet. Never touches
 * the cart.
 */
export function MobileCustomerPicker({
  value,
  onChange,
  initialSuggestions,
  placeholder = "Sélectionner un client",
  className,
}: MobileCustomerPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<{
    forQuery: string;
    customers: CustomerDto[];
  } | null>(null);
  const trimmedQuery = query.trim();

  React.useEffect(() => {
    if (!open || !trimmedQuery) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/customers/search?q=${encodeURIComponent(trimmedQuery)}`)
        .then((response) => (response.ok ? response.json() : { customers: [] }))
        .then((body: { customers?: CustomerDto[] }) => {
          if (!cancelled) setSearchResults({ forQuery: trimmedQuery, customers: body.customers ?? [] });
        })
        .catch(() => {
          if (!cancelled) setSearchResults({ forQuery: trimmedQuery, customers: [] });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, trimmedQuery]);

  const awaitingResults = Boolean(trimmedQuery) && searchResults?.forQuery !== trimmedQuery;
  const items: CustomerDto[] = trimmedQuery
    ? searchResults?.forQuery === trimmedQuery
      ? searchResults.customers
      : []
    : initialSuggestions;

  function closeSheet() {
    setOpen(false);
    setQuery("");
    setSearchResults(null);
  }

  return (
    <div className={className}>
      <button
        type="button"
        aria-label="Client"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm transition-colors active:bg-accent"
      >
        <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn("min-w-0 flex-1 truncate text-left", !value && "text-muted-foreground")}>
          {value?.name ?? placeholder}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <MobileSelectionSheet<CustomerDto>
        open={open}
        title="Sélectionner un client"
        searchPlaceholder="Rechercher par nom ou N° client..."
        query={query}
        onQueryChange={setQuery}
        items={items}
        getItemId={(customer) => customer.id}
        selectedId={value?.id ?? null}
        onSelect={(customer) => {
          onChange(customer);
          closeSheet();
        }}
        onClose={closeSheet}
        emptyMessage={awaitingResults ? "Recherche..." : "Aucun client trouvé"}
        statusMessage={awaitingResults ? "Recherche..." : null}
        renderItem={(customer, selected) => (
          <>
            <span className="flex size-5 shrink-0 items-center justify-center text-primary">
              {selected ? <Check aria-hidden="true" className="size-4" /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{customer.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                N° {customer.displayCode}
                {customer.phone ? ` · ${customer.phone}` : ""}
              </span>
            </span>
          </>
        )}
      />
    </div>
  );
}
