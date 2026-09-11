"use client";

import * as React from "react";
import { Check, ChevronDown, Truck } from "lucide-react";

import { MobileSelectionSheet } from "@/components/pos/mobile-selection-sheet";
import type { SupplierOption } from "@/components/pos/supplier-filter";
import { cn } from "@/lib/utils";

// Same sentinel the desktop <SupplierFilter> uses: an explicit
// "Tous les fournisseurs" row that maps back to `null`.
const ALL_OPTION: SupplierOption = { id: "__all__", name: "Tous les fournisseurs" };

type MobileSupplierPickerProps = {
  /** Suppliers derived from the products visible in this POS context - the
   *  exact `supplierOptions` the desktop filter receives. */
  suppliers: SupplierOption[];
  value: SupplierOption | null;
  onChange: (supplier: SupplierOption | null) => void;
  /** Applied to the trigger wrapper (`lg:hidden` counter, unused on driver
   *  where the parent block is already `xl:hidden`). */
  className?: string;
};

/**
 * Mobile-only stand-in for <SupplierFilter>: a field-sized trigger opening a
 * full-screen <MobileSelectionSheet>. Purely a catalogue filter over the
 * already-visible products - it reuses the caller's `supplierFilter` state,
 * never loads suppliers from the database, never changes visibility/stock,
 * never touches the cart.
 */
export function MobileSupplierPicker({
  suppliers,
  value,
  onChange,
  className,
}: MobileSupplierPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const options = React.useMemo<SupplierOption[]>(() => {
    const base = [ALL_OPTION, ...suppliers];
    // Keep the current choice listed even if a search narrowed it out.
    if (value && !suppliers.some((supplier) => supplier.id === value.id)) {
      base.push(value);
    }
    return base;
  }, [suppliers, value]);

  const matching = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr");
    if (!normalized) return options;
    return options.filter((option) => option.name.toLocaleLowerCase("fr").includes(normalized));
  }, [options, query]);

  function closeSheet() {
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={className}>
      <button
        type="button"
        aria-label="Filtrer les produits par fournisseur"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm transition-colors active:bg-accent"
      >
        <Truck aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn("min-w-0 flex-1 truncate text-left", !value && "text-muted-foreground")}>
          {value ? value.name : ALL_OPTION.name}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <MobileSelectionSheet<SupplierOption>
        open={open}
        title="Choisir un fournisseur"
        searchPlaceholder="Rechercher un fournisseur..."
        query={query}
        onQueryChange={setQuery}
        items={matching}
        getItemId={(supplier) => supplier.id}
        selectedId={value?.id ?? ALL_OPTION.id}
        onSelect={(supplier) => {
          onChange(supplier.id === ALL_OPTION.id ? null : supplier);
          closeSheet();
        }}
        onClose={closeSheet}
        emptyMessage="Aucun fournisseur trouvé"
        renderItem={(supplier, selected) => (
          <>
            <span className="flex size-5 shrink-0 items-center justify-center text-primary">
              {selected ? <Check aria-hidden="true" className="size-4" /> : null}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <Truck aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className={cn("truncate text-sm text-foreground", selected && "font-medium")}>
                {supplier.name}
              </span>
            </span>
          </>
        )}
      />
    </div>
  );
}
