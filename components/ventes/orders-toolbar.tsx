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

export type OrdersFilters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  paymentMethod: string;
};

export const defaultOrdersFilters: OrdersFilters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  paymentMethod: "all",
};

export const paymentMethodOptions = [
  { value: "CASH", label: "Especes" },
  { value: "CARD", label: "Carte" },
  { value: "CHECK", label: "Cheque" },
  { value: "BANK_TRANSFER", label: "Virement" },
  { value: "CREDIT", label: "Credit" },
  { value: "MIXED", label: "Mixte" },
];

export const paymentMethodLabels: Record<string, string> = Object.fromEntries(
  paymentMethodOptions.map((option) => [option.value, option.label]),
);

type OrdersToolbarProps = {
  filters: OrdersFilters;
  onChange: <K extends keyof OrdersFilters>(key: K, value: OrdersFilters[K]) => void;
};

export function OrdersToolbar({ filters, onChange }: OrdersToolbarProps) {
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
          placeholder="Rechercher un n° de commande, un client, un chauffeur..."
          aria-label="Rechercher une commande"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
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
          <Label className="text-xs text-muted-foreground">Paiement</Label>
          <Select
            value={filters.paymentMethod}
            onValueChange={(value) => onChange("paymentMethod", value ?? "all")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Tous les paiements">
                {(value: string | null) =>
                  value && value !== "all" ? paymentMethodLabels[value] : "Tous les paiements"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              {paymentMethodOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
