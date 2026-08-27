import type { Metadata } from "next";

import { CategoryDonutChart } from "@/components/dashboard/category-donut-chart";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { RecentSalesTable } from "@/components/dashboard/recent-sales-table";
import { SalesTrendChart } from "@/components/dashboard/sales-trend-chart";
import { StockAlertsCard } from "@/components/dashboard/stock-alerts-card";
import { TopProductsTable } from "@/components/dashboard/top-products-table";
import { AppPageHeader } from "@/components/ui/app-page-header";
import { PageEyebrow } from "@/components/ui/page-eyebrow";
import { SectionCard } from "@/components/ui/section-card";
import { getDashboardData } from "@/lib/server/dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-8">
      <div className="grid gap-4 xl:grid-cols-3">
        {data.heroCards.map((card) => (
          <SectionCard key={card.eyebrow} className="overflow-hidden" contentClassName="space-y-3">
            <PageEyebrow>{card.eyebrow}</PageEyebrow>
            <h2 className="font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
              {card.title}
            </h2>
            <p className="text-sm leading-7 text-[var(--text-secondary)]">{card.description}</p>
          </SectionCard>
        ))}
      </div>

      <AppPageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Suivez la performance commerciale, les tendances de ventes et les alertes en vous appuyant sur les donnees reelles de COMDIS."
      />

      <KpiGrid metrics={data.metrics} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        <SalesTrendChart data={data.salesTrend} />
        <CategoryDonutChart data={data.categorySales} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        <TopProductsTable rows={data.topProducts} />
        <div id="stock-alerts">
          <StockAlertsCard alerts={data.stockAlerts} />
        </div>
      </div>

      <RecentSalesTable rows={data.recentSales} />
    </div>
  );
}
