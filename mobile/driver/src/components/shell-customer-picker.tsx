import * as React from "react";
import { Check, ChevronDown, User } from "lucide-react";

import { MobileSelectionSheet } from "@/components/pos/mobile-selection-sheet";
import { cn } from "@/lib/utils";
import type { CustomerDto } from "@/types/operations-dto";

import { apiUrl } from "../lib/api-base";

const SEARCH_DEBOUNCE_MS = 350;

type ShellCustomerPickerProps = {
  token: string | null;
  online: boolean;
  value: CustomerDto | null;
  onChange: (customer: CustomerDto | null) => void;
  initialSuggestions: CustomerDto[];
  placeholder?: string;
};

function localFilter(customers: CustomerDto[], query: string): CustomerDto[] {
  const normalized = query.trim().toLocaleLowerCase("fr");
  if (!normalized) return customers;
  return customers.filter(
    (customer) =>
      customer.name.toLocaleLowerCase("fr").includes(normalized) ||
      customer.displayCode.toLocaleLowerCase("fr").includes(normalized) ||
      (customer.phone ?? "").toLocaleLowerCase("fr").includes(normalized),
  );
}

/**
 * INTÉGRATION POS SHELL - Bearer/absolute-URL fork of components/pos/
 * mobile-customer-picker.tsx (the shell is phone-only, so only the mobile
 * variant is ported - see this phase's own "2. RÉUTILISATION DES
 * COMPOSANTS"). MobileSelectionSheet itself is reused UNCHANGED (no fetch,
 * no Next dependency) - only the trigger's embedded search fetch is forked.
 *
 * CORRECTION "AUCUN CLIENT TROUVÉ HORS CONNEXION" - "7. CUSTOMER PICKER":
 * the original fork here ALWAYS attempted the remote search once a query
 * was typed (gated only on `token`, which the shell keeps even offline -
 * see auth-state.ts's own "NE PAS invalider le token"), and on ANY failure
 * (including a doomed offline fetch) replaced the list with an empty array
 * - silently discarding `initialSuggestions` (the real cached customers)
 * the instant the driver typed anything. Fixed: the remote search is now
 * gated on `online` too, and a failed/never-attempted remote search falls
 * back to filtering `initialSuggestions` LOCALLY (same fields a server
 * search would match: name/N° client/phone) instead of showing nothing.
 * Online behavior is unchanged - a successful remote search still wins
 * (it can reach customers beyond the small offline preload).
 */
export function ShellCustomerPicker({
  token,
  online,
  value,
  onChange,
  initialSuggestions,
  placeholder = "Client comptoir",
}: ShellCustomerPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<{
    forQuery: string;
    customers: CustomerDto[];
  } | null>(null);
  const trimmedQuery = query.trim();

  React.useEffect(() => {
    if (!open || !trimmedQuery || !token || !online) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(apiUrl(`/api/customers/search?q=${encodeURIComponent(trimmedQuery)}`), {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("search failed"))))
        .then((body: { customers?: CustomerDto[] }) => {
          if (!cancelled) setSearchResults({ forQuery: trimmedQuery, customers: body.customers ?? [] });
        })
        .catch(() => {
          // A real network failure (or a non-ok response) here must fall
          // back to the local filter, never to an empty list - see this
          // file's own doc comment.
          if (!cancelled) setSearchResults(null);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, trimmedQuery, token, online]);

  const localMatches = React.useMemo(() => localFilter(initialSuggestions, trimmedQuery), [initialSuggestions, trimmedQuery]);

  // Only ever "awaiting" a real in-flight remote request - offline (or no
  // token), there is nothing to wait for, so this must never linger true.
  const awaitingResults = online && Boolean(trimmedQuery) && searchResults?.forQuery !== trimmedQuery;
  const items: CustomerDto[] = trimmedQuery
    ? online && searchResults?.forQuery === trimmedQuery
      ? searchResults.customers
      : localMatches
    : initialSuggestions;

  function closeSheet() {
    setOpen(false);
    setQuery("");
    setSearchResults(null);
  }

  return (
    <div>
      <button
        type="button"
        aria-label="Client"
        aria-haspopup="dialog"
        onClick={() => {
          if (import.meta.env.DEV) {
            console.log("[OFFLINE CUSTOMERS] picker source count =", initialSuggestions.length);
          }
          setOpen(true);
        }}
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
        title="Selectionner un client"
        searchPlaceholder="Rechercher par nom ou N deg client..."
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
        emptyMessage={awaitingResults ? "Recherche..." : "Aucun client trouve."}
        statusMessage={awaitingResults ? "Recherche..." : null}
        renderItem={(customer, selected) => (
          <>
            <span className="flex size-5 shrink-0 items-center justify-center text-primary">
              {selected ? <Check aria-hidden="true" className="size-4" /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{customer.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                N {customer.displayCode}
                {customer.phone ? ` - ${customer.phone}` : ""}
              </span>
            </span>
          </>
        )}
      />
    </div>
  );
}
