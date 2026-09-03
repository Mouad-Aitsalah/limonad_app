"use client";

import * as React from "react";
import { Hash } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomerDto } from "@/types/operations-dto";

type CustomerNumberInputProps = {
  /** Called with the resolved customer once a number is found. */
  onResolved: (customer: CustomerDto) => void;
  /** Optional: where to send focus after a successful lookup (e.g. product search). */
  focusAfterResolve?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
};

/**
 * The small "N° client" box next to the POS customer combobox. The operator
 * types just the counter ("1", "15", "125"); GET /api/customers/by-number
 * turns that into "3421/<n>" and returns the customer, always scoped to the
 * current organisation. A missing number shows "Client introuvable" inline -
 * never an error toast stack, never a 500.
 */
export function CustomerNumberInput({
  onResolved,
  focusAfterResolve,
  disabled,
}: CustomerNumberInputProps) {
  const [value, setValue] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function lookup() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
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
        return;
      }
      onResolved(body.customer);
      toast.success(`Client ${body.customer.displayCode} — ${body.customer.name}`);
      setValue("");
      setError(null);
      focusAfterResolve?.current?.focus();
    } catch {
      setError("Recherche impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Hash aria-hidden="true" className="h-3.5 w-3.5" />
        N° client
      </Label>
      <Input
        value={value}
        inputMode="numeric"
        placeholder="ex : 15"
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
