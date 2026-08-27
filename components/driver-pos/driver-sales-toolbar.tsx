import { Search } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paymentMethods } from "@/lib/mock-data/payment-methods";
import type { DriverSalesFilters } from "@/lib/driver-sales-calculations";
import type { Customer } from "@/types/customer";
import type { SaleInvoice } from "@/types/sale";

type DriverSalesToolbarProps = {
  filters: DriverSalesFilters;
  invoices: SaleInvoice[];
  customers: Customer[];
  onChange: <K extends keyof DriverSalesFilters>(
    key: K,
    value: DriverSalesFilters[K],
  ) => void;
};

const periodOptions = [
  { value: "all", label: "Toutes les periodes" },
  { value: "today", label: "Aujourd'hui" },
  { value: "week", label: "7 derniers jours" },
  { value: "month", label: "30 derniers jours" },
];

const statusOptions = [
  { value: "all", label: "Tous les statuts" },
  { value: "payee", label: "Payee" },
  { value: "en_attente", label: "En attente" },
  { value: "annulee", label: "Annulee" },
];

function SimpleSelect({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}) {
  const labels: Record<string, string> = Object.fromEntries(
    options.map((option) => [option.value, option.label]),
  );

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={(next) => onValueChange(next ?? "all")}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={label}>
            {(selected: string | null) => (selected ? labels[selected] : label)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function DriverSalesToolbar({
  filters,
  invoices,
  customers,
  onChange,
}: DriverSalesToolbarProps) {
  const tourOptions = [
    { value: "all", label: "Toutes les tournees" },
    ...Array.from(
      new Map(
        invoices
          .filter((invoice) => invoice.tourId)
          .map((invoice) => [
            invoice.tourId as string,
            {
              value: invoice.tourId as string,
              label: invoice.tourId as string,
            },
          ]),
      ).values(),
    ),
  ];
  const customerOptions = [
    { value: "all", label: "Tous les clients" },
    ...customers
      .filter((customer) => invoices.some((invoice) => invoice.clientId === customer.id))
      .map((customer) => ({ value: customer.id, label: customer.nom })),
  ];
  const paymentOptions = [
    { value: "all", label: "Tous les reglements" },
    ...paymentMethods.map((method) => ({ value: method.value, label: method.label })),
  ];

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onChange("search", event.target.value)}
          placeholder="Rechercher facture, client, produit, tournee..."
          aria-label="Rechercher dans mes ventes"
          className="h-11 w-full rounded-2xl border border-input bg-background pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:ring-3 focus-visible:ring-emerald-500/15"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SimpleSelect
          label="Periode"
          value={filters.period}
          options={periodOptions}
          onValueChange={(value) =>
            onChange("period", value as DriverSalesFilters["period"])
          }
        />
        <SimpleSelect
          label="Tournee"
          value={filters.tourId}
          options={tourOptions}
          onValueChange={(value) => onChange("tourId", value)}
        />
        <SimpleSelect
          label="Client"
          value={filters.customerId}
          options={customerOptions}
          onValueChange={(value) => onChange("customerId", value)}
        />
        <SimpleSelect
          label="Reglement"
          value={filters.paymentMethod}
          options={paymentOptions}
          onValueChange={(value) =>
            onChange("paymentMethod", value as DriverSalesFilters["paymentMethod"])
          }
        />
        <SimpleSelect
          label="Statut"
          value={filters.status}
          options={statusOptions}
          onValueChange={(value) =>
            onChange("status", value as DriverSalesFilters["status"])
          }
        />
      </div>
    </div>
  );
}
