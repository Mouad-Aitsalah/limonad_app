import type { LucideIcon } from "lucide-react";
import { Coins, CreditCard, FileText, Landmark, Receipt, TrendingUp } from "lucide-react";

import { layoutDailyKpis } from "@/lib/daily-invoice-kpis";
import { cn, formatCurrency } from "@/lib/utils";
import type { DailyInvoicesKpisDto } from "@/types/daily-invoice";

/**
 * KPI block of "Factures journalières": three highlighted figures (CA total,
 * Espèces, Crédit) above three discreet ones (Factures, Virement, Chèque).
 * Pure presentation - the figures come from the existing KPI data
 * (see lib/daily-invoice-kpis.ts).
 */
export function DailyKpiCards({ kpis }: { kpis: DailyInvoicesKpisDto }) {
  const { primary, secondary, extras } = layoutDailyKpis(kpis);

  return (
    <div className="space-y-3 lg:space-y-4">
      {/* Phones: CA total full width, Espèces + Crédit side by side; tablets: the
          three on one row; from lg the original three-column grid (gap-4). */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:gap-4">
        <PrimaryKpi
          featured
          icon={TrendingUp}
          label="CA total"
          value={formatCurrency(primary.revenueTotal)}
          iconClassName="bg-emerald-100 text-emerald-700"
          valueClassName="text-emerald-700"
          className="col-span-2 sm:col-span-1"
        />
        <PrimaryKpi
          icon={Coins}
          label="Espèces"
          value={formatCurrency(primary.cash)}
          iconClassName="bg-sky-100 text-sky-700"
          valueClassName="text-sky-700"
        />
        <PrimaryKpi
          icon={CreditCard}
          label="Crédit"
          value={formatCurrency(primary.credit)}
          iconClassName="bg-violet-100 text-violet-700"
          valueClassName="text-violet-700"
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
        <SecondaryKpi
          icon={FileText}
          label="Factures"
          value={secondary.invoiceCount.toLocaleString("fr-FR")}
          className="col-span-2 sm:col-span-1"
          inlineOnPhone
        />
        <SecondaryKpi icon={Landmark} label="Virement" value={formatCurrency(secondary.transfer)} />
        <SecondaryKpi icon={Receipt} label="Chèque" value={formatCurrency(secondary.check)} />
      </div>

      {extras.length > 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          Autres modes :{" "}
          {extras.map((bucket, index) => (
            <span key={bucket.method}>
              {index > 0 ? " · " : ""}
              {bucket.label}{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatCurrency(bucket.amount)}
              </span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function breakableUnit(value: string) {
  return value.replace(/ /g, " ");
}

function PrimaryKpi({
  icon: Icon,
  label,
  value,
  iconClassName,
  valueClassName,
  featured = false,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  iconClassName: string;
  valueClassName: string;
  /** The CA total card: soft green tint and a larger amount. */
  featured?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Phones / tablets: compact (p-3, gap-2); from lg the original p-6 / gap-5.
        "flex min-w-0 flex-col justify-between gap-2 rounded-2xl p-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:gap-5 lg:p-6",
        featured ? "bg-gradient-to-br from-emerald-50 via-white to-white" : "bg-white",
        className,
      )}
    >
      <div className="flex items-center gap-2 lg:gap-3">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg lg:h-11 lg:w-11 lg:rounded-xl", iconClassName)}>
          <Icon aria-hidden="true" className="h-4 w-4 lg:h-5 lg:w-5" />
        </span>
        <p className="text-[13px] font-semibold text-muted-foreground lg:text-sm">{label}</p>
      </div>
      <p
        className={cn(
          "font-heading leading-none font-semibold tracking-tight tabular-nums break-words",
          featured ? "text-2xl lg:text-4xl xl:text-[2.6rem]" : "text-lg sm:text-xl lg:text-3xl xl:text-4xl",
          valueClassName,
        )}
      >
        {/* Same figure; a regular space before the unit lets "DH" drop under a
            long amount instead of being split in the middle ("D / H"). */}
        {breakableUnit(value)}
      </p>
    </div>
  );
}

function SecondaryKpi({
  icon: Icon,
  label,
  value,
  className,
  inlineOnPhone = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  className?: string;
  /** Phones only: label on the left, figure on the right of a full-width strip. */
  inlineOnPhone?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-2xl bg-white/80 px-3 py-2.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)] lg:px-4 lg:py-3",
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 max-sm:hidden">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </span>
      <div
        className={cn(
          "min-w-0",
          inlineOnPhone && "max-sm:flex max-sm:w-full max-sm:items-center max-sm:justify-between max-sm:gap-3",
        )}
      >
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="font-heading text-base leading-tight font-semibold tabular-nums break-words text-foreground sm:text-lg">
          {breakableUnit(value)}
        </p>
      </div>
    </div>
  );
}
