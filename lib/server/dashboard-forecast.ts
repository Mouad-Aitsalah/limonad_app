import "server-only";

import { FORECAST_VIEW_ROLES } from "@/lib/forecasting/forecast-access";
import { getDashboardForecastFor, loadDashboardForecast } from "@/lib/forecasting/dashboard-forecast";
import { prisma } from "@/lib/prisma";
import { requireDashboardAccess } from "@/lib/server/dashboard-security";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { reportUnexpected } from "@/lib/server/report-error";
import type { DashboardForecastDto } from "@/types/dashboard-forecast";

/**
 * Data of the dashboard section "Intelligence & Prévisions IA" for the
 * CONNECTED user's organisation (always taken from the session). Reserved to
 * admin and depot manager (FORECAST_VIEW_ROLES) - the cashier gets a 403 here
 * even though /dashboard itself is open to the cashier. Reads the daily cache;
 * never runs the forecast engine. A failure of the read is returned as a
 * "error" DTO (and reported), never thrown into the dashboard page.
 */
export async function getDashboardForecast(): Promise<DashboardForecastDto> {
  return loadDashboardForecast({
    requireUser: async () => {
      const user = await requireOrganizationUser(FORECAST_VIEW_ROLES);
      await requireDashboardAccess(user);
      return user;
    },
    load: (organizationId) => getDashboardForecastFor(prisma, organizationId),
    report: (error) => reportUnexpected(error, { route: "dashboard forecast section", area: "forecasting", op: "getDashboardForecast" }),
  });
}
