import type { LucideIcon } from "lucide-react";
import { Coins, CreditCard, FileText, Landmark, Percent, Receipt, TrendingUp } from "lucide-react";

import { formatMarkupRate, layoutDailyKpis, marginPartialNote } from "@/lib/daily-invoice-kpis";
import { cn, formatCurrency } from "@/lib/utils";
import type { DailyInvoicesKpisDto, DailyMarginDto } from "@/types/daily-invoice";

/**
 * KPI block of "Factures journalières": three highlighted figures - Espèces,
 * Crédit, CA total, in that order - above three discreet ones (Factures,
 * Virement, Chèque). Pure presentation - the figures come from the existing
 * KPI data (see lib/daily-invoice-kpis.ts).
 */
export function DailyKpiCards({ kpis }: { kpis: DailyInvoicesKpisDto }) {
  const { primary, secondary, extras } = layoutDailyKpis(kpis);
  // Present only for the admin (the server sends no margin field to any other role).
  const margin = kpis.margin;

  return (
    <div className="space-y-3 lg:space-y-4">
      {/* Espèces -> Crédit -> CA total, three cards of exactly the same size
          (equal columns, equal row height): one single row from 640 px up
          (tablet and desktop); on a phone two columns, so the third card wraps
          cleanly onto its own row at the very same width and height.
          With the admin's « Marge totale (HT) » card: 2 x 2 up to 1024 px, then
          the four cards on one row. */}
      <div
        className={
          margin
            ? "grid auto-rows-fr grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4 lg:gap-4"
            : "grid auto-rows-fr grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:gap-4"
        }
      >
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
        <PrimaryKpi
          featured
          icon={TrendingUp}
          label="CA total"
          value={formatCurrency(primary.revenueTotal)}
          iconClassName="bg-emerald-100 text-emerald-700"
          valueClassName="text-emerald-700"
        />
        {margin ? <MarginKpi margin={margin} /> : null}
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

export function breakableUnit(value: string) {
  return value.replace(/ /g, " ");
}

export function PrimaryKpi({
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
  /** The CA total card: soft green tint (same size and amount size as the others). */
  featured?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Phones / tablets: compact (p-3, gap-2). Desktop: compact too (px-5 py-4, gap-2.5).
        "flex h-full min-w-0 flex-col justify-between gap-2 rounded-2xl p-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:gap-2.5 lg:px-5 lg:py-4",
        featured ? "bg-gradient-to-br from-emerald-50 via-white to-white" : "bg-white",
        className,
      )}
    >
      <div className="flex items-center gap-2 lg:gap-3">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg lg:h-9 lg:w-9", iconClassName)}>
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <p className="text-[13px] font-semibold text-muted-foreground lg:text-sm">{label}</p>
      </div>
      <p
        className={cn(
          // the same amount size on the three cards, so titles, icons and amounts line up
          "font-heading text-lg leading-none font-semibold tracking-tight tabular-nums break-words sm:text-xl lg:text-2xl xl:text-3xl",
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

/**
 * « Marge totale (HT) »: the margin amount on the left, the taux de marque on the
 * right (« — » when the CA HT of the reliable lines is 0), and a « partielle » note
 * when lines without a reliable cost were left out (see lib/daily-sales-grouping.ts).
 */
export function MarginKpi({ margin }: { margin: DailyMarginDto }) {
  const partialNote = marginPartialNote(margin);
  return (
    <div
      data-kpi="margin"
      className="flex h-full min-w-0 flex-col justify-between gap-2 rounded-2xl bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)] lg:gap-2.5 lg:px-5 lg:py-4"
    >
      <div className="flex items-center gap-2 lg:gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 lg:h-9 lg:w-9">
          <Percent aria-hidden="true" className="h-4 w-4" />
        </span>
        <p className="text-[13px] font-semibold text-muted-foreground lg:text-sm">Marge totale (HT)</p>
      </div>
      <div className="flex min-w-0 items-end justify-between gap-2">
        <p
          data-margin-amount
          className="font-heading min-w-0 text-lg leading-none font-semibold tracking-tight tabular-nums break-words text-amber-700 sm:text-xl lg:text-2xl xl:text-3xl"
        >
          {breakableUnit(formatCurrency(margin.marginHT))}
        </p>
        <p
          data-margin-rate
          title="Taux de marque = marge HT / CA HT × 100"
          className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-sm font-semibold tabular-nums text-amber-800 lg:text-base"
        >
          {formatMarkupRate(margin.markupRate)}
        </p>
      </div>
      {partialNote ? (
        <p data-margin-partial className="text-[11px] leading-snug text-amber-700" title={partialNote}>
          Marge partielle · {partialNote}
        </p>
      ) : null}
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
