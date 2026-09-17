"use client";

import * as React from "react";
import { Hash } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { customerAccountNumber } from "@/lib/customer-code";
import { cn } from "@/lib/utils";
import type { CustomerDto } from "@/types/operations-dto";

/**
 * PHASE 1 "RESTAURATION DU POS CHAUFFEUR" - ÉTAPE 5: the outcome of
 * resolving one typed account number, abstracted away from HOW that
 * resolution actually happened (a relative fetch, a Bearer fetch, a local
 * SQLite lookup, or any combination) - a plain discriminated union, not a
 * transport detail. Three cases, matching the three distinct messages this
 * box has always shown (see BUG-05's own "9. NUMÉRO INCONNU" - never
 * conflate them):
 *  - "found": the number resolved to a real customer.
 *  - "not_found": a genuine, definitive "no such customer" (a real 404, or
 *    a local cache miss with nothing left to fall back to) - shows
 *    `message` (or the historical "Client introuvable.") and triggers
 *    `onNotFound` exactly like today.
 *  - "error": a real network/technical failure - shows `message` (or the
 *    historical "Recherche impossible.") and never triggers `onNotFound`
 *    (a transient failure is not the same claim as "this customer does not
 *    exist" - see this file's own `lookup()`).
 */
export type CustomerNumberLookupResult =
  | { kind: "found"; customer: CustomerDto }
  | { kind: "not_found"; message?: string }
  | { kind: "error"; message?: string };

export type CustomerNumberResolver = (accountNumber: string) => Promise<CustomerNumberLookupResult>;

/** The box's own, unchanged-since-always default: a same-origin, cookie-
 *  authenticated GET - exactly what every existing web call site (POS
 *  comptoir, POS chauffeur, règlements client) still gets when it doesn't
 *  pass `resolveCustomer`. */
const defaultResolveCustomer: CustomerNumberResolver = async (accountNumber) => {
  try {
    const response = await fetch(`/api/customers/by-number?n=${encodeURIComponent(accountNumber)}`, {
      cache: "no-store",
    });
    const body = (await response.json()) as { customer?: CustomerDto; message?: string };
    if (!response.ok || !body.customer) {
      return { kind: "not_found", message: body.message };
    }
    return { kind: "found", customer: body.customer };
  } catch {
    return { kind: "error" };
  }
};

type CustomerNumberInputProps = {
  /**
   * The customer currently selected in the POS (from the Client combobox, a
   * previous lookup, or a business default). The box mirrors this customer's
   * real account number and clears when it becomes null - the two fields
   * always describe the SAME customer.
   */
  customer: CustomerDto | null;
  /** Called with the resolved customer once a typed number is found. */
  onResolved: (customer: CustomerDto) => void;
  /**
   * Optional: called when a typed number resolves to NOTHING. When provided,
   * the box KEEPS the wrong number and the "Client introuvable" error on
   * screen even if the parent reacts by clearing its `customer` to null - so
   * the operator can see and fix their mistake. Not passed by the POS, whose
   * behaviour is unchanged.
   */
  onNotFound?: () => void;
  /** Optional: where to send focus after a successful lookup (e.g. product search). */
  focusAfterResolve?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  /** Empty-field hint. Defaults to the historical "ex : 15". */
  placeholder?: string;
  /**
   * POS mobile only: hide the visible "N° client" label below the given
   * breakpoint (`lg` counter, `xl` driver) while keeping it for screen
   * readers, and collapse the label gap so the field lines up with the
   * Client field beside it. Other callers omit this and keep the label
   * fully visible.
   */
  hideLabelOnMobile?: "lg" | "xl";
  /**
   * ÉTAPE 5: optional override for how a typed number is actually resolved -
   * see `CustomerNumberResolver`'s own doc comment. Omitted (every existing
   * web call site - pos-layout.tsx, driver-pos-view.tsx,
   * customer-settlements-view.tsx), behavior is byte-for-byte the same
   * relative, cookie-authenticated fetch as before this option existed. The
   * Android shell can inject a resolver that checks its own SQLite
   * `cached_customers` cache first (instant, zero network, online or
   * offline - the exact BUG-05 behavior already validated there) and only
   * falls back to a Bearer-authenticated fetch for a genuine local cache
   * miss - see mobile/driver/src/components/shell-customer-number-input.tsx,
   * whose own local-first `lookup()` this type is meant to let that same
   * logic move behind, not duplicate. This file never imports SQLite or
   * anything under mobile/driver/ itself - the injection point is a plain
   * function type.
   */
  resolveCustomer?: CustomerNumberResolver;
  /**
   * ÉTAPE 5: when true, shows a persistent "✓ N° — Nom" confirmation line
   * once the typed number matches the currently-resolved customer (BUG-05's
   * own validated affordance - a toast alone is transient). Defaults to
   * false so every existing web call site renders exactly as before; the
   * shell will opt in explicitly once it switches to this component.
   */
  showResolvedConfirmation?: boolean;
};

