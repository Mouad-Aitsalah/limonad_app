import { AlertTriangle, BarChart3, Info, Sparkles } from "lucide-react";

import { DirectionKpiCard } from "@/components/dashboard/direction-kpi-card";
import { ForecastDailyChart } from "@/components/dashboard/forecast/forecast-daily-chart";
import { ForecastProductsList } from "@/components/dashboard/forecast/forecast-products-list";
import { SectionCard } from "@/components/ui/section-card";
import { formatCurrency } from "@/lib/currency";
import { formatBusinessDay, formatComputedAt, QUALITY_MESSAGE } from "@/lib/forecasting/forecast-format";
import { cn } from "@/lib/utils";
import type { DashboardForecastDto, DashboardForecastReady } from "@/types/dashboard-forecast";

export const FORECAST_SECTION_TITLE = "Intelligence & Prévisions IA";
const SECTION_DESCRIPTION =
  "Prévisions de ventes sur 7 jours et aide au réapprovisionnement. Consultatif : aucun bon de commande n'est créé.";

export const FORECAST_INDICATIVE_NOTE =
  "Recommandations indicatives : elles couvrent une période fixe de 7 jours, le délai réel de livraison de chaque fournisseur n'est pas encore pris en compte.";

const QUALITY_BANNER_CLASS = {
  sufficient: "border-emerald-200 bg-emerald-50 text-emerald-900",
  limited: "border-amber-200 bg-amber-50 text-amber-900",
  insufficient: "border-amber-300 bg-amber-50 text-amber-900",
} as const;

/** Loading placeholder shown while the section streams in. */
export function ForecastSectionSkeleton() {
  return (
    <SectionCard title={FORECAST_SECTION_TITLE} description={SECTION_DESCRIPTION} contentClassName="space-y-4">
      <div role="status" aria-live="polite" className="space-y-4" data-testid="forecast-loading">
        <span className="sr-only">Chargement des prévisions…</span>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-2xl bg-muted/60" />
          <div className="h-24 animate-pulse rounded-2xl bg-muted/60" />
        </div>
        <div className="h-48 animate-pulse rounded-2xl bg-muted/60" />
      </div>
    </SectionCard>
  );
}

function Notice({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  const Icon = tone === "error" ? AlertTriangle : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
        tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-border/70 bg-white/78 text-muted-foreground",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function plural(count: number, one: string, many: string) {
  return count > 1 ? many : one;
}

function ReadyContent({ data }: { data: DashboardForecastReady }) {
  const counts = data.reliabilityCounts;
  const total = counts.sufficient + counts.limited + counts.very_limited + counts.none;

  return (
    <div className="space-y-4">
      <div
        role="status"
        className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm", QUALITY_BANNER_CLASS[data.quality])}
        data-testid="forecast-quality"
      >
        <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p>{QUALITY_MESSAGE[data.quality]}</p>
          <p className="text-xs opacity-80">
            {total} {plural(total, "produit", "produits")} : {counts.sufficient} {plural(counts.sufficient, "fiable", "fiables")},{" "}
            {counts.limited} {plural(counts.limited, "limitée", "limitées")}, {counts.very_limited}{" "}
            {plural(counts.very_limited, "très limitée", "très limitées")}.
          </p>
        </div>
      </div>

      {data.noRecentSales ? (
        <Notice tone="info">
          <p className="font-medium text-foreground" data-testid="forecast-no-recent-sales">
            Prévisions à 0 : aucune vente récente.
          </p>
          <p>
            {data.noRecentSales.daysWithoutSale !== null && data.noRecentSales.lastSaleDate
              ? `Aucune vente depuis ${data.noRecentSales.daysWithoutSale} ${plural(data.noRecentSales.daysWithoutSale, "jour", "jours")} (dernière vente le ${formatBusinessDay(data.noRecentSales.lastSaleDate)}). `
              : "Aucune vente n'a été enregistrée sur la période récente. "}
            L&apos;historique existe, mais le moteur ne peut pas prévoir de ventes tant que de nouvelles ventes ne sont
            pas enregistrées. Les prévisions se mettront à jour au prochain calcul.
          </p>
        </Notice>
      ) : null}

      {!data.isCurrent ? (
        <Notice tone="info">
          Le calcul du jour n&apos;est pas encore disponible : ce sont les prévisions du {formatBusinessDay(data.businessDay)}.
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <DirectionKpiCard
          emphasis
          kpi={{
            id: "forecast-units",
            label: "Ventes prévues (7 jours)",
            value: `${data.totalUnits7Days.toLocaleString("fr-FR")} unités`,
            helper: "Produits actifs",
          }}
        />
        <DirectionKpiCard
          emphasis
          kpi={{
            id: "forecast-revenue",
            label: "CA prévisionnel (7 jours)",
            value: formatCurrency(data.revenue7Days),
            helper: "TTC, au prix catalogue actuel",
          }}
        />
      </div>

      <div className="rounded-[22px] border border-border/70 bg-white/82 p-4">
        <div className="mb-2 flex items-center gap-2">
          <BarChart3 aria-hidden="true" className="h-4 w-4 text-emerald-700" />
          <h3 className="font-heading text-sm font-semibold text-foreground">Ventes prévues par jour</h3>
        </div>
        {data.daily ? (
          <ForecastDailyChart points={data.daily} />
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground" data-testid="forecast-no-daily">
            Le détail par jour n&apos;est pas encore disponible pour ce calcul. Il apparaîtra après le prochain calcul
            quotidien.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {data.toOrderCount > 0
            ? `${data.toOrderCount} ${plural(data.toOrderCount, "produit", "produits")} à réapprovisionner.`
            : "Aucun réapprovisionnement nécessaire d'après les prévisions."}
          {data.negativeStockCount > 0
            ? ` ${data.negativeStockCount} ${plural(data.negativeStockCount, "produit", "produits")} en stock négatif à régulariser avant tout achat.`
            : ""}
        </p>
        <div className="overflow-hidden rounded-[22px] border border-border/70 bg-white/82 max-xl:overflow-visible max-xl:rounded-none max-xl:border-0 max-xl:bg-transparent">
          <ForecastProductsList rows={data.rows} />
        </div>
        {data.hiddenRowCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            + {data.hiddenRowCount} {plural(data.hiddenRowCount, "autre produit non affiché", "autres produits non affichés")}{" "}
            (les plus urgents sont listés en premier).
          </p>
        ) : null}
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p data-testid="forecast-updated-at">
          Dernière mise à jour :{" "}
          {data.computedAt
            ? formatComputedAt(data.computedAt)
            : `calcul du ${formatBusinessDay(data.businessDay)} (heure non enregistrée)`}
          .
        </p>
        <p>{FORECAST_INDICATIVE_NOTE}</p>
      </div>
    </div>
  );
}

/** Presentational: renders every state of the section from its DTO. */
export function ForecastSectionView({ data }: { data: DashboardForecastDto }) {
  return (
    <SectionCard title={FORECAST_SECTION_TITLE} description={SECTION_DESCRIPTION} contentClassName="space-y-4">
      {data.status === "error" ? (
        <Notice tone="error">{data.message}</Notice>
      ) : data.status === "empty" ? (
        <Notice tone="info">
          {data.reason === "no_snapshot"
            ? "Aucune prévision n'a encore été calculée. Elles sont calculées automatiquement chaque nuit à partir de l'historique des ventes réelles ; rien n'est affiché tant qu'un calcul n'a pas eu lieu."
            : "Aucun produit actif n'a assez d'historique de ventes pour être prévu."}
        </Notice>
      ) : (
        <ReadyContent data={data} />
      )}
    </SectionCard>
  );
}
