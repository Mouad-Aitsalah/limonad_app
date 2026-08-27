"use client";

import * as React from "react";
import { MapPin, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DriverTourCustomerDto } from "@/types/operations-dto";

const statusLabels: Record<DriverTourCustomerDto["visitStatus"], string> = {
  PENDING: "A visiter",
  NEARBY: "Client proche",
  ARRIVED: "Arrive",
  DELIVERED: "Livre",
  NO_SALE: "Sans vente",
};

const statusDots: Record<DriverTourCustomerDto["visitStatus"], string> = {
  PENDING: "bg-slate-400",
  NEARBY: "bg-amber-500",
  ARRIVED: "bg-sky-500",
  DELIVERED: "bg-emerald-500",
  NO_SALE: "bg-rose-500",
};

export function TourCustomersSheet({
  open,
  customers,
  selectedCustomerId,
  suggestedCustomerId,
  completedCount,
  onClose,
  onSelectCustomer,
}: {
  open: boolean;
  customers: DriverTourCustomerDto[];
  selectedCustomerId?: string | null;
  suggestedCustomerId?: string | null;
  completedCount: number;
  onClose: () => void;
  onSelectCustomer: (customerId: string) => void;
}) {
  const [search, setSearch] = React.useState("");

  if (!open) {
    return null;
  }

  function handleClose() {
    setSearch("");
    onClose();
  }

  const normalizedQuery = normalize(search);
  const filteredCustomers = customers.filter((customer) => {
    if (!normalizedQuery) {
      return true;
    }

    return normalize(
      `${customer.name} ${customer.code} ${customer.phone} ${customer.city} ${customer.address}`,
    ).includes(normalizedQuery);
  });

  return (
    <div className="fixed inset-0 z-[900]">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/40"
        onClick={handleClose}
        aria-label="Fermer la liste des clients"
      />

      <div className="absolute inset-x-0 bottom-0 rounded-t-[30px] bg-background px-4 pb-6 pt-4 shadow-[0_-18px_40px_rgba(15,23,42,0.18)]">
        <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-200" />

        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-foreground">Choisir un client</p>
            <p className="text-sm text-muted-foreground">
              {completedCount} client{completedCount > 1 ? "s" : ""} termine
              {completedCount > 1 ? "s" : ""}
            </p>
          </div>

          <Button type="button" variant="ghost" size="icon" onClick={handleClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="mb-4">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher par nom, compte, telephone ou ville..."
            className="h-11 rounded-2xl"
          />
        </div>

        <div className="max-h-[60svh] space-y-2 overflow-y-auto">
          {filteredCustomers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Aucun client ne correspond a votre recherche.
            </div>
          ) : null}

          {filteredCustomers.map((customer) => {
            const missingLocation =
              customer.latitude === null ||
              customer.latitude === undefined ||
              customer.longitude === null ||
              customer.longitude === undefined;
            const isSelected = customer.id === selectedCustomerId;
            const isSuggested = customer.id === suggestedCustomerId;

            return (
              <div
                key={customer.id}
                className={cn(
                  "rounded-2xl border border-border bg-background px-3 py-3 transition",
                  isSelected && "border-emerald-300 bg-emerald-50/70",
                  !isSelected && isSuggested && "border-amber-300 bg-amber-50/70",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                      statusDots[customer.visitStatus],
                    )}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {customer.name}
                      </p>
                      <span className="text-xs text-muted-foreground">{customer.code}</span>
                      <span className="text-xs text-muted-foreground">
                        {statusLabels[customer.visitStatus]}
                      </span>
                      {isSelected ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                          Selectionne
                        </span>
                      ) : null}
                      {!isSelected && isSuggested ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          Suggestion
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {missingLocation
                        ? "Localisation non disponible"
                        : customer.address || customer.city || "Adresse non renseignee"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {customer.phone || "Telephone non renseigne"}
                    </p>
                  </div>

                  {!missingLocation ? (
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  ) : null}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {customer.distanceMeters !== null && customer.distanceMeters !== undefined
                      ? formatDistance(customer.distanceMeters)
                      : "Distance indisponible"}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => {
                      onSelectCustomer(customer.id);
                      handleClose();
                    }}
                  >
                    Choisir
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDistance(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} km`;
  }

  return `${Math.round(value)} m`;
}
