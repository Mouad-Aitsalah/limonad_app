"use client";

import { Search } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CategoriesToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
};

export function CategoriesToolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
}: CategoriesToolbarProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Rechercher par référence ou désignation..."
          aria-label="Rechercher une catégorie"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <Select value={status} onValueChange={(value) => onStatusChange(value ?? "all")}>
        <SelectTrigger className="w-full lg:w-48">
          <SelectValue placeholder="Statut">
            {(value: string | null) =>
              value === "ACTIVE"
                ? "Actif"
                : value === "INACTIVE"
                  ? "Inactif"
                  : "Tous les statuts"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les statuts</SelectItem>
          <SelectItem value="ACTIVE">Actif</SelectItem>
          <SelectItem value="INACTIVE">Inactif</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
