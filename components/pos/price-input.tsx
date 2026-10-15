"use client";

import * as React from "react";

import {
  IDLE_PRICE_FIELD,
  priceFieldBlur,
  priceFieldChange,
  priceFieldFocus,
  priceFieldText,
} from "@/lib/pos-price-input";

type PriceInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "type" | "inputMode"
> & {
  /** The unit price currently applied (TTC), always a number - never "unknown". */
  value: number;
  /** Called with the price the typed text stands for (an empty field is 0), on every keystroke. */
  onValueChange: (value: number) => void;
};

/**
 * Unit price field of the POS cart. It keeps what the operator types as TEXT while the field has the
 * focus, so it can be empty on the way ("20" -> "2" -> "" -> "15"): the applied price follows the text
 * (empty = 0 DH, zero = 0 DH) and is never replaced by the catalogue price. When the field loses the
 * focus it shows the applied price again ("" -> "0"). Not focused, it always shows `value`, so a price
 * changed from elsewhere (another line, a reloaded cart) is displayed as is. Decimal comma or dot.
 * All the behaviour lives in lib/pos-price-input.ts (pure, unit-tested); this only wires it.
 */
export function PriceInput({ value, onValueChange, onFocus, onBlur, ...inputProps }: PriceInputProps) {
  const [field, setField] = React.useState(IDLE_PRICE_FIELD);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={priceFieldText(field, value)}
      onFocus={(event) => {
        setField(priceFieldFocus(value));
        onFocus?.(event);
      }}
      onChange={(event) => {
        const result = priceFieldChange(field, value, event.target.value);
        setField(result.state);
        if (result.emit !== null) onValueChange(result.emit);
      }}
      onBlur={(event) => {
        const result = priceFieldBlur(field, value);
        setField(result.state);
        if (result.emit !== null) onValueChange(result.emit);
        onBlur?.(event);
      }}
      {...inputProps}
    />
  );
}
