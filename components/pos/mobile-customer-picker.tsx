"use client";

import * as React from "react";
import { Check, ChevronDown, User } from "lucide-react";

import { MobileSelectionSheet } from "@/components/pos/mobile-selection-sheet";
import { cn } from "@/lib/utils";
import type { CustomerDto } from "@/types/operations-dto";

const SEARCH_DEBOUNCE_MS = 350;

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 6: the remote search this
 * picker needs, abstracted away from HOW it's actually sent - a plain async
 * function, not a fetch wrapper. Must REJECT (throw) on a genuine failure
 * (non-ok response or network exception) - never resolve to `[]` for that
 * case, which the component's own effect would then be unable to tell apart
 * from "the server legitimately found zero matches". A rejection falls back
 * to filtering `initialSuggestions` locally (see `localCustomerFilter`
 * below) instead of ever showing an empty list purely because a request
 * failed - the exact BUG-01 fix this type exists to carry into the shared
 * component.
 */
export type CustomerSearchFn = (query: string) => Promise<CustomerDto[]>;

/**
 * BUG-05 "RECHERCHE CLIENT PAR NOM OFFLINE" ported verbatim: case- AND
 * accent-insensitive (é/è/à/... fold to their plain letter via
 * `normalize("NFD")` + stripping the combining-mark range). Deliberately
 * plain `toLowerCase()`, never `toLocaleLowerCase("fr")` - removes a
 * possible source of WebView-specific inconsistency. `String(value ?? "")`
 * guards every field so one row with an unexpected null/non-string value
 * can never throw inside `.filter()` and silently blank out the WHOLE
 * result list. Pure - no SQLite, no Capacitor, no mobile/driver import:
 * operates only on the `initialSuggestions` this component already
 * receives as a prop, exactly like the original's own local logic did
 * before this step (there was none - this is genuinely new, but has zero
 * dependency on anything shell-specific).
 */
function normalizeSearchValue(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function localCustomerFilter(customers: CustomerDto[], query: string): CustomerDto[] {
  const normalized = normalizeSearchValue(query);
  if (!normalized) return customers;
  return customers.filter((customer) =>
    [customer.name, customer.displayCode, customer.code, customer.phone].some((field) =>
      normalizeSearchValue(field).includes(normalized),
    ),
  );
}

/** The picker's own, unchanged-in-spirit default: a same-origin GET - what
 *  every existing web call site (POS comptoir, POS chauffeur) still gets
 *  when it doesn't pass `searchCustomers`. The one deliberate refinement
 *  from before this step: a non-ok response now REJECTS instead of
 *  resolving to `{customers: []}` - see `CustomerSearchFn`'s own doc
 *  comment for why that distinction is the actual BUG-01 fix, not an
 *  incidental detail. */
const defaultSearchCustomers: CustomerSearchFn = async (query) => {
  const response = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error("La recherche client a échoué.");
  const body = (await response.json()) as { customers?: CustomerDto[] };
  return body.customers ?? [];
};

type MobileCustomerPickerProps = {
  value: CustomerDto | null;
  onChange: (customer: CustomerDto | null) => void;
  /** Small preloaded set shown before the operator types (same source the
   *  desktop combobox uses). Also the pool `searchCustomers` omitted (or
   *  explicitly `null`) falls back to filtering locally. */
  initialSuggestions: CustomerDto[];
  placeholder?: string;
  /** Applied to the trigger wrapper so the caller can hide it above its
   *  mobile breakpoint (`lg:hidden` counter, `xl:hidden` driver). */
  className?: string;
  /**
   * ÉTAPE 6: optional override for the remote search - see
   * `CustomerSearchFn`'s own doc comment. THREE distinct states:
   *  - omitted (every existing web call site - pos-layout.tsx,
   *    driver-pos-view.tsx): behavior is the same relative, cookie-
   *    authenticated fetch as before this option existed (now with the
   *    BUG-01 local-fallback-on-failure refinement - see
   *    `defaultSearchCustomers`).
   *  - a function: used as the remote transport (e.g. the Android shell's
   *    own Bearer-authenticated search).
   *  - explicitly `null`: remote search is never attempted at all - "le
   *    comportement offline ne doit jamais dépendre d'un fetch". The
   *    caller (the shell) decides per-render whether it currently has a
   *    working transport; this component never needs to know "online" or
   *    "offline" as a concept, only "do I have a way to search remotely
   *    right now".
   * Either way, typing anything ALWAYS also filters `initialSuggestions`
   * locally (`localCustomerFilter`) - a successful remote result wins over
   * it, a missing/failed one falls back to it, never to an empty list.
   */
  searchCustomers?: CustomerSearchFn | null;
  /**
   * ÉTAPE 6: when true, the trigger shows "N° — Nom" instead of just the
   * bare name once a real customer is selected (BUG-05's own validated
   * affordance, so the same identity reads the same way here and in the
   * adjacent N° client box). Defaults to false so every existing web call
   * site renders exactly as before.
   */
  showAccountNumberInTrigger?: boolean;
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
  searchCustomers: searchCustomersProp,
  showAccountNumberInTrigger = false,
}: MobileCustomerPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<{
    forQuery: string;
    customers: CustomerDto[];
  } | null>(null);
  const trimmedQuery = query.trim();

  // `undefined` (prop omitted - every existing web call site) -> the
  // default relative fetch; an explicit function -> that transport is used
  // instead; an explicit `null` -> remote search is skipped entirely, never
  // attempted - see this prop's own doc comment for why `null` and
  // `undefined` mean two different things here (same pattern already used
  // for ReceiptPrint's `identity` prop in ÉTAPE 3).
  const remoteSearch = searchCustomersProp !== undefined ? searchCustomersProp : defaultSearchCustomers;

  React.useEffect(() => {
    if (!open || !trimmedQuery || !remoteSearch) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      remoteSearch(trimmedQuery)
        .then((customers) => {
          if (!cancelled) setSearchResults({ forQuery: trimmedQuery, customers });
        })
        .catch(() => {
          // A real failure (rejection - see CustomerSearchFn's own doc
          // comment) must fall back to the local filter, never to an empty
          // list - the BUG-01 fix this step ports into the shared component.
          if (!cancelled) setSearchResults(null);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Note: an injected remoteSearch is expected to be stable across
    // renders (same contract as any other callback prop - see
    // usePosProductSearch's own searchRemote from ÉTAPE 4); `remoteSearch`
    // is already listed below, so no exhaustive-deps suppression is needed.
  }, [open, trimmedQuery, remoteSearch]);

  const localMatches = React.useMemo(
    () => localCustomerFilter(initialSuggestions, trimmedQuery),
    [initialSuggestions, trimmedQuery],
  );

  // Only ever "awaiting" a real in-flight remote request - no transport
  // available (searchCustomers explicitly null), there is nothing to wait
  // for, so this must never linger true.
  const awaitingResults = Boolean(remoteSearch) && Boolean(trimmedQuery) && searchResults?.forQuery !== trimmedQuery;
  const items: CustomerDto[] = trimmedQuery
    ? remoteSearch && searchResults?.forQuery === trimmedQuery
      ? searchResults.customers
      : localMatches
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
          {value
            ? showAccountNumberInTrigger
              ? `${value.displayCode} - ${value.name}`
              : value.name
            : placeholder}
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
