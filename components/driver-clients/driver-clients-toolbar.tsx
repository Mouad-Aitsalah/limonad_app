import { Search } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  customerStatusLabels,
  customerTypeLabels,
} from "@/lib/customer-utils";
import type { CustomerStatus, CustomerType } from "@/types/customer";

export type DriverClientFilters = {
  search: string;
  type: CustomerType | "all";
  status: CustomerStatus | "all";
};

type DriverClientsToolbarProps = {
  filters: DriverClientFilters;
  onChange: <K extends keyof DriverClientFilters>(
    key: K,
    value: DriverClientFilters[K],
  ) => void;
};

const customerTypes: CustomerType[] = [
  "epicerie",
  "cafe",
  "restaurant",
  "supermarche",
  "grossiste",
  "client_comptoir",
  "autre",
];

const statuses: CustomerStatus[] = ["actif", "inactif", "bloque"];

export function DriverClientsToolbar({
  filters,
  onChange,
}: DriverClientsToolbarProps) {
  const typeLabels: Record<DriverClientFilters["type"], string> = {
    all: "Tous les types",
    ...customerTypeLabels,
  };
  const statusLabels: Record<DriverClientFilters["status"], string> = {
    all: "Tous les statuts",
    ...customerStatusLabels,
  };

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative flex-1 lg:max-w-md">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onChange("search", event.target.value)}
          placeholder="Rechercher un client..."
          aria-label="Rechercher un client"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <Select
        value={filters.type}
        onValueChange={(value) =>
          onChange("type", (value ?? "all") as DriverClientFilters["type"])
        }
      >
        <SelectTrigger className="h-10 w-full lg:w-52">
          <SelectValue placeholder="Type">
            {(value: DriverClientFilters["type"] | null) =>
              value ? typeLabels[value] : "Type"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les types</SelectItem>
          {customerTypes.map((type) => (
            <SelectItem key={type} value={type}>
              {customerTypeLabels[type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.status}
        onValueChange={(value) =>
          onChange("status", (value ?? "all") as DriverClientFilters["status"])
        }
      >
        <SelectTrigger className="h-10 w-full lg:w-48">
          <SelectValue placeholder="Statut">
            {(value: DriverClientFilters["status"] | null) =>
              value ? statusLabels[value] : "Statut"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les statuts</SelectItem>
          {statuses.map((status) => (
            <SelectItem key={status} value={status}>
              {customerStatusLabels[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
