import type { Ref } from "react";
import { Search } from "lucide-react";

type ProductSearchProps = {
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
};

export function ProductSearch({ value, onChange, inputRef }: ProductSearchProps) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Code-barres, référence ou désignation..."
        aria-label="Rechercher un produit"
        autoFocus
        className="h-12 w-full rounded-2xl border border-input bg-card pr-4 pl-10 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
      />
    </div>
  );
}