/**
 * The small "N° client" box next to the POS customer combobox.
 *
 * Two-way sync with the Client field:
 *  - Client selected/changed/cleared elsewhere  -> this box shows that
 *    customer's real account counter ("1", "15", ...) or empties.
 *  - Operator types a counter here + Enter/blur -> GET
 *    /api/customers/by-number resolves it (always scoped to the current
 *    organisation, driver visibility included) and selects that customer,
 *    which then flows back through `customer` and re-syncs the box.
 *
 * A missing number shows "Client introuvable" inline - never an error toast
 * stack, never a 500. Nothing here writes to the database.
 */
export function CustomerNumberInput({
  customer,
  onResolved,
  onNotFound,
  focusAfterResolve,
  disabled,
  placeholder = "ex : 15",
  hideLabelOnMobile,
  resolveCustomer = defaultResolveCustomer,
  showResolvedConfirmation = false,
}: CustomerNumberInputProps) {
  // Below the POS mobile breakpoint the label is present for assistive tech
  // (sr-only) but visually gone, and the label gap is removed so the input
  // top-aligns with the Client field. At/above it, everything is as before.
  const labelClassName =
    hideLabelOnMobile === "lg"
      ? "sr-only lg:not-sr-only"
      : hideLabelOnMobile === "xl"
        ? "sr-only xl:not-sr-only"
        : undefined;
  const wrapperClassName =
    hideLabelOnMobile === "lg"
      ? "space-y-2 max-lg:space-y-0"
      : hideLabelOnMobile === "xl"
        ? "space-y-2 max-xl:space-y-0"
        : "space-y-2";
  const syncedNumber = customer ? customerAccountNumber(customer.code) : "";
  const [value, setValue] = React.useState(syncedNumber);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Set right before a not-found lookup asks the parent to clear its
  // customer, so the sync effect below knows the incoming `null` is our own
  // doing and must NOT wipe the wrong number / error off the screen.
  const selfClearedRef = React.useRef(false);

  // Re-mirror the box whenever the selected customer *identity* changes
  // (combobox pick, X clear, a number lookup landing a different customer).
  // Keyed on the id so it never fights the operator while they are typing a
  // number for the same still-selected customer.
  const lastSyncedId = React.useRef<string | null>(customer?.id ?? null);
  React.useEffect(() => {
    const id = customer?.id ?? null;
    if (id === lastSyncedId.current) return;
    lastSyncedId.current = id;
    const wasSelfCleared = selfClearedRef.current;
    selfClearedRef.current = false;
    // Our own not-found just cleared the parent's selection: keep what the
    // operator typed and the "Client introuvable" message visible.
    if (wasSelfCleared && customer === null) return;
    setValue(customer ? customerAccountNumber(customer.code) : "");
    setError(null);
  }, [customer]);

  async function lookup() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    // Already showing this customer - nothing to resolve.
    if (customer && trimmed === customerAccountNumber(customer.code)) {
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await resolveCustomer(trimmed);
      if (result.kind === "found") {
        onResolved(result.customer);
        toast.success(`Client ${result.customer.displayCode} — ${result.customer.name}`);
        setError(null);
        focusAfterResolve?.current?.focus();
        return;
      }
      if (result.kind === "not_found") {
        setError(result.message ?? "Client introuvable.");
        if (onNotFound) {
          selfClearedRef.current = true;
          onNotFound();
        }
        return;
      }
      // "error" - a real network/technical failure, never the same claim as
      // "this customer does not exist" - see CustomerNumberLookupResult's
      // own doc comment. Never triggers onNotFound.
      setError(result.message ?? "Recherche impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={wrapperClassName}>
      <Label
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium text-muted-foreground",
          labelClassName,
        )}
      >
        <Hash aria-hidden="true" className="h-3.5 w-3.5" />
        N° client
      </Label>
      <Input
        value={value}
        inputMode="numeric"
        aria-label="N° client"
        placeholder={placeholder}
        disabled={disabled || loading}
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void lookup();
          }
        }}
        onBlur={() => {
          if (value.trim()) void lookup();
        }}
      />
      {/* ÉTAPE 5 - opt-in only (see `showResolvedConfirmation`'s own doc
          comment): a persistent confirmation once the typed number matches
          the currently-resolved customer - BUG-05's own validated
          affordance on the shell, ported here behind a flag so no existing
          web caller's rendering changes. Mutually exclusive with `error`
          (both are cleared together on every successful resolution and on
          every edit). */}
      {showResolvedConfirmation && !error && customer && value.trim() === customerAccountNumber(customer.code) ? (
        <p className="text-xs font-medium text-emerald-700">
          ✓ {customer.displayCode} — {customer.name}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
