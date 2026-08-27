import { Search } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { roleOptions } from "@/lib/roles";

type UsersToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  role: string;
  onRoleChange: (value: string) => void;
  actif: string;
  onActifChange: (value: string) => void;
};

const roleLabelsWithAll: Record<string, string> = {
  all: "Tous les rôles",
  ...Object.fromEntries(roleOptions.map((option) => [option.value, option.label])),
};

const actifLabels: Record<string, string> = {
  all: "Tous",
  actif: "Actif",
  inactif: "Inactif",
};

export function UsersToolbar({
  search,
  onSearchChange,
  role,
  onRoleChange,
  actif,
  onActifChange,
}: UsersToolbarProps) {
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
          placeholder="Rechercher un nom, un email..."
          aria-label="Rechercher un utilisateur"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <Select value={role} onValueChange={(value) => onRoleChange(value ?? "all")}>
        <SelectTrigger className="w-full sm:w-48">
          <SelectValue placeholder="Rôle">
            {(value: string | null) => (value ? roleLabelsWithAll[value] : "Rôle")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les rôles</SelectItem>
          {roleOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={actif} onValueChange={(value) => onActifChange(value ?? "all")}>
        <SelectTrigger className="w-full sm:w-40">
          <SelectValue placeholder="Statut">
            {(value: string | null) => (value ? actifLabels[value] : "Statut")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes</SelectItem>
          <SelectItem value="actif">Actif</SelectItem>
          <SelectItem value="inactif">Inactif</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
