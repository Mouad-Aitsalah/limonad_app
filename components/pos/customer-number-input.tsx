"use client";

import * as React from "react";
import { Hash } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { customerAccountNumber } from "@/lib/customer-code";
import { cn } from "@/lib/utils";
import type { CustomerDto } from "@/types/operations-dto";

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
      const response = await fetch(
        `/api/customers/by-number?n=${encodeURIComponent(trimmed)}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as { customer?: CustomerDto; message?: string };
      if (!response.ok || !body.customer) {
        setError(body.message ?? "Client introuvable.");
        if (onNotFound) {
          selfClearedRef.current = true;
          onNotFound();
        }
        return;
      }
      onResolved(body.customer);
      toast.success(`Client ${body.customer.displayCode} — ${body.customer.name}`);
      setError(null);
      focusAfterResolve?.current?.focus();
    } catch {
      setError("Recherche impossible.");
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
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
