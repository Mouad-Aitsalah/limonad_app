import * as React from "react";
import { Check, ChevronDown, User } from "lucide-react";

import { MobileSelectionSheet } from "@/components/pos/mobile-selection-sheet";
import { Label } from "@/components/ui/label";
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

/**
 * BUG-05 "RECHERCHE CLIENT PAR NOM OFFLINE": case- AND accent-insensitive
 * (é/è/à/... fold to their plain letter, same technique PosScreen.tsx's own
 * product search already uses - `normalize("NFD")` splits a diacritic off
 * its base letter, then the combining-mark range is stripped). Deliberately
 * NOT `toLocaleLowerCase("fr")` (the previous version) - a plain
 * `toLowerCase()` has no locale-argument edge case to depend on and is
 * exactly as correct for this use case, removing one more possible source
 * of a WebView-specific inconsistency. `String(... ?? "")` guards every
 * field so one row with an unexpected null/non-string value can never throw
 * inside `.filter()` and silently blank out the WHOLE result list.
 */
function normalizeSearchValue(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function localFilter(customers: CustomerDto[], query: string): CustomerDto[] {
  const normalized = normalizeSearchValue(query);
  if (!normalized) return customers;
  return customers.filter((customer) =>
    [customer.name, customer.displayCode, customer.code, customer.phone].some((field) =>
      normalizeSearchValue(field).includes(normalized),
    ),
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

  const localMatches = React.useMemo(() => {
    const results = localFilter(initialSuggestions, trimmedQuery);
    // BUG-05 "6. DIAGNOSTICS DEV" - non sensitive: counts + the raw typed
    // query only, never a customer's own name/phone/etc.
    if (import.meta.env.DEV && trimmedQuery) {
      console.log("[OFFLINE CUSTOMERS] local search", {
        query: trimmedQuery,
        available: initialSuggestions.length,
        fields: ["name", "displayCode", "code", "phone"],
        results: results.length,
      });
    }
    return results;
  }, [initialSuggestions, trimmedQuery]);

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
    <div className="flex flex-col gap-1">
      <Label htmlFor="shell-customer-picker-trigger" className="text-xs text-muted-foreground">
        Client
      </Label>
      <button
        id="shell-customer-picker-trigger"
        type="button"
        aria-label="Client"
        aria-haspopup="dialog"
        onClick={() => {
          if (import.meta.env.DEV) {
            console.log("[OFFLINE CUSTOMERS] picker source count =", initialSuggestions.length);
          }
          setOpen(true);
        }}
        className="flex h-11 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-base transition-colors active:bg-accent"
      >
        <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn("min-w-0 flex-1 truncate text-left", !value && "text-muted-foreground")}>
          {/* BUG-05 "3. CLIENT COMPTOIR": a real customer never shows just
              its bare name - the N° (displayCode) is already the label the
              driver types into the field right below, so showing it here
              too means the same identity reads the same way in both
              places. No change when nothing is selected - the placeholder
              ("Client comptoir" by default) stays exactly as-is. */}
          {value ? `${value.displayCode} - ${value.name}` : placeholder}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <MobileSelectionSheet<CustomerDto>
        open={open}
        title="Selectionner un client"
        searchPlaceholder="Rechercher par nom, N° client ou telephone..."
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
                N° {customer.displayCode}
                {customer.phone ? ` - ${customer.phone}` : ""}
              </span>
            </span>
          </>
        )}
      />
    </div>
  );
}
