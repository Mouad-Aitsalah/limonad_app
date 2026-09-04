import type { Metadata } from "next";

import { DirectionCategoryChart } from "@/components/dashboard/direction-category-chart";
import { DirectionEvolutionChart } from "@/components/dashboard/direction-evolution-chart";
import { DirectionKpiCard } from "@/components/dashboard/direction-kpi-card";
import { DirectionPeriodBar } from "@/components/dashboard/direction-period-bar";
import { DirectionStockWatchCard } from "@/components/dashboard/direction-stock-watch";
import { DirectionTopCustomersCard } from "@/components/dashboard/direction-top-customers";
import { DirectionTopProductsCard } from "@/components/dashboard/direction-top-products";
import { DirectionWatchlistCard } from "@/components/dashboard/direction-watchlist";
import { AppPageHeader } from "@/components/ui/app-page-header";
import { getDirectionDashboardData } from "@/lib/server/dashboard-direction";

export const metadata: Metadata = {
  title: "Dashboard Direction",
};

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const data = await getDirectionDashboardData(params);
  const kpis = data.kpis;

  return (
    <div className="space-y-6">
      <AppPageHeader
        eyebrow="Direction"
        title="Dashboard Direction"
        description="Vue synthetique des ventes, marges, charges, creances et stocks."
      />

      <DirectionPeriodBar activeKey={data.period.key} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <DirectionKpiCard kpi={kpis.revenue} emphasis />
        <DirectionKpiCard kpi={kpis.grossMargin} emphasis />
        <DirectionKpiCard kpi={kpis.estimatedResult} emphasis />
        <DirectionKpiCard kpi={kpis.customerReceivables} emphasis />
        <DirectionKpiCard kpi={kpis.stockValue} emphasis />
      </div>

      <p className="text-xs text-muted-foreground italic">
        {data.marginNote ? `Marge brute - ${data.marginNote} ` : ""}
        Resultat estime : indicateur de gestion, hors elements comptables non integres.
      </p>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <DirectionKpiCard kpi={kpis.salesCount} />
        <DirectionKpiCard kpi={kpis.avgBasket} />
        <DirectionKpiCard kpi={kpis.purchasesHT} />
        <DirectionKpiCard kpi={kpis.chargesHT} />
        <DirectionKpiCard kpi={kpis.activeCustomers} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        <DirectionEvolutionChart granularity={data.salesEvolution.granularity} points={data.salesEvolution.points} />
        <DirectionCategoryChart data={data.categoryBreakdown} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        <DirectionTopProductsCard data={data.topProducts} />
        <DirectionStockWatchCard data={data.stockWatch} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        <DirectionTopCustomersCard rows={data.topCustomers} />
        <DirectionWatchlistCard items={data.watchlist} />
      </div>
    </div>
  );
}
