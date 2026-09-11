"use client";

import * as React from "react";
import { FileText, Wallet } from "lucide-react";

import { DailyInvoicesUserFilter } from "@/components/ventes/daily-invoices-user-filter";
import { InvoicesTable } from "@/components/ventes/invoices-table";
import { paymentMethodOptions } from "@/components/ventes/orders-toolbar";
import { useDailyInvoicesPage } from "@/components/ventes/use-daily-invoices-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import type { DailyInvoicesPageDto } from "@/types/daily-invoice";

type DailyInvoicesViewProps = {
  initialData: DailyInvoicesPageDto;
};

export function DailyInvoicesView({ initialData }: DailyInvoicesViewProps) {
  const [day, setDay] = React.useState(initialData.day);
  const [userIds, setUserIds] = React.useState<string[]>([]);
  const [paymentMethod, setPaymentMethod] = React.useState("all");

  const {
    data,
    pageIndex,
    hasMore,
    hasPrevious,
    loading,
    goToNextPage,
    goToPreviousPage,
    refetch,
  } = useDailyInvoicesPage({ day, userIds, paymentMethod }, initialData);

  const { kpis } = data;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Journée</Label>
          <Input
            type="date"
            value={day}
            max={initialData.day}
            onChange={(event) => setDay(event.target.value || initialData.day)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Utilisateur</Label>
          <DailyInvoicesUserFilter
            options={data.userOptions}
            value={userIds}
            onChange={setUserIds}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Mode de règlement</Label>
          <Select
            value={paymentMethod}
            onValueChange={(value) => setPaymentMethod(value ?? "all")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Tous">
                {(value: string | null) =>
                  value && value !== "all"
                    ? paymentMethodOptions.find((option) => option.value === value)?.label ?? value
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
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon={FileText} label="Factures" value={kpis.invoiceCount.toLocaleString("fr-FR")} />
        <KpiCard icon={Wallet} label="CA total" value={formatCurrency(kpis.revenueTotal)} accent />
        {kpis.byMethod.map((bucket) => (
          <KpiCard key={bucket.method} label={bucket.label} value={formatCurrency(bucket.amount)} />
        ))}
      </div>

      {!kpis.reconciled ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Écart de {formatCurrency(Math.abs(kpis.breakdownTotal - kpis.revenueTotal))} entre le
          détail par mode ({formatCurrency(kpis.breakdownTotal)}) et le CA total (
          {formatCurrency(kpis.revenueTotal)}).
        </p>
      ) : null}

      {/* Table */}
      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Journée du {data.dayLabel} · page {pageIndex + 1} · {data.items.length} sur{" "}
              {data.totalCount} facture{data.totalCount > 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasPrevious || loading}
                onClick={goToPreviousPage}
              >
                Précédent
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasMore || loading}
                onClick={goToNextPage}
              >
                Suivant
              </Button>
            </div>
          </div>

          <InvoicesTable invoices={data.items} onSaleChanged={refetch} />
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon?: typeof Wallet;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent className="space-y-1 p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {Icon ? <Icon aria-hidden="true" className="h-3.5 w-3.5" /> : null}
          {label}
        </p>
        <p
          className={`font-heading text-lg font-semibold tabular-nums ${
            accent ? "text-emerald-700" : "text-foreground"
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
