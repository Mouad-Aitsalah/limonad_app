import { Search } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { CreditNoteStatus } from "@/types/credit-note";

export type CreditNoteFilters = {
  search: string;
  date: string;
  clientId: string;
  status: CreditNoteStatus | "all";
  origin: "all" | "comptoir" | "camion";
};

type ClientOption = {
  id: string;
  label: string;
};

type CreditNotesToolbarProps = {
  filters: CreditNoteFilters;
  clients: ClientOption[];
  onChange: <K extends keyof CreditNoteFilters>(
    key: K,
    value: CreditNoteFilters[K],
  ) => void;
};

export function CreditNotesToolbar({
  filters,
  clients,
  onChange,
}: CreditNotesToolbarProps) {
  const clientLabels: Record<string, string> = {
    all: "Tous les clients",
    ...Object.fromEntries(clients.map((client) => [client.id, client.label])),
  };

  const statusLabels: Record<CreditNoteFilters["status"], string> = {
    all: "Tous les statuts",
    BROUILLON: "Brouillon",
    VALIDE: "Valide",
    CONTREPASSE: "Contrepasse",
  };

  const originLabels: Record<CreditNoteFilters["origin"], string> = {
    all: "Toutes les origines",
    comptoir: "Comptoir",
    camion: "Camion",
  };

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
      <div className="relative flex-1 xl:max-w-md">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onChange("search", event.target.value)}
          placeholder="Rechercher un avoir, une facture, un client..."
          aria-label="Rechercher un avoir"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <Input
        type="date"
        value={filters.date}
        onChange={(event) => onChange("date", event.target.value)}
        aria-label="Filtrer par date"
        className="h-10 w-full xl:w-40"
      />

      <Select
        value={filters.clientId}
        onValueChange={(value) => onChange("clientId", value ?? "all")}
      >
        <SelectTrigger className="h-10 w-full xl:w-52">
          <SelectValue placeholder="Client">
            {(value: string | null) => (value ? clientLabels[value] : "Client")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les clients</SelectItem>
          {clients.map((client) => (
            <SelectItem key={client.id} value={client.id}>
              {client.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.status}
        onValueChange={(value) =>
          onChange("status", (value ?? "all") as CreditNoteFilters["status"])
        }
      >
        <SelectTrigger className="h-10 w-full xl:w-44">
          <SelectValue placeholder="Statut">
            {(value: CreditNoteFilters["status"] | null) =>
              value ? statusLabels[value] : "Statut"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les statuts</SelectItem>
          <SelectItem value="BROUILLON">Brouillon</SelectItem>
          <SelectItem value="VALIDE">Valide</SelectItem>
          <SelectItem value="CONTREPASSE">Contrepasse</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.origin}
        onValueChange={(value) =>
          onChange("origin", (value ?? "all") as CreditNoteFilters["origin"])
        }
      >
        <SelectTrigger className="h-10 w-full xl:w-44">
          <SelectValue placeholder="Origine">
            {(value: CreditNoteFilters["origin"] | null) =>
              value ? originLabels[value] : "Origine"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les origines</SelectItem>
          <SelectItem value="comptoir">Comptoir</SelectItem>
          <SelectItem value="camion">Camion</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
