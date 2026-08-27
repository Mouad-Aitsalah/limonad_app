import { Search } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StockFilters } from "@/lib/stock-calculations";

type FilterOption = {
  value: string;
  label: string;
};

type StockToolbarProps = {
  filters: StockFilters;
  categories: FilterOption[];
  brands: FilterOption[];
  suppliers: FilterOption[];
  onChange: <K extends keyof StockFilters>(
    key: K,
    value: StockFilters[K],
  ) => void;
};

export function StockToolbar({
  filters,
  categories,
  brands,
  suppliers,
  onChange,
}: StockToolbarProps) {
  const categoryLabels = toLabels("Toutes les categories", categories);
  const brandLabels = toLabels("Toutes les marques", brands);
  const supplierLabels = toLabels("Tous les fournisseurs", suppliers);

  return (
    <div className="space-y-3">
      <div className="relative max-w-xl">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onChange("search", event.target.value)}
          placeholder="Rechercher un produit..."
          aria-label="Rechercher un produit dans le stock"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={filters.categoryId}
          onValueChange={(value) => onChange("categoryId", value ?? "all")}
        >
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Categorie">
              {(value: string | null) =>
                value ? categoryLabels[value] : "Categorie"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les categories</SelectItem>
            {categories.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.brandId}
          onValueChange={(value) => onChange("brandId", value ?? "all")}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Marque">
              {(value: string | null) => (value ? brandLabels[value] : "Marque")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les marques</SelectItem>
            {brands.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.supplierId}
          onValueChange={(value) => onChange("supplierId", value ?? "all")}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Fournisseur">
              {(value: string | null) =>
                value ? supplierLabels[value] : "Fournisseur"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les fournisseurs</SelectItem>
            {suppliers.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function toLabels(defaultLabel: string, options: FilterOption[]): Record<string, string> {
  return {
    all: defaultLabel,
    ...Object.fromEntries(options.map((option) => [option.value, option.label])),
  };
}
