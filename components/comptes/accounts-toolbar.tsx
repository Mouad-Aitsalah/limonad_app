import { Search } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AccountsToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  type: string;
  onTypeChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  city: string;
  onCityChange: (value: string) => void;
  cities: string[];
};

const typeLabels: Record<string, string> = {
  all: "Tous les types",
  CUSTOMER: "Clients",
  SUPPLIER: "Fournisseurs",
  EXPENSE: "Charges",
  TREASURY: "Tresorerie",
  EMPLOYEE: "Employes",
};

const statusLabels: Record<string, string> = {
  all: "Tous les statuts",
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  BLOCKED: "Bloque",
};

export function AccountsToolbar({
  search,
  onSearchChange,
  type,
  onTypeChange,
  status,
  onStatusChange,
  city,
  onCityChange,
  cities,
}: AccountsToolbarProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
      <div className="relative flex-1 lg:min-w-[280px]">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Rechercher par nom, code, telephone ou email..."
          aria-label="Rechercher un compte"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <Select value={type} onValueChange={(value) => onTypeChange(value ?? "all")}>
        <SelectTrigger className="w-full lg:w-52">
          <SelectValue placeholder="Type">
            {(value: string | null) => (value ? typeLabels[value] : "Type")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les types</SelectItem>
          <SelectItem value="CUSTOMER">Clients</SelectItem>
          <SelectItem value="SUPPLIER">Fournisseurs</SelectItem>
          <SelectItem value="EXPENSE">Charges</SelectItem>
          <SelectItem value="TREASURY">Tresorerie</SelectItem>
          <SelectItem value="EMPLOYEE">Employes</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={status}
        onValueChange={(value) => onStatusChange(value ?? "all")}
      >
        <SelectTrigger className="w-full lg:w-48">
          <SelectValue placeholder="Statut">
            {(value: string | null) => (value ? statusLabels[value] : "Statut")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les statuts</SelectItem>
          <SelectItem value="ACTIVE">Actif</SelectItem>
          <SelectItem value="INACTIVE">Inactif</SelectItem>
          <SelectItem value="BLOCKED">Bloque</SelectItem>
        </SelectContent>
      </Select>

      <Select value={city} onValueChange={(value) => onCityChange(value ?? "all")}>
        <SelectTrigger className="w-full lg:w-48">
          <SelectValue placeholder="Ville">
            {(value: string | null) => (value ? value : "Ville")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les villes</SelectItem>
          {cities.map((cityOption) => (
            <SelectItem key={cityOption} value={cityOption}>
              {cityOption}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
