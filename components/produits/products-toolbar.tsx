import { Search } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CategoryOption = {
  value: string;
  label: string;
};

type ProductsToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  categorie: string;
  onCategorieChange: (value: string) => void;
  categories: CategoryOption[];
  disponibilite: string;
  onDisponibiliteChange: (value: string) => void;
};

export function ProductsToolbar({
  search,
  onSearchChange,
  categorie,
  onCategorieChange,
  categories,
  disponibilite,
  onDisponibiliteChange,
}: ProductsToolbarProps) {
  const categorieLabels: Record<string, string> = {
    all: "Toutes les catégories",
    ...Object.fromEntries(categories.map((option) => [option.value, option.label])),
  };

  const disponibiliteLabels: Record<string, string> = {
    all: "Toutes",
    disponible: "Disponible",
    indisponible: "Indisponible",
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1 sm:max-w-sm">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Rechercher une référence, un code-barres, une désignation..."
          aria-label="Rechercher un produit"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <Select
        value={categorie}
        onValueChange={(value) => onCategorieChange(value ?? "all")}
      >
        <SelectTrigger className="w-full sm:w-48">
          <SelectValue placeholder="Catégorie">
            {(value: string | null) => (value ? categorieLabels[value] : "Catégorie")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les catégories</SelectItem>
          {categories.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={disponibilite}
        onValueChange={(value) => onDisponibiliteChange(value ?? "all")}
      >
        <SelectTrigger className="w-full sm:w-44">
          <SelectValue placeholder="Disponibilité">
            {(value: string | null) =>
              value ? disponibiliteLabels[value] : "Disponibilité"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes</SelectItem>
          <SelectItem value="disponible">Disponible</SelectItem>
          <SelectItem value="indisponible">Indisponible</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
