import { Banknote, CreditCard, ReceiptText, Route, WalletCards } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { DriverSalesGlobalTotals } from "@/lib/driver-sales-calculations";

type DriverSalesKpiCardsProps = {
  totals: DriverSalesGlobalTotals;
};

const kpiConfig = [
  {
    key: "salesCount",
    label: "Ventes",
    hint: "Factures chauffeur",
    icon: ReceiptText,
    className: "bg-sky-50 text-sky-700",
  },
  {
    key: "totalTTC",
    label: "CA total",
    hint: "Total TTC",
    icon: WalletCards,
    className: "bg-emerald-50 text-emerald-700",
  },
  {
    key: "paidAmount",
    label: "Encaisse",
    hint: "Hors credit",
    icon: Banknote,
    className: "bg-lime-50 text-lime-700",
  },
  {
    key: "creditAmount",
    label: "Credit",
    hint: "A regler",
    icon: CreditCard,
    className: "bg-amber-50 text-amber-700",
  },
  {
    key: "toursCount",
    label: "Tournees",
    hint: "Avec ventes",
    icon: Route,
    className: "bg-slate-100 text-slate-700",
  },
] as const;

export function DriverSalesKpiCards({ totals }: DriverSalesKpiCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {kpiConfig.map((item) => {
        const Icon = item.icon;
        const rawValue = totals[item.key];
        const value =
          item.key === "salesCount" || item.key === "toursCount"
            ? rawValue.toLocaleString("fr-FR")
            : formatCurrency(rawValue);

        return (
          <Card
            key={item.key}
            className="border-border/70 shadow-[0_12px_34px_rgba(15,23,42,0.05)]"
          >
            <CardContent className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-2xl ${item.className}`}
              >
                <Icon aria-hidden="true" className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-1 truncate text-lg font-semibold text-foreground">
                  {value}
                </p>
                <p className="text-xs text-muted-foreground">{item.hint}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
