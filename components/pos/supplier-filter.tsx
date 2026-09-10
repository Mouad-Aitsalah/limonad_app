"use client";

import * as React from "react";
import { Truck } from "lucide-react";

import {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
} from "@/components/ui/combobox";

export type SupplierOption = { id: string; name: string };

// Sentinel row so "Tous les fournisseurs" is an explicit choice in the list,
// not only the empty/placeholder state.
const ALL_OPTION: SupplierOption = { id: "__all__", name: "Tous les fournisseurs" };

type SupplierFilterProps = {
  /** Suppliers derived from the products currently visible in this POS
   *  context (already org- and, for a driver, truck-scoped). */
  suppliers: SupplierOption[];
  /** Selected supplier, or null for "Tous les fournisseurs". Carries its own
   *  name so the label survives even if the supplier drops out of `suppliers`
   *  after a search narrows the visible products. */
  value: SupplierOption | null;
  onChange: (supplier: SupplierOption | null) => void;
  className?: string;
};

/**
 * Mobile-only "Fournisseur" filter shown under the product search on the POS
 * "Les produits" view. Purely a catalogue filter layered AFTER the existing
 * visibility/stock rules - it never changes which products a role may see or
 * sell, never touches the cart. Reuses the shared searchable combobox.
 */
export function SupplierFilter({ suppliers, value, onChange, className }: SupplierFilterProps) {
  const [query, setQuery] = React.useState("");

  const options = React.useMemo<SupplierOption[]>(() => {
    const base = [ALL_OPTION, ...suppliers];
    // Keep the current selection listed even if a search narrowed it out.
    if (value && !suppliers.some((supplier) => supplier.id === value.id)) {
      base.push(value);
    }
    return base;
  }, [suppliers, value]);

  const matching = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr");
    if (!normalized) return options;
    return options.filter((option) =>
      option.name.toLocaleLowerCase("fr").includes(normalized),
    );
  }, [options, query]);

  const selected = value ?? ALL_OPTION;

  return (
    <div className={className}>
      <Combobox
        items={matching}
        filter={null}
        value={selected}
        onValueChange={(supplier: SupplierOption | null) => {
          // Clear the search text so re-opening shows the full supplier list,
          // not just the row that matches the current selection's label.
          setQuery("");
          onChange(!supplier || supplier.id === ALL_OPTION.id ? null : supplier);
        }}
        inputValue={query}
        onInputValueChange={setQuery}
        // Keep the input empty after a pick (the selection shows in the
        // placeholder) so re-opening always lists every supplier, never just
        // the row matching the previous choice's label.
        itemToStringLabel={() => ""}
        isItemEqualToValue={(a: SupplierOption, b: SupplierOption) => a.id === b.id}
      >
        <ComboboxInputGroup>
          <ComboboxInput
            aria-label="Filtrer les produits par fournisseur"
            placeholder={value ? value.name : ALL_OPTION.name}
          />
          {value ? <ComboboxClear /> : null}
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxEmpty>Aucun fournisseur.</ComboboxEmpty>
          {matching.map((supplier, index) => (
            <ComboboxItem key={supplier.id} value={supplier} index={index}>
              <span className="flex min-w-0 items-center gap-1.5">
                <Truck aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{supplier.name}</span>
              </span>
            </ComboboxItem>
          ))}
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
