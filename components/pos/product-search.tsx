"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Search } from "lucide-react";

type ProductSearchProps = {
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function ProductSearch({ value, onChange, inputRef }: ProductSearchProps) {
  const localRef = useRef<HTMLInputElement>(null);
  const searchRef = inputRef ?? localRef;

  useEffect(() => {
    // Mobile must open at the invoice above the grid, without summoning
    // the keyboard. Keep desktop's initial scanner focus unchanged.
    if (window.matchMedia("(min-width: 64rem)").matches) {
      searchRef.current?.focus();
    }
  }, [searchRef]);

  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={searchRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Code-barres, référence ou désignation..."
        aria-label="Rechercher un produit"
        className="h-12 w-full rounded-2xl border border-input bg-card pr-4 pl-10 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
      />
    </div>
  );
}
