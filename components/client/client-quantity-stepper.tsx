"use client";

import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CLIENT_ORDER_MAX_QUANTITY } from "@/lib/client-portal-rules";

type ClientQuantityStepperProps = {
  value: number;
  onChange: (value: number) => void;
  label: string;
};

/** - / quantity / + with direct typing, bounded to 1..CLIENT_ORDER_MAX_QUANTITY. */
export function ClientQuantityStepper({ value, onChange, label }: ClientQuantityStepperProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        aria-label={`Diminuer la quantité de ${label}`}
      >
        <Minus aria-hidden="true" className="h-4 w-4" />
      </Button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={CLIENT_ORDER_MAX_QUANTITY}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isInteger(next) && next >= 1) onChange(Math.min(next, CLIENT_ORDER_MAX_QUANTITY));
        }}
        aria-label={`Quantité de ${label}`}
        className="h-9 w-14 rounded-lg border border-input bg-white text-center text-sm font-medium tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={value >= CLIENT_ORDER_MAX_QUANTITY}
        onClick={() => onChange(value + 1)}
        aria-label={`Augmenter la quantité de ${label}`}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}
