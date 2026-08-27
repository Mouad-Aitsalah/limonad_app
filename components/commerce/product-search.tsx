import { Search } from "lucide-react";

type CommerceProductSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function CommerceProductSearch({
  value,
  onChange,
  placeholder = "Code-barres, reference ou designation...",
  disabled = false,
}: CommerceProductSearchProps) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label="Rechercher un produit"
        disabled={disabled}
        className="h-12 w-full rounded-2xl border border-input bg-card pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  );
}
