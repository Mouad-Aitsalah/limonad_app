"use client";

import * as React from "react";

import { DailyInvoicesUserFilter } from "@/components/ventes/daily-invoices-user-filter";
import { paymentMethodOptions } from "@/components/ventes/orders-toolbar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DailyInvoicesFilters } from "@/lib/daily-invoices-filters";
import type { DailyInvoiceUserOptionDto } from "@/types/daily-invoice";

type DailyInvoicesFilterFieldsProps = {
  value: DailyInvoicesFilters;
  onChange: (next: DailyInvoicesFilters) => void;
  userOptions: DailyInvoiceUserOptionDto[];
  /** The current business day: the latest selectable day, and the value of an emptied date. */
  maxDay: string;
  /** Extra cell after the three fields (e.g. the « Appliquer » button of the grouping page). */
  actions?: React.ReactNode;
};

/**
 * The three filters of « Factures journalières » (Journée, Utilisateur, Mode de
 * règlement) - shared by the daily invoices page and the « Regroupement des
 * ventes » page, so both filter the same way. Phones: full-width fields, tighter
 * gaps, 40px touch height; from lg the original spacing and heights.
 */
export function DailyInvoicesFilterFields({ value, onChange, userOptions, maxDay, actions }: DailyInvoicesFilterFieldsProps) {
  const { day, userIds, paymentMethod } = value;
  const setDay = (next: string) => onChange({ ...value, day: next });
  const setUserIds = (next: string[]) => onChange({ ...value, userIds: next });
  const setPaymentMethod = (next: string) => onChange({ ...value, paymentMethod: next });

  return (
    <div className={cn("grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3", actions ? "lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end" : null)}>
      <div className="space-y-1 lg:space-y-1.5">
        <Label className="text-xs text-muted-foreground">Journée</Label>
        <Input
          className="max-lg:h-10"
          type="date"
          value={day}
          max={maxDay}
          onChange={(event) => setDay(event.target.value || maxDay)}
        />
      </div>
      <div className="space-y-1 lg:space-y-1.5">
        <Label className="text-xs text-muted-foreground">Utilisateur</Label>
        <DailyInvoicesUserFilter options={userOptions} value={userIds} onChange={setUserIds} />
      </div>
      <div className="space-y-1 lg:space-y-1.5">
        <Label className="text-xs text-muted-foreground">Mode de règlement</Label>
        <Select value={paymentMethod} onValueChange={(next) => setPaymentMethod(next ?? "all")}>
          <SelectTrigger className="w-full max-lg:data-[size=default]:h-10">
            <SelectValue placeholder="Tous">
              {(selected: string | null) =>
                selected && selected !== "all"
                  ? paymentMethodOptions.find((option) => option.value === selected)?.label ?? selected
                  : "Tous"
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
      {actions ? <div className="flex items-end sm:col-span-2 lg:col-span-1">{actions}</div> : null}
    </div>
  );
}
