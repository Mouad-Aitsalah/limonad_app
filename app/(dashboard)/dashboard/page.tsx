import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";

import { CommercialAnalysisTabs } from "@/components/dashboard/commercial/commercial-analysis-tabs";
import { ReceivablesSection } from "@/components/dashboard/receivables/receivables-section";
import { DashboardForecastSection } from "@/components/dashboard/forecast/dashboard-forecast-section";
import { ForecastCollapsible } from "@/components/dashboard/forecast/forecast-collapsible";
import {
  FORECAST_SECTION_DESCRIPTION,
  FORECAST_SECTION_TITLE,
  ForecastSectionSkeleton,
} from "@/components/dashboard/forecast/forecast-section-view";
import { DirectionCategoryChart } from "@/components/dashboard/direction-category-chart";
import { DirectionEvolutionChart } from "@/components/dashboard/direction-evolution-chart";
import { DirectionKpiCard } from "@/components/dashboard/direction-kpi-card";
import { DirectionPeriodBar } from "@/components/dashboard/direction-period-bar";
import { DirectionStockWatchCard } from "@/components/dashboard/direction-stock-watch";
import { DirectionTopCustomersCard } from "@/components/dashboard/direction-top-customers";
import { DirectionTopProductsCard } from "@/components/dashboard/direction-top-products";
import { DirectionWatchlistCard } from "@/components/dashboard/direction-watchlist";
import { canViewCommercialAnalysis } from "@/lib/commercial-analysis/access";
import { canViewReceivables } from "@/lib/receivables/access";
import { canViewForecast } from "@/lib/forecasting/forecast-access";
import { isFullDocumentLoad } from "@/lib/dashboard-security";
import { DashboardLeaveGuard } from "@/components/dashboard/security/dashboard-leave-guard";
import { DashboardSecurityGate } from "@/components/dashboard/security/dashboard-security-gate";
import { getCurrentSessionUser } from "@/lib/server/auth";
import { resolveDashboardAccess, DASHBOARD_VIEW_ROLES } from "@/lib/server/dashboard-security";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { getDirectionDashboardData } from "@/lib/server/dashboard-direction";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Dashboard Direction",
};

export const dynamic = "force-dynamic";

// Two balanced rows of five KPI cards from xl; two columns on a tablet, one on a
// phone (never a horizontal overflow). In two columns the odd card of a row of five
// takes the full width instead of leaving a hole.
const KPI_ROW_CLASS =
  "grid grid-cols-1 gap-5 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2 xl:grid-cols-5 xl:[&>*:last-child:nth-child(odd)]:col-span-1";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  await requireModulePage("dashboard");
  // Dashboard security (SUPER_ADMIN switch): while a password must be created / renewed / entered, render the gate
  // and NOTHING else - no dashboard data is read. Off = this block does nothing.
  // A real full page load (Sec-Fetch-Dest: document: address bar, reload, new tab) is a NEW visit and asks the password
  // again. router.refresh(), in-app navigations and prefetches are not. (Next hides the `rsc` header from headers().)
  const newVisit = isFullDocumentLoad(await headers());
  const access = await resolveDashboardAccess(await requireOrganizationUser([...DASHBOARD_VIEW_ROLES]), { newVisit });
  if (access.status === "gate") return <DashboardSecurityGate gate={access.gate} />;
  const params = await searchParams;
  const data = await getDirectionDashboardData(params);
  const kpis = data.kpis;
  // "Intelligence & Prévisions IA" (purchase recommendations, global analysis):
  // admin and depot manager only - the cashier can open this page but never
  // sees the section (getDashboardForecast refuses the cashier as well).
  const sessionUser = await getCurrentSessionUser();
  const showForecast = canViewForecast(sessionUser?.role);
  // "Analyse commerciale" (sales by driver / product / supplier, weekly coverage): admin only,
  // also enforced by its API routes.
  const showCommercialAnalysis = canViewCommercialAnalysis(sessionUser?.role);
  // "Créances clients" (balances, aging, customer movements): admin only, also
  // enforced by its API routes. Read only.
  const showReceivables = canViewReceivables(sessionUser?.role);

  return (
    <div className="space-y-6">
      {access.secured ? <DashboardLeaveGuard /> : null}
      <DirectionPeriodBar activeKey={data.period.key} />

      <div className={KPI_ROW_CLASS}>
        <DirectionKpiCard kpi={kpis.revenue} emphasis />
        <DirectionKpiCard kpi={kpis.grossMargin} emphasis />
        <DirectionKpiCard kpi={kpis.estimatedResult} emphasis />
        <DirectionKpiCard kpi={kpis.customerReceivables} emphasis />
        <DirectionKpiCard kpi={kpis.stockValue} emphasis />
      </div>

      <p className="text-xs text-muted-foreground italic">
        {data.marginNote ? `Marge brute - ${data.marginNote} ` : ""}
        Résultat estimé : indicateur de gestion, hors éléments comptables non intégrés.
      </p>

      <div className={KPI_ROW_CLASS}>
        <DirectionKpiCard kpi={kpis.salesCount} />
        <DirectionKpiCard kpi={kpis.avgBasket} />
        <DirectionKpiCard kpi={kpis.purchasesHT} />
        <DirectionKpiCard kpi={kpis.chargesHT} />
        <DirectionKpiCard kpi={kpis.activeCustomers} />
      </div>

      {showForecast ? (
        <ForecastCollapsible title={FORECAST_SECTION_TITLE} description={FORECAST_SECTION_DESCRIPTION}>
          <Suspense fallback={<ForecastSectionSkeleton embedded />}>
            <DashboardForecastSection embedded />
          </Suspense>
        </ForecastCollapsible>
      ) : null}

      {showCommercialAnalysis ? <CommercialAnalysisTabs /> : null}

      {showReceivables ? <ReceivablesSection /> : null}

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
