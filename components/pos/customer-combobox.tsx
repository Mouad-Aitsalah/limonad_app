"use client";

import * as React from "react";
import { User } from "lucide-react";

import {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import type { CustomerDto } from "@/types/operations-dto";

const SEARCH_DEBOUNCE_MS = 350;

type CustomerComboboxProps = {
  value: CustomerDto | null;
  onChange: (customer: CustomerDto | null) => void;
  /** Small, bounded starting set (see getPosCustomerPreload) - shown before
   * the user types anything, so the combobox is never empty on open. */
  initialSuggestions: CustomerDto[];
  placeholder?: string;
  label?: string | null;
};

/**
 * Phase 3: replaces the old plain <Select> that received every organization
 * customer as options (components/pos/customer-selector.tsx and the inline
 * <select> in driver-pos-view.tsx, both now unused - see the Phase 3
 * report). Starts from a small preloaded suggestion list and falls back to
 * GET /api/customers/search (debounced) once the cashier/driver types -
 * never loads more than a handful of customers into the browser at once,
 * regardless of how many the organization has.
 */
export function CustomerCombobox({
  value,
  onChange,
  initialSuggestions,
  placeholder = "Selectionner un client",
  label = "Client",
}: CustomerComboboxProps) {
  const [query, setQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<{
    forQuery: string;
    customers: CustomerDto[];
  } | null>(null);
  const trimmedQuery = query.trim();

  React.useEffect(() => {
    if (!trimmedQuery) return;
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
  }, [trimmedQuery]);

  const items: CustomerDto[] = trimmedQuery
    ? searchResults?.forQuery === trimmedQuery
      ? searchResults.customers
      : []
    : initialSuggestions;

  return (
    <div className="space-y-2">
      {label ? (
        <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <User aria-hidden="true" className="h-3.5 w-3.5" />
          {label}
        </Label>
      ) : null}
      <Combobox
        items={items}
        filter={null}
        value={value}
        onValueChange={(customer) => onChange(customer)}
        inputValue={query}
        onInputValueChange={setQuery}
        itemToStringLabel={(customer: CustomerDto | null) => customer?.name ?? ""}
        isItemEqualToValue={(a: CustomerDto, b: CustomerDto) => a.id === b.id}
      >
        <ComboboxInputGroup>
          <ComboboxInput placeholder={value?.name ?? placeholder} />
          <ComboboxClear />
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxEmpty>
            {trimmedQuery && searchResults?.forQuery !== trimmedQuery
              ? "Recherche..."
              : "Aucun client trouve."}
          </ComboboxEmpty>
          {items.map((customer, index) => (
            <ComboboxItem key={customer.id} value={customer} index={index}>
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{customer.name}</span>
                {customer.phone ? (
                  <span className="truncate text-xs text-muted-foreground">{customer.phone}</span>
                ) : null}
              </div>
            </ComboboxItem>
          ))}
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
