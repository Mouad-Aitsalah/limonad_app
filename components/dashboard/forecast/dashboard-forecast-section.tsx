import { ForecastSectionView } from "@/components/dashboard/forecast/forecast-section-view";
import { getDashboardForecast } from "@/lib/server/dashboard-forecast";

/**
 * Async server component: reads the cached forecast for the connected admin /
 * depot manager. Rendered inside <Suspense> by the dashboard page, so the rest
 * of the dashboard never waits for it. Callers must only render it for
 * FORECAST_VIEW_ROLES (getDashboardForecast enforces it as well).
 * `embedded`: rendered inside ForecastCollapsible (no card / title of its own).
 */
export async function DashboardForecastSection({ embedded = false }: { embedded?: boolean } = {}) {
  const data = await getDashboardForecast();
  return <ForecastSectionView data={data} embedded={embedded} />;
}
