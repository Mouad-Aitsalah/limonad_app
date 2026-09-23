import * as React from "react";
import { Hash } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { customerAccountNumber } from "@/lib/customer-code";
import { cn } from "@/lib/utils";
import type { CustomerDto } from "@/types/operations-dto";

import { apiUrl } from "../lib/api-base";

type ShellCustomerNumberInputProps = {
  token: string | null;
  online: boolean;
  customers: CustomerDto[];
  customer: CustomerDto | null;
  onResolved: (customer: CustomerDto) => void;
  placeholder?: string;
};

function findByAccountNumber(customers: CustomerDto[], trimmed: string): CustomerDto | null {
  return customers.find((candidate) => customerAccountNumber(candidate.code) === trimmed) ?? null;
}

/**
 * CORRECTION "AUCUN CLIENT TROUVÉ HORS CONNEXION" - "8. N° CLIENT OFFLINE":
 * the original fork here had NO offline path at all - `lookup()` always
 * required a successful `/api/customers/by-number` round-trip and had no
 * `customers` list to fall back to. Fixed: it now takes the same cached
 * `context.customers` the picker uses and resolves locally via
 * customerAccountNumber(...) (the exact helper the server route itself
 * uses - lib/customer-code.ts - so "N° client" means the same thing online
 * and offline).
 *
 * BUG-05 "8. RÉSOLUTION AUTOMATIQUE" / "6. RECHERCHE ONLINE" follow-up: the
 * local cache is now checked FIRST, unconditionally - online or offline. A
 * customer already known locally resolves instantly with zero network wait
 * even while online (the earlier version tried the server first every time
 * it had a token, forcing a spinner/round-trip for a number that was
 * already sitting in `customers`). The server is only ever consulted as a
 * fallback for a genuine local cache miss - never trusted over an already-
 * matched local row - and a failed/unreachable server there still falls
 * back to nothing worse than "Client introuvable" (never a resynced sale,
 * never a fabricated match).
 */
export function ShellCustomerNumberInput({
  token,
  online,
  customers,
  customer,
  onResolved,
  placeholder = "ex : 15",
}: ShellCustomerNumberInputProps) {
  const syncedNumber = customer ? customerAccountNumber(customer.code) : "";
  const [value, setValue] = React.useState(syncedNumber);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const selfClearedRef = React.useRef(false);
  const lastSyncedId = React.useRef<string | null>(customer?.id ?? null);

  React.useEffect(() => {
    const id = customer?.id ?? null;
    if (id === lastSyncedId.current) return;
    lastSyncedId.current = id;
    const wasSelfCleared = selfClearedRef.current;
    selfClearedRef.current = false;
    if (wasSelfCleared && customer === null) return;
    setValue(customer ? customerAccountNumber(customer.code) : "");
    setError(null);
  }, [customer]);

  async function lookup() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    if (customer && trimmed === customerAccountNumber(customer.code)) {
      setError(null);
      return;
    }

    // "6./8." - local cache checked FIRST, unconditionally: a number
    // already known on this device resolves instantly, online or offline,
    // with zero network wait. The server is only ever a fallback for a
    // genuine local cache miss (see this file's own doc comment).
    const localMatch = findByAccountNumber(customers, trimmed);
    if (localMatch) {
      onResolved(localMatch);
      toast.success(`Client ${localMatch.displayCode} - ${localMatch.name}`);
      setError(null);
      return;
    }

    if (!online || !token) {
      setError("Client introuvable hors connexion.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/api/customers/by-number?n=${encodeURIComponent(trimmed)}`), {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json()) as { customer?: CustomerDto; message?: string };
      if (!response.ok || !body.customer) {
        setError(body.message ?? "Client introuvable.");
        return;
      }
      onResolved(body.customer);
      toast.success(`Client ${body.customer.displayCode} - ${body.customer.name}`);
      setError(null);
    } catch {
      setError("Recherche impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="shell-customer-number" className="text-xs text-muted-foreground">
        N° Client
      </Label>
      <div className="relative">
        <Hash aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="shell-customer-number"
          value={value}
          placeholder={placeholder}
          inputMode="numeric"
          className={cn("h-11 pl-9 text-base", error && "border-destructive")}
          onChange={(event) => {
            setValue(event.target.value);
            if (event.target.value.trim() === "") {
              selfClearedRef.current = true;
            }
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void lookup();
            }
          }}
          onBlur={() => void lookup()}
        />
      </div>
      {/* "7. N° CLIENT" - a persistent confirmation once the typed number
          matches the currently-resolved customer, so the driver has more
          than a transient toast to confirm who the sale is for - mutually
          exclusive with `error` (both are cleared together on every
          successful resolution and on every edit). */}
      {!error && customer && value.trim() === customerAccountNumber(customer.code) ? (
        <p className="text-xs font-medium text-emerald-700">
          ✓ {customer.displayCode} — {customer.name}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
