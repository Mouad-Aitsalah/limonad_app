import { Search } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { truckStatusConfig, type TruckStatusValue } from "@/components/trucks/truck-status-badge";

type TrucksToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  statut: string;
  onStatutChange: (value: string) => void;
};

const statutLabels: Record<string, string> = {
  all: "Tous les statuts",
  ...Object.fromEntries(
    Object.entries(truckStatusConfig).map(([value, config]) => [
      value,
      config.label,
    ]),
  ),
};

export function TrucksToolbar({
  search,
  onSearchChange,
  statut,
  onStatutChange,
}: TrucksToolbarProps) {
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
          placeholder="Rechercher un code, une immatriculation..."
          aria-label="Rechercher un camion"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <Select value={statut} onValueChange={(value) => onStatutChange(value ?? "all")}>
        <SelectTrigger className="w-full sm:w-48">
          <SelectValue placeholder="Statut">
            {(value: string | null) => (value ? statutLabels[value] : "Statut")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les statuts</SelectItem>
          {(Object.keys(truckStatusConfig) as TruckStatusValue[]).map((value) => (
            <SelectItem key={value} value={value}>
              {truckStatusConfig[value].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
