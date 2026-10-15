"use client";

import { Minus, Plus, Trash2 } from "lucide-react";

import { CLIENT_ORDER_MAX_QUANTITY } from "@/lib/client-portal-rules";
import { cn } from "@/lib/utils";

type ClientQuantityStepperProps = {
  value: number;
  onChange: (value: number) => void;
  label: string;
  /**
   * 1 (default): « − » stops at one unit (the cart has its own delete button).
   * 0: « − » on the last unit takes the product out of the cart (catalogue cards) - shown as a bin.
   */
  min?: 0 | 1;
  /** Stretch to the parent's width (catalogue cards). */
  fullWidth?: boolean;
  className?: string;
};

const buttonClass =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-emerald-700 transition-colors hover:bg-emerald-100 active:bg-emerald-200 disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:outline-none";

/** « − quantity + » with direct typing, bounded to min..CLIENT_ORDER_MAX_QUANTITY - never negative. */
export function ClientQuantityStepper({ value, onChange, label, min = 1, fullWidth = false, className }: ClientQuantityStepperProps) {
  const removesOnMinus = min === 0 && value <= 1;
  return (
    <div
      className={cn(
        "flex h-11 items-center gap-1 rounded-2xl border border-emerald-200 bg-emerald-50 p-0.5",
        fullWidth ? "w-full justify-between" : "w-fit",
        className,
      )}
    >
      <button
        type="button"
        className={buttonClass}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label={removesOnMinus ? `Retirer ${label} du panier` : `Diminuer la quantité de ${label}`}
      >
        {removesOnMinus ? <Trash2 aria-hidden="true" className="h-4 w-4" /> : <Minus aria-hidden="true" className="h-4 w-4" />}
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={Math.max(1, min)}
        max={CLIENT_ORDER_MAX_QUANTITY}
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isInteger(next) && next >= 1) onChange(Math.min(next, CLIENT_ORDER_MAX_QUANTITY));
        }}
        aria-label={`Quantité de ${label}`}
        className={cn(
          "h-10 min-w-0 rounded-lg bg-white text-center text-base font-semibold text-foreground tabular-nums outline-none [appearance:textfield] focus-visible:ring-2 focus-visible:ring-emerald-500/40 [&::-webkit-inner-spin-button]:appearance-none",
          fullWidth ? "flex-1" : "w-12",
        )}
      />
      <button
        type="button"
        className={buttonClass}
        disabled={value >= CLIENT_ORDER_MAX_QUANTITY}
        onClick={() => onChange(Math.min(CLIENT_ORDER_MAX_QUANTITY, value + 1))}
        aria-label={`Augmenter la quantité de ${label}`}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
