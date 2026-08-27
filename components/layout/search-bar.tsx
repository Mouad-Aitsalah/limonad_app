import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

type SearchBarProps = {
  className?: string;
};

export function SearchBar({ className }: SearchBarProps) {
  return (
    <div className={cn("relative w-full max-w-md", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        placeholder="Rechercher une page, un produit ou une facture..."
        aria-label="Rechercher"
        className="h-12 w-full rounded-2xl border border-input/90 bg-white/86 pr-4 pl-11 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/12"
      />
    </div>
  );
}
