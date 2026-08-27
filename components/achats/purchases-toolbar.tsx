import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { purchasePaymentMethods } from "@/lib/mock-data/purchase-payment-methods";
import { users } from "@/lib/mock-data/users";
import type { ProductOptionDto } from "@/types/product-dto";

export type PurchasesFilters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  fournisseur: string;
  modeReglement: string;
  utilisateur: string;
  statut: string;
};

export const defaultPurchasesFilters: PurchasesFilters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  fournisseur: "all",
  modeReglement: "all",
  utilisateur: "all",
  statut: "all",
};

const eligibleUsers = users.filter(
  (user) => (user.role === "admin" || user.role === "cashier") && user.actif,
);

const statutOptions = [
  { value: "validee", label: "Validé" },
  { value: "en_attente", label: "En attente" },
  { value: "annulee", label: "Annulée" },
];

type PurchasesToolbarProps = {
  filters: PurchasesFilters;
  supplierOptions: ProductOptionDto[];
  onChange: <K extends keyof PurchasesFilters>(
    key: K,
    value: PurchasesFilters[K],
  ) => void;
};

function SimpleSelect({
  value,
  onValueChange,
  placeholder,
  options,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  const labels: Record<string, string> = {
    all: `Tous (${placeholder})`,
    ...Object.fromEntries(options.map((option) => [option.value, option.label])),
  };

  return (
    <Select value={value} onValueChange={(next) => onValueChange(next ?? "all")}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder}>
          {(val: string | null) => (val ? labels[val] : placeholder)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tous</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PurchasesToolbar({
  filters,
  onChange,
  supplierOptions,
}: PurchasesToolbarProps) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onChange("search", event.target.value)}
          placeholder="Rechercher un n° d'achat, un fournisseur..."
          aria-label="Rechercher un achat"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Du</Label>
          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => onChange("dateFrom", event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Au</Label>
          <Input
            type="date"
            value={filters.dateTo}
            onChange={(event) => onChange("dateTo", event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Fournisseur</Label>
          <SimpleSelect
            value={filters.fournisseur}
            onValueChange={(value) => onChange("fournisseur", value)}
            placeholder="fournisseurs"
            options={supplierOptions.map((supplier) => ({
              value: supplier.id,
              label: supplier.name,
            }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Règlement</Label>
          <SimpleSelect
            value={filters.modeReglement}
            onValueChange={(value) => onChange("modeReglement", value)}
            placeholder="modes"
            options={purchasePaymentMethods.map((method) => ({
              value: method.value,
              label: method.label,
            }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Utilisateur</Label>
          <SimpleSelect
            value={filters.utilisateur}
            onValueChange={(value) => onChange("utilisateur", value)}
            placeholder="utilisateurs"
            options={eligibleUsers.map((user) => ({
              value: user.id,
              label: user.nom,
            }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Statut</Label>
          <SimpleSelect
            value={filters.statut}
            onValueChange={(value) => onChange("statut", value)}
            placeholder="statuts"
            options={statutOptions}
          />
        </div>
      </div>
    </div>
  );
}
